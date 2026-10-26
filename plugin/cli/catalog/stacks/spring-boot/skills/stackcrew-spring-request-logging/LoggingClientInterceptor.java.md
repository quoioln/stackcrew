Goes to `src/main/java`, package `{{sc:basePackage}}.common.logging`, as `LoggingClientInterceptor.java`.

```java
package {{sc:basePackage}}.common.logging;

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

/**
 * One http_out line per outbound call, with masked bodies. One instance per client, named after the target service.
 * The client MUST use a BufferingClientHttpRequestFactory: this interceptor reads the response body, and without
 * buffering the caller would then get an empty body.
 */
public class LoggingClientInterceptor implements ClientHttpRequestInterceptor {

    private static final Logger log = LoggerFactory.getLogger(LoggingClientInterceptor.class);

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
        if (masker.logBodies()) {
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
        logSafely(() -> withBody(line(request, body, start, level).addKeyValue(LogFields.STATUS, status), LogFields.RES_BODY, readBody,
                response.getHeaders().getContentType()), request, start, level, status);
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
                logFailure.addSuppressed(minimalFailure);
                LogFields.warnLineNotWritten(LogFields.HTTP_OUT, logFailure);
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

    /** Scheme, host, port and path only: the query string and user info can carry secrets or PII. */
    static String sanitize(URI uri) {
        return UriComponentsBuilder.fromUri(uri).userInfo(null).replaceQuery(null).fragment(null).build().toUriString();
    }
}
```
