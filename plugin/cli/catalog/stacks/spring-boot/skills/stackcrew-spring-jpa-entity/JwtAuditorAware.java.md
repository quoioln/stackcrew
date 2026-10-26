Goes to `src/main/java`, package `{{sc:basePackage}}.common.persistence`, as `JwtAuditorAware.java`.

```java
package {{sc:basePackage}}.common.persistence;

import {{sc:basePackage}}.common.context.TenantContext;
import org.springframework.data.domain.AuditorAware;

import java.util.Optional;

/** createdBy and updatedBy: the JWT `sub`, the user set by TenantContext.runAs, or {{sc:systemUser}} when there is none. */
public class JwtAuditorAware implements AuditorAware<String> {

    @Override
    public Optional<String> getCurrentAuditor() {
        return Optional.of(TenantContext.currentUserId().orElse(TenantContext.SYSTEM_USER));
    }
}
```
