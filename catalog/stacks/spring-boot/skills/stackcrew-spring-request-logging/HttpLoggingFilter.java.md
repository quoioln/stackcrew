Goes to `src/main/java`, package `{{sc:basePackage}}.common.logging`, as `HttpLoggingFilter.java`.

```java
package {{sc:basePackage}}.common.logging;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.slf4j.event.Level;
import org.slf4j.spi.LoggingEventBuilder;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.util.ContentCachingRequestWrapper;
import org.springframework.web.util.WebUtils;

import java.io.IOException;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

/**
 * One http_in line per request, with masked bodies (core-logging). Add it to the security filter chain before
 * CorsFilter (addFilterBefore(..., CorsFilter.class)), so CORS and authentication rejections get their line too, and
 * add UserMdc right after BearerTokenAuthenticationFilter so every log line of the request carries userId and tenantId.
 * Both read the user from the Jwt in the security context, so this works without JPA.
 */
public class HttpLoggingFilter extends OncePerRequestFilter {

    static final String TENANT_CLAIM = "{{sc:tenantClaim}}";

    private static final Logger log = LoggerFactory.getLogger(HttpLoggingFilter.class);
    private static final String START_ATTRIBUTE = HttpLoggingFilter.class.getName() + ".start";
    private static final String REQUEST_ID_ATTRIBUTE = HttpLoggingFilter.class.getName() + ".requestId";
    /** JSON and form bodies are parsed whole so base64 images shrink to their size; above this they log a size placeholder. */
    private static final int CAPTURE_LIMIT_BYTES = 2 * 1024 * 1024;
    private static final String UNMATCHED_ROUTE = "UNMATCHED";
    private static final String ACTUATOR_PATH = "/actuator";

    private final BodyMasker masker;

    public HttpLoggingFilter(BodyMasker masker) {
        this.masker = masker;
    }

    /** No line for health and metrics. */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return request.getRequestURI().startsWith(request.getContextPath() + ACTUATOR_PATH);
    }

    /** An async request (Callable, DeferredResult, SSE, StreamingResponseBody) writes its line when the async dispatch ends. */
    @Override
    protected boolean shouldNotFilterAsyncDispatch() {
        return false;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest httpRequest, HttpServletResponse httpResponse, FilterChain chain)
            throws ServletException, IOException {
        boolean firstDispatch = !isAsyncDispatch(httpRequest);
        ContentCachingRequestWrapper request = firstDispatch
                ? new ContentCachingRequestWrapper(httpRequest, CAPTURE_LIMIT_BYTES)
                : WebUtils.getNativeRequest(httpRequest, ContentCachingRequestWrapper.class);
        TeeResponseWrapper response = firstDispatch
                ? new TeeResponseWrapper(httpResponse, request, CAPTURE_LIMIT_BYTES)
                : WebUtils.getNativeResponse(httpResponse, TeeResponseWrapper.class);
        if (request == null || response == null) {
            chain.doFilter(httpRequest, httpResponse);
            return;
        }
        if (firstDispatch) {
            request.setAttribute(START_ATTRIBUTE, System.nanoTime());
        }
        try {
            putRequestContext(request);
            Throwable failure = null;
            try {
                chain.doFilter(request, response);
            } catch (IOException | ServletException | RuntimeException e) {
                failure = e;
                throw e;
            } finally {
                if (!isAsyncStarted(request)) {
                    writeLine(request, response, failure);
                }
            }
        } finally {
            // every exit path: a pooled thread must not keep this request's ids
            MDC.remove(LogFields.REQUEST_ID);
            MDC.remove(LogFields.USER_ID);
            MDC.remove(LogFields.TENANT_ID);
        }
    }

    /** Logging never throws (core-logging): when building the line fails, the same line with size-only bodies is written. */
    private void writeLine(ContentCachingRequestWrapper request, TeeResponseWrapper response, Throwable failure) {
        putUserContext();
        try {
            LoggingEventBuilder line = baseLine(request, response, failure);
            if (masker.logBodies()) {
                line = addIfPresent(line, LogFields.REQ_BODY, requestBody(request));
                line = addIfPresent(line, LogFields.RES_BODY, responseBody(response));
            }
            line.log();
        } catch (RuntimeException logFailure) {
            try {
                minimalLine(request, response, failure).log();
            } catch (RuntimeException minimalFailure) {
                // the logging backend itself fails: never replace the request's own outcome
                logFailure.addSuppressed(minimalFailure);
                LogFields.warnLineNotWritten(LogFields.HTTP_IN, logFailure);
            }
        }
    }

    private LoggingEventBuilder baseLine(ContentCachingRequestWrapper request, TeeResponseWrapper response, Throwable failure) {
        int status = failure == null ? response.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR.value();
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - (Long) request.getAttribute(START_ATTRIBUTE));
        Object route = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        LoggingEventBuilder line = log.atLevel(levelFor(status)).setMessage(LogFields.HTTP_IN)
                .addKeyValue(LogFields.EVENT, LogFields.HTTP_IN)
                .addKeyValue(LogFields.METHOD, request.getMethod())
                .addKeyValue(LogFields.ROUTE, route == null ? UNMATCHED_ROUTE : route.toString())
                .addKeyValue(LogFields.STATUS, status)
                .addKeyValue(LogFields.DURATION_MS, durationMs);
        return failure == null ? line : line.addKeyValue(LogFields.ERROR, failure.getClass().getName());
    }

    /** The fallback line: sizes only, no parsing and no masking. */
    private LoggingEventBuilder minimalLine(ContentCachingRequestWrapper request, TeeResponseWrapper response, Throwable failure) {
        LoggingEventBuilder line = baseLine(request, response, failure);
        if (!masker.logBodies()) {
            return line;
        }
        long declared = request.getContentLengthLong();
        long written = response.bytesWritten();
        line = addIfPresent(line, LogFields.REQ_BODY, declared > 0 ? masker.placeholder(request.getContentType(), declared) : null);
        return addIfPresent(line, LogFields.RES_BODY, written > 0 ? masker.placeholder(response.getContentType(), written) : null);
    }

    /** The cached bytes, or a size placeholder when the app did not read the body or it passed the cache limit. */
    private String requestBody(ContentCachingRequestWrapper request) {
        byte[] cached = request.getContentAsByteArray();
        long declared = request.getContentLengthLong();
        if (declared > cached.length) {
            return masker.placeholder(request.getContentType(), declared);
        }
        return masker.mask(cached, request.getContentType());
    }

    /** The masked captured body, or a size placeholder for streams, files and bodies above the capture limit. */
    private String responseBody(TeeResponseWrapper response) {
        byte[] captured = response.capturedBody();
        if (captured != null) {
            return masker.mask(captured, response.getContentType());
        }
        long written = response.bytesWritten();
        return written == 0 ? null : masker.placeholder(response.getContentType(), written);
    }

    private static void putRequestContext(HttpServletRequest request) {
        Object known = request.getAttribute(REQUEST_ID_ATTRIBUTE);
        String requestId = known != null ? known.toString() : LogFields.safeRequestIdOrNew(request.getHeader(LogFields.REQUEST_ID_HEADER));
        request.setAttribute(REQUEST_ID_ATTRIBUTE, requestId);
        MDC.put(LogFields.REQUEST_ID, requestId);
        putUserContext();
    }

    /** userId and tenantId from the Jwt in the security context; removed when absent (anonymous, or before authentication). */
    static void putUserContext() {
        Optional<Jwt> jwt = currentJwt();
        putOrRemove(LogFields.USER_ID, jwt.map(Jwt::getSubject).orElse(null));
        putOrRemove(LogFields.TENANT_ID, jwt.map(token -> token.getClaimAsString(TENANT_CLAIM)).orElse(null));
    }

    private static Optional<Jwt> currentJwt() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication instanceof JwtAuthenticationToken token ? Optional.of(token.getToken()) : Optional.empty();
    }

    private static void putOrRemove(String key, String value) {
        if (value == null || value.isBlank()) {
            MDC.remove(key);
        } else {
            MDC.put(key, value);
        }
    }

    private static LoggingEventBuilder addIfPresent(LoggingEventBuilder line, String key, String value) {
        return value == null ? line : line.addKeyValue(key, value);
    }

    static Level levelFor(int status) {
        HttpStatusCode code = HttpStatusCode.valueOf(status);
        if (code.is5xxServerError()) {
            return Level.ERROR;
        }
        return code.is4xxClientError() ? Level.WARN : Level.INFO;
    }

    /**
     * Runs right after authentication and puts userId and tenantId in MDC for the rest of the request, removing them
     * again when the request leaves it. HttpLoggingFilter reads them afresh when it writes the line.
     */
    public static class UserMdc extends OncePerRequestFilter {

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            putUserContext();
            try {
                chain.doFilter(request, response);
            } finally {
                MDC.remove(LogFields.USER_ID);
                MDC.remove(LogFields.TENANT_ID);
            }
        }
    }
}
```
