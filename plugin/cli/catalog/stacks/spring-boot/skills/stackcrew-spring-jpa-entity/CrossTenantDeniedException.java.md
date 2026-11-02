Goes to `src/main/java`, package `{{sc:basePackage}}.common.context`, as `CrossTenantDeniedException.java`.

```java
package {{sc:basePackage}}.common.context;

/**
 * Cross-tenant access refused: runCrossTenant without a cross-tenant role, or a row of another tenant loaded by id.
 * GlobalExceptionHandler maps it to RESOURCE_NOT_FOUND, the same 404 envelope as a missing row: a 403 would confirm
 * that another tenant's id exists. Never echo the message to the client.
 */
public class CrossTenantDeniedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public CrossTenantDeniedException(String detail) {
        super("cross-tenant access denied: " + detail);
    }
}
```
