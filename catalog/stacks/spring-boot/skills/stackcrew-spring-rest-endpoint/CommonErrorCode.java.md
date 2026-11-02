Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `CommonErrorCode.java`.

```java
package {{sc:basePackage}}.common.api;

import org.springframework.http.HttpStatus;

/** The common error table, identical in every stack. ErrorNumbers.format adds the service number. */
public enum CommonErrorCode implements ErrorCode {

    VALIDATION_FAILED(10, 1, "VALIDATION_FAILED", HttpStatus.BAD_REQUEST, "Request validation failed"),
    MALFORMED_REQUEST(11, 1, "MALFORMED_REQUEST", HttpStatus.BAD_REQUEST, "The request body is malformed"),
    METHOD_NOT_ALLOWED(11, 2, "METHOD_NOT_ALLOWED", HttpStatus.METHOD_NOT_ALLOWED, "The HTTP method is not supported"),
    UNSUPPORTED_MEDIA_TYPE(11, 3, "UNSUPPORTED_MEDIA_TYPE", HttpStatus.UNSUPPORTED_MEDIA_TYPE, "The content type is not supported"),
    INVALID_PARAMETER(11, 4, "INVALID_PARAMETER", HttpStatus.BAD_REQUEST, "A query or path parameter is invalid"),
    PAYLOAD_TOO_LARGE(11, 5, "PAYLOAD_TOO_LARGE", HttpStatus.PAYLOAD_TOO_LARGE, "The request body is too large"),
    ENDPOINT_NOT_FOUND(11, 6, "ENDPOINT_NOT_FOUND", HttpStatus.NOT_FOUND, "The endpoint does not exist"),
    UNAUTHENTICATED(20, 1, "UNAUTHENTICATED", HttpStatus.UNAUTHORIZED, "Authentication is required"),
    ACCESS_DENIED(21, 1, "ACCESS_DENIED", HttpStatus.FORBIDDEN, "You are not allowed to do this"),
    RESOURCE_NOT_FOUND(30, 1, "RESOURCE_NOT_FOUND", HttpStatus.NOT_FOUND, "The resource does not exist"),
    BUSINESS_CONFLICT(40, 1, "BUSINESS_CONFLICT", HttpStatus.CONFLICT, "The request conflicts with the current state"),
    BUSINESS_RULE_VIOLATION(41, 1, "BUSINESS_RULE_VIOLATION", HttpStatus.UNPROCESSABLE_ENTITY, "The request violates a business rule"),
    RATE_LIMIT_EXCEEDED(50, 1, "RATE_LIMIT_EXCEEDED", HttpStatus.TOO_MANY_REQUESTS, "Too many requests"),
    DEPENDENCY_UNAVAILABLE(80, 1, "DEPENDENCY_UNAVAILABLE", HttpStatus.SERVICE_UNAVAILABLE, "A required service is unavailable"),
    BAD_GATEWAY(80, 2, "BAD_GATEWAY", HttpStatus.BAD_GATEWAY, "An upstream service returned an invalid response"),
    GATEWAY_TIMEOUT(80, 3, "GATEWAY_TIMEOUT", HttpStatus.GATEWAY_TIMEOUT, "An upstream service did not respond in time"),
    INTERNAL_ERROR(90, 1, "INTERNAL_ERROR", HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred");

    private final int category;
    private final int seq;
    private final String code;
    private final HttpStatus status;
    private final String summary;

    CommonErrorCode(int category, int seq, String code, HttpStatus status, String summary) {
        this.category = category;
        this.seq = seq;
        this.code = code;
        this.status = status;
        this.summary = summary;
    }

    /**
     * The one status-to-code mapping for errors that carry only an HTTP status: the error page (EnvelopeErrorController)
     * and framework exceptions with their own 4xx status. Any other 4xx is INVALID_PARAMETER, anything else INTERNAL_ERROR.
     */
    public static CommonErrorCode forStatus(int status) {
        return switch (status) {
            case 401 -> UNAUTHENTICATED;
            case 403 -> ACCESS_DENIED;
            case 404 -> ENDPOINT_NOT_FOUND;
            case 405 -> METHOD_NOT_ALLOWED;
            case 409 -> BUSINESS_CONFLICT;
            case 413 -> PAYLOAD_TOO_LARGE;
            case 415 -> UNSUPPORTED_MEDIA_TYPE;
            case 422 -> BUSINESS_RULE_VIOLATION;
            case 429 -> RATE_LIMIT_EXCEEDED;
            default -> status >= 400 && status < 500 ? INVALID_PARAMETER : INTERNAL_ERROR;
        };
    }

    @Override
    public int category() {
        return category;
    }

    @Override
    public int seq() {
        return seq;
    }

    @Override
    public String code() {
        return code;
    }

    @Override
    public HttpStatus status() {
        return status;
    }

    @Override
    public String summary() {
        return summary;
    }
}
```
