Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `InternalServiceErrors.java`.

```java
package {{sc:basePackage}}.common.api;

import {{sc:basePackage}}.common.api.ApiResponse.ErrorPayload;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.net.http.HttpTimeoutException;
import java.util.regex.Pattern;

/**
 * Turns another internal service's answer (read as a String, after retries) into data or into this service's error.
 * A 4xx envelope keeps the origin's errorNumber, errorCode and details (UpstreamApiException); a 5xx envelope is
 * passed on with status 502. Everything else is this service's own group-80 error, never a pass-through:
 * upstream timeout GATEWAY_TIMEOUT; refused, reset, 5xx without an envelope, 401 or 403 DEPENDENCY_UNAVAILABLE;
 * 2xx or 4xx with a body that is not an envelope BAD_GATEWAY.
 */
public final class InternalServiceErrors {

    private static final Pattern ERROR_NUMBER = Pattern.compile("\\d{7}");
    private static final int MAX_CAUSE_DEPTH = 10;

    private InternalServiceErrors() {}

    /** The data of a success envelope; otherwise throws as described on the class. */
    public static <T> T unwrap(ResponseEntity<String> response, Class<T> dataType, ObjectMapper mapper) {
        HttpStatusCode code = response.getStatusCode();
        int status = code.value();
        if (status == HttpStatus.UNAUTHORIZED.value() || status == HttpStatus.FORBIDDEN.value()) {
            throw new ApiException(CommonErrorCode.DEPENDENCY_UNAVAILABLE);   // our credential or its permissions, not the caller's fault
        }
        if (code.is2xxSuccessful()) {
            JavaType type = mapper.getTypeFactory().constructParametricType(Success.class, dataType);
            Success<T> success = read(response.getBody(), type, mapper);
            if (success == null || !Boolean.TRUE.equals(success.success())) {
                throw new ApiException(CommonErrorCode.BAD_GATEWAY);
            }
            return success.data();
        }
        Failure failure = read(response.getBody(), mapper.constructType(Failure.class), mapper);
        if (failure != null && Boolean.FALSE.equals(failure.success()) && isError(failure.error())
                && (code.is4xxClientError() || code.is5xxServerError())) {
            HttpStatus resolved = HttpStatus.resolve(status);
            if (resolved == null && code.is4xxClientError()) {
                throw new ApiException(CommonErrorCode.BAD_GATEWAY);
            }
            throw new UpstreamApiException(code.is5xxServerError() ? HttpStatus.BAD_GATEWAY : resolved, failure.error(),
                    failure.message() == null ? failure.error().errorCode() : failure.message());
        }
        throw new ApiException(code.is5xxServerError() ? CommonErrorCode.DEPENDENCY_UNAVAILABLE : CommonErrorCode.BAD_GATEWAY);
    }

    /** A timeout is GATEWAY_TIMEOUT; connection refused or reset, and anything else, DEPENDENCY_UNAVAILABLE. */
    public static ApiException onTransportFailure(Throwable cause) {
        ApiException error = new ApiException(isTimeout(cause) ? CommonErrorCode.GATEWAY_TIMEOUT : CommonErrorCode.DEPENDENCY_UNAVAILABLE);
        error.initCause(cause);
        return error;
    }

    private static boolean isTimeout(Throwable cause) {
        Throwable current = cause;
        for (int depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth++, current = current.getCause()) {
            if (current instanceof SocketTimeoutException || current instanceof HttpTimeoutException) {
                return true;
            }
        }
        return false;
    }

    private static boolean isError(ErrorPayload error) {
        return error != null && error.errorNumber() != null && ERROR_NUMBER.matcher(error.errorNumber()).matches()
                && error.errorCode() != null && !error.errorCode().isBlank();
    }

    /** null when the body is empty or not JSON of that shape: the caller decides what that means. */
    private static <R> R read(String body, JavaType type, ObjectMapper mapper) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            return mapper.readValue(body, type);
        } catch (IOException | RuntimeException notAnEnvelope) {
            return null;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Success<T>(Boolean success, T data) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Failure(Boolean success, String message, ErrorPayload error) {}
}
```
