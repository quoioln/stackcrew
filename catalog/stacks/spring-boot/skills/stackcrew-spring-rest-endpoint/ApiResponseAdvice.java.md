Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `ApiResponseAdvice.java`.

```java
package {{sc:basePackage}}.common.api;

import {{sc:basePackage}}.common.logging.LogFields;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.MethodParameter;
import org.springframework.core.ResolvableType;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpEntity;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyEmitter;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

/**
 * Wraps what a controller of this application returns in the success envelope, with the ids HttpLoggingFilter put on
 * the request. Scoped to the application's package, so Actuator and springdoc answer as they always do. Left as is:
 * a body that already is an ApiResponse (the exception handler's), a Resource, byte[], StreamingResponseBody,
 * ResponseBodyEmitter/SseEmitter, and any method or controller annotated @RawResponse. A void handler without
 * @ResponseStatus, or a null return, arrives here with a null body and answers 200 with data null.
 */
@RestControllerAdvice(basePackages = "{{sc:basePackage}}")
public class ApiResponseAdvice implements ResponseBodyAdvice<Object> {

    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
        if (returnType.hasMethodAnnotation(RawResponse.class)
                || AnnotatedElementUtils.hasAnnotation(returnType.getContainingClass(), RawResponse.class)) {
            return false;
        }
        Class<?> bodyType = bodyType(returnType);
        return !Resource.class.isAssignableFrom(bodyType)
                && !StreamingResponseBody.class.isAssignableFrom(bodyType)
                && !ResponseBodyEmitter.class.isAssignableFrom(bodyType);
    }

    @Override
    public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType contentType,
                                  Class<? extends HttpMessageConverter<?>> converterType,
                                  ServerHttpRequest request, ServerHttpResponse response) {
        if (body instanceof ApiResponse<?> || body instanceof Resource || body instanceof byte[]) {
            return body;
        }
        HttpServletRequest servletRequest = ((ServletServerHttpRequest) request).getServletRequest();
        writeIdHeaders(servletRequest, ((ServletServerHttpResponse) response).getServletResponse());
        return ApiResponse.success(body, supportCode(servletRequest), requestId(servletRequest));
    }

    /** The declared body type: T of ResponseEntity<T> or HttpEntity<T>, else the return type. */
    private static Class<?> bodyType(MethodParameter returnType) {
        ResolvableType type = ResolvableType.forMethodParameter(returnType);
        if (HttpEntity.class.isAssignableFrom(returnType.getParameterType())) {
            type = type.as(HttpEntity.class).getGeneric(0);
        }
        Class<?> resolved = type.resolve();
        return resolved == null ? Object.class : resolved;
    }

    /** The request id HttpLoggingFilter set; a request the filter skipped (Actuator) gets a new one here. */
    static String requestId(HttpServletRequest request) {
        Object requestId = request.getAttribute(LogFields.REQUEST_ID_ATTRIBUTE);
        if (requestId == null) {
            requestId = LogFields.requestIdOrNew(null);
            request.setAttribute(LogFields.REQUEST_ID_ATTRIBUTE, requestId);
        }
        return requestId.toString();
    }

    /** The supportCode HttpLoggingFilter set; a request the filter skipped (Actuator) gets a new one here. */
    static String supportCode(HttpServletRequest request) {
        Object supportCode = request.getAttribute(LogFields.SUPPORT_CODE_ATTRIBUTE);
        if (supportCode == null) {
            supportCode = LogFields.newSupportCode();
            request.setAttribute(LogFields.SUPPORT_CODE_ATTRIBUTE, supportCode);
        }
        return supportCode.toString();
    }

    /** Sets both id headers again, so they equal the body even after a reset or when the filter did not run. */
    static void writeIdHeaders(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader(LogFields.REQUEST_ID_HEADER, requestId(request));
        response.setHeader(LogFields.SUPPORT_CODE_HEADER, supportCode(request));
    }
}
```
