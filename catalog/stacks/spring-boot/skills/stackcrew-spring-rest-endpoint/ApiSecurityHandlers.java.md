Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `ApiSecurityHandlers.java`.

```java
package {{sc:basePackage}}.common.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.server.resource.web.BearerTokenAuthenticationEntryPoint;
import org.springframework.security.oauth2.server.resource.web.access.BearerTokenAccessDeniedHandler;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.List;

/**
 * 401 and 403 answered by the security filter chain, before MVC: the same error envelope as the exception handler,
 * written through the application's ObjectMapper. The bearer-token defaults run first for their status and the
 * RFC 6750 WWW-Authenticate header. Both id headers are set again, since this is a fresh response. Register it on
 * exceptionHandling(...) and on oauth2ResourceServer(...) (an invalid token goes through the latter).
 */
@Component
public class ApiSecurityHandlers implements AuthenticationEntryPoint, AccessDeniedHandler {

    private final AuthenticationEntryPoint bearerEntryPoint = new BearerTokenAuthenticationEntryPoint();
    private final AccessDeniedHandler bearerAccessDenied = new BearerTokenAccessDeniedHandler();
    private final ObjectMapper objectMapper;
    private final String serviceNumber;

    public ApiSecurityHandlers(ObjectMapper objectMapper, ServiceNumberProperties properties) {
        this.objectMapper = objectMapper;
        this.serviceNumber = properties.serviceNumber();
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException authException)
            throws IOException, ServletException {
        bearerEntryPoint.commence(request, response, authException);
        write(CommonErrorCode.UNAUTHENTICATED, request, response);
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException accessDeniedException)
            throws IOException, ServletException {
        bearerAccessDenied.handle(request, response, accessDeniedException);
        write(CommonErrorCode.ACCESS_DENIED, request, response);
    }

    private void write(ErrorCode code, HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (response.isCommitted()) {
            return;
        }
        ErrorResponse body = GlobalExceptionHandler.errorBody(code, List.of(), serviceNumber, request, response);
        response.setStatus(code.status().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), body);
    }
}
```
