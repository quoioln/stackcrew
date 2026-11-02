Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `UpstreamApiException.java`.

```java
package {{sc:basePackage}}.common.api;

import {{sc:basePackage}}.common.api.ApiResponse.ErrorPayload;
import org.springframework.http.HttpStatus;

/**
 * An error envelope from another internal service, passed on unchanged: its errorNumber, errorCode, details and
 * summary stay, so the number still names the service that raised it. status is the upstream 4xx, or 502 for an
 * upstream 5xx. The root supportCode, requestId and timestamp are this service's. It is the only error that does not
 * carry this service's number.
 */
public class UpstreamApiException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final HttpStatus status;
    private final transient ErrorPayload payload;
    private final String summary;

    public UpstreamApiException(HttpStatus status, ErrorPayload payload, String summary) {
        super("upstream error " + payload.errorNumber() + " " + payload.errorCode());
        this.status = status;
        this.payload = payload;
        this.summary = summary;
    }

    public HttpStatus status() {
        return status;
    }

    public ErrorPayload payload() {
        return payload;
    }

    public String summary() {
        return summary;
    }
}
```
