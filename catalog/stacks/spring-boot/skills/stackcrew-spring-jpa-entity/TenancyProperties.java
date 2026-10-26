package {{sc:basePackage}}.common.context;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * app.tenancy.cross-tenant-roles: the roles (from JWT claim `{{sc:rolesClaim}}`) that may call runCrossTenant, written
 * in application.yml from conventions.crossTenantRoles ({{sc:crossTenantRoles}}). The yml is the single source: there
 * is no default in code, and unset or empty grants no role (only runAsSystem jobs may then read across tenants).
 */
@ConfigurationProperties("app.tenancy")
public record TenancyProperties(List<String> crossTenantRoles) {

    public TenancyProperties {
        crossTenantRoles = crossTenantRoles == null ? List.of() : List.copyOf(crossTenantRoles);
    }
}
