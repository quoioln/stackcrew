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
            line(request, body, start, Level.ERROR).addKeyValue(LogFields.ERROR, e.getClass().getName()).log();
            throw e;
        }
        int status = response.getStatusCode().value();
        LoggingEventBuilder line = line(request, body, start, HttpLoggingFilter.levelFor(status))
                .addKeyValue(LogFields.STATUS, status);
        if (masker.logBodies()) {
            line = withBody(line, LogFields.RES_BODY, response.getBody().readAllBytes(), response.getHeaders().getContentType());
        }
        line.log();
        return response;
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
