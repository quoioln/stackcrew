package {{sc:basePackage}}.common.persistence;

import {{sc:basePackage}}.common.context.TenancyProperties;
import org.hibernate.cfg.AvailableSettings;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.orm.jpa.HibernatePropertiesCustomizer;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.auditing.DateTimeProvider;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

import java.time.Clock;
import java.util.Optional;

/**
 * Auditing and tenant wiring. Keep @EnableJpaAuditing here, never on the application class: slice tests such as
 * @WebMvcTest load the application class and fail when it enables JPA auditing.
 */
@Configuration(proxyBeanMethods = false)
@EnableJpaAuditing(auditorAwareRef = "jwtAuditorAware", dateTimeProviderRef = "utcDateTimeProvider")
@EnableConfigurationProperties(TenancyProperties.class)
public class PersistenceConfig {

    @Bean
    JwtAuditorAware jwtAuditorAware() {
        return new JwtAuditorAware();
    }

    /** createdAt and updatedAt from the injected Clock (UTC by default), so tests can pin time. */
    @Bean
    DateTimeProvider utcDateTimeProvider(ObjectProvider<Clock> clock) {
        return () -> Optional.of(clock.getIfAvailable(Clock::systemUTC).instant());
    }

    /** Hands the resolver to Hibernate. The resolver has no Spring dependencies, so this creates no cycle with the EntityManagerFactory. */
    @Bean
    HibernatePropertiesCustomizer tenantIdentifierResolver() {
        JwtTenantIdentifierResolver resolver = new JwtTenantIdentifierResolver();
        return properties -> properties.put(AvailableSettings.MULTI_TENANT_IDENTIFIER_RESOLVER, resolver);
    }
}
