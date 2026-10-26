Goes to `src/main/java`, package `{{sc:basePackage}}.common.persistence`, as `{{sc:baseTenantEntity}}.java`.

```java
package {{sc:basePackage}}.common.persistence;

import {{sc:basePackage}}.common.context.CrossTenantDeniedException;
import {{sc:basePackage}}.common.context.TenantContext;
import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PrePersist;
import org.hibernate.annotations.TenantId;

/**
 * Base of every tenant-scoped entity. Hibernate's @TenantId adds the current tenant to every HQL, JPQL, Criteria and
 * derived query, including bulk update and delete, and assigns the tenant on insert. Native SQL is NOT filtered.
 * Save this file as {{sc:baseTenantEntity}}.java.
 */
@MappedSuperclass
public abstract class {{sc:baseTenantEntity}} extends {{sc:baseEntity}} {

    @TenantId
    @Column(nullable = false, updatable = false, length = 64)
    private String {{sc:tenantColumn}};

    public String getTenant() {
        return {{sc:tenantColumn}};
    }

    /**
     * Fail closed. With no tenant, Hibernate would store the resolver's no-tenant marker, so the insert is refused.
     * Inside runCrossTenant there is no current tenant either, which keeps cross-tenant work read-only.
     */
    @PrePersist
    void requireTenantOnInsert() {
        TenantContext.requireTenantId();
    }

    /**
     * Fail closed on loads by id. Before Hibernate 6.6 (Spring Boot 3.4) the tenant filter skips them, so findById,
     * deleteById, delete and the merge inside save could reach another tenant's row. Hibernate 6.6 filters them itself.
     */
    @PostLoad
    void requireSameTenantOnLoad() {
        if (!TenantContext.isCrossTenant() && !{{sc:tenantColumn}}.equals(TenantContext.currentTenantId().orElse(null))) {
            throw new CrossTenantDeniedException("a row of another tenant was loaded");
        }
    }
}
```
