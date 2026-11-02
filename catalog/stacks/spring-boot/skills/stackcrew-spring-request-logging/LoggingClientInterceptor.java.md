Goes to `src/main/java`, package `{{sc:basePackage}}.common.logging`, as `LoggingClientInterceptor.java`.

```java
package {{sc:basePackage}}.common.logging;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.event.Level;
import org.slf4j.spi.LoggingEventBuilder;
import org.springframework.http.HttpRequest;
import org.springframework.http.MediaType;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.web.util.UriComponentsBuilder;

import java.io.IOException;
import java.net.URI;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * One http_out line per outbound call, with masked bodies. One instance per client, named after the target service.
 * The client MUST use a BufferingClientHttpRequestFactory: this interceptor reads the response body, and without
 * buffering the caller would then get an empty body.
 */
public class LoggingClientInterceptor implements ClientHttpRequestInterceptor {

    private static final Logger log = LoggerFactory.getLogger(LoggingClientInterceptor.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern ERROR_NUMBER = Pattern.compile("\\d{7}");
    private static final Pattern SUPPORT_CODE = Pattern.compile("[A-Z]{6}");
    private static final Pattern SAFE_ID = Pattern.compile("[A-Za-z0-9._-]{1,64}");

    private final String target;
    private final BodyMasker masker;

    public LoggingClientInterceptor(String target, BodyMasker masker) {
        this.target = target;
        this.masker = masker;
    }

    @Override
    public ClientHttpResponse intercept(HttpRequest request, byte[] body, ClientHttpRequestExecution execution)
            throws IOException {
        long start = System.nanoTime();
        ClientHttpResponse response;
        try {
            response = execution.execute(request, body);
        } catch (IOException | RuntimeException e) {
            logSafely(() -> line(request, body, start, Level.ERROR).addKeyValue(LogFields.ERROR, e.getClass().getName()),
                    request, start, Level.ERROR, null);
            throw e;
        }
        int status = response.getStatusCode().value();
        Level level = HttpLoggingFilter.levelFor(status);
        byte[] responseBody = null;
        MediaType responseType = response.getHeaders().getContentType();
        if (masker.logBodies() || BodyMasker.isMaskable(responseType == null ? null : responseType.toString())) { // JSON is read for the upstream ids too
            try {
                responseBody = response.getBody().readAllBytes();
            } catch (IOException | RuntimeException e) {
                // the body broke off (connection reset, read timeout): still one line, with the status and no body
                logSafely(() -> line(request, body, start, Level.ERROR).addKeyValue(LogFields.STATUS, status)
                        .addKeyValue(LogFields.ERROR, e.getClass().getName()), request, start, Level.ERROR, status);
                throw e;
            }
        }
        byte[] readBody = responseBody;
        logSafely(() -> withResponse(line(request, body, start, level).addKeyValue(LogFields.STATUS, status), readBody, responseType),
                request, start, level, status);
        return response;
    }

    /**
     * Logging never throws (core-logging): when building or writing the line fails, a line without bodies is written,
     * and the call's result is unchanged.
     */
    private void logSafely(Supplier<LoggingEventBuilder> line, HttpRequest request, long start, Level level, Integer status) {
        try {
            line.get().log();
        } catch (RuntimeException logFailure) {
            try {
                LoggingEventBuilder minimal = log.atLevel(level).setMessage(LogFields.HTTP_OUT)
                        .addKeyValue(LogFields.EVENT, LogFields.HTTP_OUT)
                        .addKeyValue(LogFields.TARGET, target)
                        .addKeyValue(LogFields.METHOD, request.getMethod().name())
                        .addKeyValue(LogFields.DURATION_MS, TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start));
                (status == null ? minimal : minimal.addKeyValue(LogFields.STATUS, status)).log();
            } catch (RuntimeException minimalFailure) {
                // the logging backend itself fails: never replace the call's own result or exception
                LogFields.warnLineNotWritten(LogFields.HTTP_OUT, logFailure, minimalFailure);
            }
        }
    }

    private LoggingEventBuilder line(HttpRequest request, byte[] body, long start, Level level) {
        LoggingEventBuilder line = log.atLevel(level).setMessage(LogFields.HTTP_OUT)
                .addKeyValue(LogFields.EVENT, LogFields.HTTP_OUT)
                .addKeyValue(LogFields.TARGET, target)
                .addKeyValue(LogFields.METHOD, request.getMethod().name())
                .addKeyValue(LogFields.URL, sanitize(request.getURI()))
                .addKeyValue(LogFields.DURATION_MS, TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start));
        return masker.logBodies() ? withBody(line, LogFields.REQ_BODY, body, request.getHeaders().getContentType()) : line;
    }

    private LoggingEventBuilder withBody(LoggingEventBuilder line, String key, byte[] body, MediaType type) {
        String masked = masker.mask(body, type == null ? null : type.toString());
        return masked == null ? line : line.addKeyValue(key, masked);
    }

    private LoggingEventBuilder withResponse(LoggingEventBuilder line, byte[] body, MediaType type) {
        LoggingEventBuilder out = masker.logBodies() ? withBody(line, LogFields.RES_BODY, body, type) : line;
        return body == null ? out : withUpstreamIds(out, body);
    }

    /**
     * When the body is another internal service's envelope, its ids go on the line, so one search finds both sides.
     * Each value is checked first: it comes from outside and goes into a log line.
     */
    private static LoggingEventBuilder withUpstreamIds(LoggingEventBuilder line, byte[] body) {
        UpstreamEnvelope envelope;
        try {
            envelope = JSON.readValue(body, UpstreamEnvelope.class);
        } catch (IOException | RuntimeException notAnEnvelope) {
            return line;
        }
        if (envelope == null || envelope.success() == null || !matches(SUPPORT_CODE, envelope.supportCode())
                || !matches(SAFE_ID, envelope.requestId())) {
            return line;
        }
        LoggingEventBuilder out = line.addKeyValue(LogFields.UPSTREAM_SUPPORT_CODE, envelope.supportCode())
                .addKeyValue(LogFields.UPSTREAM_REQUEST_ID, envelope.requestId());
        return envelope.error() != null && matches(ERROR_NUMBER, envelope.error().errorNumber())
                ? out.addKeyValue(LogFields.UPSTREAM_ERROR_NUMBER, envelope.error().errorNumber()) : out;
    }

    private static boolean matches(Pattern pattern, String value) {
        return value != null && pattern.matcher(value).matches();
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record UpstreamEnvelope(Boolean success, String supportCode, String requestId, UpstreamError error) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record UpstreamError(String errorNumber) {}

    /** Scheme, host, port and path only: the query string and user info can carry secrets or PII. */
    static String sanitize(URI uri) {
        return UriComponentsBuilder.fromUri(uri).userInfo(null).replaceQuery(null).fragment(null).build().toUriString();
    }
}
```
