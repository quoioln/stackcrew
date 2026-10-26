package {{sc:basePackage}}.common.persistence;

import {{sc:basePackage}}.common.context.TenantContext;
import org.hibernate.context.spi.CurrentTenantIdentifierResolver;

/**
 * Hibernate asks for the tenant once, when it opens a session (an EntityManager); the tenant then holds for that
 * session. Never returns null: Hibernate refuses to open any session without a tenant, which would also break work on
 * entities that are not tenant-scoped. "No tenant" is a marker that matches no rows.
 *
 * Spring Boot 3.2+ (Hibernate 6.4+). On Boot 3.0 and 3.1 (Hibernate 6.1, 6.2) the interface is not generic: write
 * `implements CurrentTenantIdentifierResolver` there and keep everything else, including both @Override annotations
 * (on 6.4+ the raw form turns isRoot(String) into an overload that Hibernate never calls; @Override catches that).
 */
public class JwtTenantIdentifierResolver implements CurrentTenantIdentifierResolver<String> {

    /** Matches no row: a tenant claim is never blank, and inserts without a tenant are refused. */
    static final String NO_TENANT = "~no-tenant";
    /** Only meaningful together with TenantContext.isCrossTenant(); see isRoot. */
    static final String ALL_TENANTS = "~all-tenants";

    @Override
    public String resolveCurrentTenantIdentifier() {
        if (TenantContext.isCrossTenant()) {
            return ALL_TENANTS;
        }
        return TenantContext.currentTenantId().orElse(NO_TENANT);
    }

    @Override
    public boolean validateExistingCurrentSessions() {
        return false;
    }

    /** A root session skips the tenant filter. Both checks, so a token that carries the marker as its tenant gains nothing. */
    @Override
    public boolean isRoot(String tenantId) {
        return ALL_TENANTS.equals(tenantId) && TenantContext.isCrossTenant();
    }
}
