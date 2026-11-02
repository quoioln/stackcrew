Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `RawResponse.java`.

```java
package {{sc:basePackage}}.common.api;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Opts a handler method, or every method of a controller, out of the envelope: ApiResponseAdvice leaves its body as
 * returned and the OpenAPI customizer documents it as is. Use it for a body whose format someone else fixed (a file,
 * a provider callback reply). Errors it throws are still error envelopes.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.TYPE})
public @interface RawResponse {
}
```
