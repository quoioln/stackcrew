Goes to `src/main/java`, package `{{sc:basePackage}}.common.context`, as `MissingTenantException.java`.

```java
package {{sc:basePackage}}.common.context;

/** A tenant entity was written with no tenant in context. Fail closed; map it to a 500, never retry without a tenant. */
public class MissingTenantException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public MissingTenantException() {
        super("no tenant in context for a tenant-scoped entity");
    }
}
```
