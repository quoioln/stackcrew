Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `EnvelopeErrorController.java`.

```java
package {{sc:basePackage}}.common.api;

import jakarta.servlet.RequestDispatcher;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.servlet.error.ErrorController;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The error page (/error) as the error envelope, in place of Spring Boot's BasicErrorController (which steps aside
 * when an ErrorController bean exists). It answers what never reached a controller or escaped MVC: an exception
 * thrown by a filter, a request the firewall rejected with sendError(400), a container error. The code comes from
 * the status attribute through CommonErrorCode.forStatus; the error message attribute is never sent. The ids are the
 * request's (new ones when the filter did not run) and both headers are set again. The security chain must permit
 * the ERROR dispatch (dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()), or it answers 401 instead.
 */
@RestController
@RequestMapping("${server.error.path:${error.path:/error}}")
public class EnvelopeErrorController implements ErrorController {

    private static final Logger log = LoggerFactory.getLogger(EnvelopeErrorController.class);

    private final String serviceNumber;

    public EnvelopeErrorController(ServiceNumberProperties properties) {
        this.serviceNumber = properties.serviceNumber();
    }

    @RequestMapping
    ResponseEntity<ErrorResponse> error(HttpServletRequest request, HttpServletResponse response) {
        int status = request.getAttribute(RequestDispatcher.ERROR_STATUS_CODE) instanceof Integer value ? value : 500;
        CommonErrorCode code = CommonErrorCode.forStatus(status);
        if (code == CommonErrorCode.INTERNAL_ERROR && request.getAttribute(RequestDispatcher.ERROR_EXCEPTION) instanceof Throwable failure) {
            log.error("unhandled_exception", failure);
        }
        return ResponseEntity.status(code.status()).body(GlobalExceptionHandler.errorBody(code, List.of(), serviceNumber, request, response));
    }
}
```
