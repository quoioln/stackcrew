Goes to `src/main/java`, package `{{sc:basePackage}}.common.api`, as `ServiceNumberProperties.java`.

```java
package {{sc:basePackage}}.common.api;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * app.service-number: the two-digit SS of every errorNumber this service raises. Missing or not two digits, the
 * application does not start. Quote it in YAML ("07"): an unquoted 07 is read as the number 7.
 */
@Validated
@ConfigurationProperties("app")
public record ServiceNumberProperties(@Pattern(regexp = "\\d{2}") @NotNull String serviceNumber) {
}
```
