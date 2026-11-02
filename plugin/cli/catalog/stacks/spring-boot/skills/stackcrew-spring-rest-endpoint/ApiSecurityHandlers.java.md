Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `ApiSecurityHandlers.java`.

```java
package {{sc:basePackage}}.common.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.oauth2.core.OAuth2AuthenticationException;
import org.springframework.security.oauth2.server.resource.web.access.BearerTokenAccessDeniedHandler;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.List;

/**
 * 401 and 403 answered by the security filter chain, before MVC: the same error envelope as the exception handler,
 * written through the application's ObjectMapper. Both id headers are set again, since this is a fresh response.
 * Register it on exceptionHandling(...) and on oauth2ResourceServer(...) (an invalid token goes through the latter).
 * The 401 WWW-Authenticate header is a constant: the decoder's message (for example "Jwt expired at ...") is never
 * sent as an error_description. The 403 keeps the bearer handler's constant insufficient_scope header.
 */
@Component
public class ApiSecurityHandlers implements AuthenticationEntryPoint, AccessDeniedHandler {

    private static final String BEARER = "Bearer";
    private static final String BEARER_INVALID_TOKEN = "Bearer error=\"invalid_token\"";

    private final AccessDeniedHandler bearerAccessDenied = new BearerTokenAccessDeniedHandler();
    private final ObjectMapper objectMapper;
    private final String serviceNumber;

    public ApiSecurityHandlers(ObjectMapper objectMapper, ServiceNumberProperties properties) {
        this.objectMapper = objectMapper;
        this.serviceNumber = properties.serviceNumber();
    }

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException authException)
            throws IOException {
        response.setHeader(HttpHeaders.WWW_AUTHENTICATE, authException instanceof OAuth2AuthenticationException ? BEARER_INVALID_TOKEN : BEARER);
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
