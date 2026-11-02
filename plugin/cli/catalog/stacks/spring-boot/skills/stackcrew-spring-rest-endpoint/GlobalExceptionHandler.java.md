Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `GlobalExceptionHandler.java`.

```java
package {{sc:basePackage}}.common.api;

import {{sc:basePackage}}.common.api.ApiResponse.ErrorDetail;
import {{sc:basePackage}}.common.api.ApiResponse.ErrorPayload;
import {{sc:basePackage}}.common.context.CrossTenantDeniedException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.BindException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingPathVariableException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.List;

/**
 * Every exception becomes the error envelope: status, errorNumber, errorCode and summary from the error table, never
 * from the exception. Not scoped to a package, so unknown routes, wrong methods and wrong media types (no controller
 * method was resolved) are answered here too. Anything unmapped is INTERNAL_ERROR, logged at ERROR with the stack.
 * Provider failures (skill stackcrew-spring-integration-provider) are mapped here as well: add
 * ProviderUnavailableException -> DEPENDENCY_UNAVAILABLE, and ProviderProtocolException and an unmapped
 * ProviderRejectedException -> BAD_GATEWAY.
 */
@RestControllerAdvice
@EnableConfigurationProperties(ServiceNumberProperties.class)
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private final String serviceNumber;

    public GlobalExceptionHandler(ServiceNumberProperties properties) {
        this.serviceNumber = properties.serviceNumber();
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ErrorResponse> onApiException(ApiException ex, HttpServletRequest request, HttpServletResponse response) {
        if (ex.errorCode().status().is5xxServerError()) {
            log.warn("api_error {}", ex.errorCode().code(), ex);
        }
        return failure(ex.errorCode(), ex.details(), request, response);
    }

    /** Another internal service's error envelope, passed on with its own errorNumber (skill stackcrew-spring-integration-provider). */
    @ExceptionHandler(UpstreamApiException.class)
    ResponseEntity<ErrorResponse> onUpstream(UpstreamApiException ex, HttpServletRequest request, HttpServletResponse response) {
        ApiResponseAdvice.writeIdHeaders(request, response);
        return ResponseEntity.status(ex.status()).body(ApiResponse.failure(ex.summary(), ex.payload(),
                ApiResponseAdvice.supportCode(request), ApiResponseAdvice.requestId(request)));
    }

    /** @Valid body or model attribute (MethodArgumentNotValidException is a BindException). */
    @ExceptionHandler({MethodArgumentNotValidException.class, BindException.class})
    ResponseEntity<ErrorResponse> onInvalidBody(BindException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.VALIDATION_FAILED, ValidationDetails.of(ex.getBindingResult()), request, response);
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    ResponseEntity<ErrorResponse> onInvalidParameters(HandlerMethodValidationException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.VALIDATION_FAILED, ValidationDetails.of(ex), request, response);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    ResponseEntity<ErrorResponse> onConstraintViolation(ConstraintViolationException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.VALIDATION_FAILED, ValidationDetails.of(ex.getConstraintViolations()), request, response);
    }

    /** A missing query parameter or header is query validation (VALIDATION_FAILED), not INVALID_PARAMETER. */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    ResponseEntity<ErrorResponse> onMissingParameter(MissingServletRequestParameterException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.VALIDATION_FAILED, List.of(new ErrorDetail(ex.getParameterName(), DetailCode.REQUIRED, ValidationDetails.MISSING)), request, response);
    }

    @ExceptionHandler(MissingRequestHeaderException.class)
    ResponseEntity<ErrorResponse> onMissingHeader(MissingRequestHeaderException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.VALIDATION_FAILED, List.of(new ErrorDetail(ex.getHeaderName(), DetailCode.REQUIRED, ValidationDetails.MISSING)), request, response);
    }

    /** A path variable of the wrong type is INVALID_PARAMETER; a query parameter of the wrong type is VALIDATION_FAILED. */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    ResponseEntity<ErrorResponse> onTypeMismatch(MethodArgumentTypeMismatchException ex, HttpServletRequest request, HttpServletResponse response) {
        ErrorCode code = ex.getParameter().hasParameterAnnotation(PathVariable.class) ? CommonErrorCode.INVALID_PARAMETER : CommonErrorCode.VALIDATION_FAILED;
        return failure(code, List.of(new ErrorDetail(ex.getName(), DetailCode.INVALID_TYPE, ValidationDetails.WRONG_TYPE)), request, response);
    }

    @ExceptionHandler(MissingPathVariableException.class)
    ResponseEntity<ErrorResponse> onMissingPathVariable(MissingPathVariableException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.INVALID_PARAMETER, List.of(), request, response);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ErrorResponse> onUnreadable(HttpMessageNotReadableException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.MALFORMED_REQUEST, List.of(), request, response);
    }

    /** Keeps the Accept-Post / Accept-Patch headers Spring computed. */
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ErrorResponse> onMediaType(HttpMediaTypeNotSupportedException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.UNSUPPORTED_MEDIA_TYPE, List.of(), ex.getHeaders(), request, response);
    }

    /** Keeps the Allow header a 405 must carry. */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ErrorResponse> onMethod(HttpRequestMethodNotSupportedException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.METHOD_NOT_ALLOWED, List.of(), ex.getHeaders(), request, response);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<ErrorResponse> onTooLarge(MaxUploadSizeExceededException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.PAYLOAD_TOO_LARGE, List.of(), request, response);
    }

    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
    ResponseEntity<ErrorResponse> onNoEndpoint(Exception ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.ENDPOINT_NOT_FOUND, List.of(), request, response);
    }

    /** Method security without an authenticated caller. */
    @ExceptionHandler(AuthenticationException.class)
    ResponseEntity<ErrorResponse> onUnauthenticated(AuthenticationException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.UNAUTHENTICATED, List.of(), request, response);
    }

    /** @PreAuthorize throws AuthorizationDeniedException (an AccessDeniedException) inside MVC; without this it would be a 500. */
    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ErrorResponse> onAccessDenied(AccessDeniedException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.ACCESS_DENIED, List.of(), request, response);
    }

    /** Another tenant's row answers exactly like a missing one, so no one can probe ids. */
    @ExceptionHandler(CrossTenantDeniedException.class)
    ResponseEntity<ErrorResponse> onCrossTenant(CrossTenantDeniedException ex, HttpServletRequest request, HttpServletResponse response) {
        return failure(CommonErrorCode.RESOURCE_NOT_FOUND, List.of(), request, response);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorResponse> onUnexpected(Exception ex, HttpServletRequest request, HttpServletResponse response) {
        log.error("unhandled_exception", ex);
        return failure(CommonErrorCode.INTERNAL_ERROR, List.of(), request, response);
    }

    private ResponseEntity<ErrorResponse> failure(ErrorCode code, List<ErrorDetail> details, HttpServletRequest request, HttpServletResponse response) {
        return failure(code, details, HttpHeaders.EMPTY, request, response);
    }

    private ResponseEntity<ErrorResponse> failure(ErrorCode code, List<ErrorDetail> details, HttpHeaders headers,
                                                  HttpServletRequest request, HttpServletResponse response) {
        return ResponseEntity.status(code.status()).headers(headers).body(errorBody(code, details, serviceNumber, request, response));
    }

    /** The error envelope for this service's own code; also used by ApiSecurityHandlers. Sets both id headers again. */
    static ErrorResponse errorBody(ErrorCode code, List<ErrorDetail> details, String serviceNumber,
                                   HttpServletRequest request, HttpServletResponse response) {
        ApiResponseAdvice.writeIdHeaders(request, response);
        ErrorPayload payload = new ErrorPayload(ErrorNumbers.format(serviceNumber, code), code.code(), details);
        return ApiResponse.failure(code.summary(), payload, ApiResponseAdvice.supportCode(request), ApiResponseAdvice.requestId(request));
    }
}
```
