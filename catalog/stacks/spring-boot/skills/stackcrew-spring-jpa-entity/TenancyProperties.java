package {{sc:basePackage}}.common.context;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * app.tenancy.cross-tenant-roles: the roles (from JWT claim `{{sc:rolesClaim}}`) that may call runCrossTenant.
 * Unset or empty means only {{sc:systemUser}} may.
 */
@ConfigurationProperties("app.tenancy")
public record TenancyProperties(List<String> crossTenantRoles) {

    public TenancyProperties {
        crossTenantRoles = crossTenantRoles == null ? List.of() : List.copyOf(crossTenantRoles);
    }
}
