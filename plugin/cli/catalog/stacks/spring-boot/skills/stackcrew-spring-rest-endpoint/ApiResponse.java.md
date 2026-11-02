Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `ApiResponse.java`.

```java
package {{sc:basePackage}}.common.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * The one body shape of every API response (core rule backend-api). ApiResponseAdvice and GlobalExceptionHandler build
 * it; a controller returns its data or throws, and never builds an envelope. Success and error are two types: a success
 * keeps the data key when data is null, and an error has no data key at all. Their constructors are package-private,
 * so the two factories below are the only way to build one.
 */
public sealed interface ApiResponse<T> permits SuccessResponse, ErrorResponse {

    static <T> SuccessResponse<T> success(T data, String supportCode, String requestId) {
        return new SuccessResponse<>(true, now(), supportCode, requestId, data);
    }

    /** summary is the error table's fixed text (JSON key message), never an exception message. */
    static ErrorResponse failure(String summary, ErrorPayload error, String supportCode, String requestId) {
        return new ErrorResponse(false, summary, now(), supportCode, requestId, error);
    }

    /** ISO-8601 UTC with milliseconds; Jackson writes an Instant as that string (Spring Boot disables numeric dates). */
    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MILLIS);
    }

    /** errorNumber is SSCCNNN of the service that raised the error; an upstream error keeps the upstream's number. */
    record ErrorPayload(String errorNumber, String errorCode, List<ErrorDetail> details) {
        public ErrorPayload {
            details = details == null ? List.of() : List.copyOf(details);
        }
    }

    /** One per (field, constraint). field is a dotted path with [index] for list items, or null; message never holds the submitted value. */
    record ErrorDetail(@JsonInclude(JsonInclude.Include.ALWAYS) String field, String code, String message) {
        public ErrorDetail(String field, DetailCode code, String message) {
            this(field, code.name(), message);
        }
    }
}

@JsonPropertyOrder({"success", "timestamp", "supportCode", "requestId", "data"})
record SuccessResponse<T>(boolean success, Instant timestamp, String supportCode, String requestId,
                          @JsonInclude(JsonInclude.Include.ALWAYS) T data) implements ApiResponse<T> {
}

@JsonPropertyOrder({"success", "message", "timestamp", "supportCode", "requestId", "error"})
record ErrorResponse(boolean success, @JsonProperty("message") String summary, Instant timestamp, String supportCode,
                     String requestId, ApiResponse.ErrorPayload error) implements ApiResponse<Void> {
}
```
