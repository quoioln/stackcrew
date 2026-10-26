package {{sc:basePackage}}.common.logging;

import {{sc:basePackage}}.common.context.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.slf4j.event.Level;
import org.slf4j.spi.LoggingEventBuilder;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.util.ContentCachingRequestWrapper;
import org.springframework.web.util.ContentCachingResponseWrapper;
import org.springframework.web.util.WebUtils;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * One http_in line per request, with masked bodies (core-logging). Add it to the security filter chain right after
 * authentication (addFilterAfter(..., BearerTokenAuthenticationFilter.class)) so the line and every log line of the
 * request carry userId and tenantId. Requests rejected for a bad token stop before this filter.
 */
public class HttpLoggingFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(HttpLoggingFilter.class);
    private static final String START_ATTRIBUTE = HttpLoggingFilter.class.getName() + ".start";
    private static final String REQUEST_ID_ATTRIBUTE = HttpLoggingFilter.class.getName() + ".requestId";
    private static final Pattern SAFE_REQUEST_ID = Pattern.compile("[A-Za-z0-9._-]{1,64}");
    /** Bodies are parsed whole so base64 images shrink to their size; above this the line logs a size placeholder. */
    private static final int REQUEST_CACHE_LIMIT_BYTES = 2 * 1024 * 1024;
    private static final String UNMATCHED_ROUTE = "UNMATCHED";
    private static final String ACTUATOR_PATH = "/actuator";

    private final BodyMasker masker;

    public HttpLoggingFilter(BodyMasker masker) {
        this.masker = masker;
    }

    /** No line for health and metrics; no caching wrapper on SSE, which would hold the stream back. */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String accept = request.getHeader(HttpHeaders.ACCEPT);
        return request.getRequestURI().startsWith(request.getContextPath() + ACTUATOR_PATH)
                || (accept != null && accept.contains(MediaType.TEXT_EVENT_STREAM_VALUE));
    }

    /** An async request (Callable, DeferredResult) writes its line and copies its body when the async dispatch ends. */
    @Override
    protected boolean shouldNotFilterAsyncDispatch() {
        return false;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest httpRequest, HttpServletResponse httpResponse, FilterChain chain)
            throws ServletException, IOException {
        boolean firstDispatch = !isAsyncDispatch(httpRequest);
        ContentCachingRequestWrapper request = firstDispatch
                ? new ContentCachingRequestWrapper(httpRequest, REQUEST_CACHE_LIMIT_BYTES)
                : WebUtils.getNativeRequest(httpRequest, ContentCachingRequestWrapper.class);
        ContentCachingResponseWrapper response = firstDispatch
                ? new ContentCachingResponseWrapper(httpResponse)
                : WebUtils.getNativeResponse(httpResponse, ContentCachingResponseWrapper.class);
        if (request == null || response == null) {
            chain.doFilter(httpRequest, httpResponse);
            return;
        }
        if (firstDispatch) {
            request.setAttribute(START_ATTRIBUTE, System.nanoTime());
        }
        putContext(request);
        Throwable failure = null;
        try {
            chain.doFilter(request, response);
        } catch (IOException | ServletException | RuntimeException e) {
            failure = e;
            throw e;
        } finally {
            try {
                if (!isAsyncStarted(request)) {
                    writeLine(request, response, failure);
                }
            } finally {
                if (!isAsyncStarted(request)) {
                    response.copyBodyToResponse();
                }
                MDC.remove(LogFields.REQUEST_ID);
                MDC.remove(LogFields.USER_ID);
                MDC.remove(LogFields.TENANT_ID);
            }
        }
    }

    private void writeLine(ContentCachingRequestWrapper request, ContentCachingResponseWrapper response, Throwable failure) {
        int status = failure == null ? response.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR.value();
        long durationMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - (Long) request.getAttribute(START_ATTRIBUTE));
        Object route = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        LoggingEventBuilder line = log.atLevel(levelFor(status)).setMessage(LogFields.HTTP_IN)
                .addKeyValue(LogFields.EVENT, LogFields.HTTP_IN)
                .addKeyValue(LogFields.METHOD, request.getMethod())
                .addKeyValue(LogFields.ROUTE, route == null ? UNMATCHED_ROUTE : route.toString())
                .addKeyValue(LogFields.STATUS, status)
                .addKeyValue(LogFields.DURATION_MS, durationMs);
        if (failure != null) {
            line = line.addKeyValue(LogFields.ERROR, failure.getClass().getName());
        }
        if (masker.logBodies()) {
            line = addIfPresent(line, LogFields.REQ_BODY, requestBody(request));
            line = addIfPresent(line, LogFields.RES_BODY, masker.mask(response.getContentAsByteArray(), response.getContentType()));
        }
        line.log();
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

    private static void putContext(HttpServletRequest request) {
        Object known = request.getAttribute(REQUEST_ID_ATTRIBUTE);
        String requestId = known != null ? known.toString() : incomingOrNew(request.getHeader(LogFields.REQUEST_ID_HEADER));
        request.setAttribute(REQUEST_ID_ATTRIBUTE, requestId);
        MDC.put(LogFields.REQUEST_ID, requestId);
        TenantContext.currentUserId().ifPresent(userId -> MDC.put(LogFields.USER_ID, userId));
        TenantContext.currentTenantId().ifPresent(tenantId -> MDC.put(LogFields.TENANT_ID, tenantId));
    }

    /** A caller's request id is kept only when it is short and plain, so it cannot inject into the log. */
    private static String incomingOrNew(String incoming) {
        return incoming != null && SAFE_REQUEST_ID.matcher(incoming).matches() ? incoming : UUID.randomUUID().toString();
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
}
