Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `ApiException.java`.

```java
package {{sc:basePackage}}.common.api;

import {{sc:basePackage}}.common.api.ApiResponse.ErrorDetail;

import java.util.List;

/**
 * A deliberate error: GlobalExceptionHandler answers it with the code's status, errorNumber, errorCode and summary.
 * Domain exceptions extend it with their own ErrorCode. The exception message is for logs only and never sent.
 */
public class ApiException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final transient ErrorCode errorCode;
    private final transient List<ErrorDetail> details;

    public ApiException(ErrorCode code) {
        this(code, List.of());
    }

    public ApiException(ErrorCode code, List<ErrorDetail> details) {
        super(code.code());
        this.errorCode = code;
        this.details = List.copyOf(details);
    }

    public ErrorCode errorCode() {
        return errorCode;
    }

    public List<ErrorDetail> details() {
        return details;
    }
}
```
