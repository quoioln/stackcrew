package {{sc:basePackage}}.common.context;

import jakarta.persistence.EntityManagerFactory;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.spi.LoggingEventBuilder;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.function.Supplier;

/**
 * Who is calling and for which tenant. In a request both come from the JWT that Spring Security put in the security
 * context (persistence code never decodes a token). Message consumers set them with runAs, jobs with runAsSystem.
 * runCrossTenant is the only way to switch the tenant filter off.
 *
 * The static methods are read by Hibernate callbacks (resolver, auditor, @PrePersist), which are not Spring beans.
 */
@Component
public class TenantContext {

    public static final String SYSTEM_USER = "{{sc:systemUser}}";
    static final String TENANT_CLAIM = "{{sc:tenantClaim}}";
    static final String ROLES_CLAIM = "{{sc:rolesClaim}}";
    static final String CROSS_TENANT_EVENT = "cross_tenant";

    private static final Logger log = LoggerFactory.getLogger(TenantContext.class);
    private static final ThreadLocal<Scope> SCOPE = new ThreadLocal<>();

    private final Set<String> crossTenantRoles;
    private final TransactionTemplate crossTenantReads;
    private final EntityManagerFactory entityManagerFactory;

    public TenantContext(TenancyProperties properties, PlatformTransactionManager transactionManager,
                         EntityManagerFactory entityManagerFactory) {
        this.crossTenantRoles = Set.copyOf(properties.crossTenantRoles());
        this.entityManagerFactory = entityManagerFactory;
        this.crossTenantReads = new TransactionTemplate(transactionManager);
        this.crossTenantReads.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.crossTenantReads.setReadOnly(true);
    }

    /** The tenant of the current unit of work; empty when there is none (and inside runCrossTenant). */
    public static Optional<String> currentTenantId() {
        Scope scope = SCOPE.get();
        if (scope != null) {
            return Optional.ofNullable(scope.tenantId());
        }
        return currentJwt().map(jwt -> jwt.getClaimAsString(TENANT_CLAIM)).filter(tenant -> !tenant.isBlank());
    }

    public static String requireTenantId() {
        return currentTenantId().orElseThrow(MissingTenantException::new);
    }

    /** The JWT `sub`, or the user given to runAs; empty for an anonymous request. */
    public static Optional<String> currentUserId() {
        Scope scope = SCOPE.get();
        if (scope != null) {
            return Optional.ofNullable(scope.userId());
        }
        return currentJwt().map(Jwt::getSubject);
    }

    public static boolean isCrossTenant() {
        Scope scope = SCOPE.get();
        return scope != null && scope.crossTenant();
    }

    /**
     * For message consumers (headers x-tenant-id and x-user-id) and work handed to another thread: the tenant and the
     * user on whose behalf it runs. It never grants the system identity, whatever userId says (a header or a stored
     * value can carry "{{sc:systemUser}}"). Call it before the transaction starts: Hibernate reads the tenant when the
     * session opens. Not for requests, which already carry their tenant in the JWT.
     */
    public static <T> T runAs(String tenantId, String userId, Supplier<T> work) {
        requireNoRequestUser();
        return withScope(new Scope(tenantId, userId, false, false), work);
    }

    /** runAs for work that returns nothing, such as a message handler. */
    public static void runAs(String tenantId, String userId, Runnable work) {
        runAs(tenantId, userId, () -> {
            work.run();
            return null;
        });
    }

    /**
     * The system job entry: scheduled jobs and migrations run here as {{sc:systemUser}}, one tenant per unit of work
     * (null when the job touches no tenant entity). The only way to get the system identity, and with it the right to
     * call runCrossTenant without a role. Never call it from a request handler or a message consumer.
     */
    public static <T> T runAsSystem(String tenantId, Supplier<T> work) {
        requireNoRequestUser();
        return withScope(new Scope(tenantId, SYSTEM_USER, false, true), work);
    }

    /** runAsSystem for work that returns nothing. */
    public static void runAsSystem(String tenantId, Runnable work) {
        runAsSystem(tenantId, () -> {
            work.run();
            return null;
        });
    }

    /**
     * Read across tenants: allowed for the roles in app.tenancy.cross-tenant-roles and for work started with
     * runAsSystem; denied for everyone else, including a token or a runAs user whose id happens to be {{sc:systemUser}}.
     * Runs the work in a new read-only transaction, so Hibernate opens a fresh session without the tenant filter.
     * Return DTOs or projections: the entities are detached when the work returns.
     */
    public <T> T runCrossTenant(String reason, Supplier<T> work) {
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("runCrossTenant needs a short, human-readable reason");
        }
        String userId = currentUserId().orElse(null);
        String loggedReason = reason.replaceAll("[\\r\\n]", " ");
        Scope scope = SCOPE.get();
        boolean systemWork = scope != null && scope.systemJob();
        if (!systemWork && currentRoles().stream().noneMatch(crossTenantRoles::contains)) {
            log.atWarn().setMessage(CROSS_TENANT_EVENT).addKeyValue("event", CROSS_TENANT_EVENT).addKeyValue("userId", userId)
                    .addKeyValue("reason", loggedReason).addKeyValue("outcome", "denied").log();
            throw new CrossTenantDeniedException("no cross-tenant role for: " + loggedReason);
        }
        if (TransactionSynchronizationManager.hasResource(entityManagerFactory)
                && !TransactionSynchronizationManager.isActualTransactionActive()) {
            throw new IllegalStateException("runCrossTenant needs a new EntityManager, but open-in-view bound one to this"
                    + " request: set spring.jpa.open-in-view=false");
        }
        LoggingEventBuilder line = log.atInfo().setMessage(CROSS_TENANT_EVENT).addKeyValue("event", CROSS_TENANT_EVENT)
                .addKeyValue("userId", userId).addKeyValue("reason", loggedReason);
        Optional<String> tenantId = currentTenantId();
        (tenantId.isPresent() ? line.addKeyValue("tenantId", tenantId.get()) : line).log();
        return withScope(new Scope(null, userId, true, systemWork), () -> crossTenantReads.execute(status -> work.get()));
    }

    private static List<String> currentRoles() {
        if (SCOPE.get() != null) {
            return List.of();
        }
        return currentJwt().map(jwt -> jwt.getClaimAsStringList(ROLES_CLAIM)).orElse(List.of());
    }

    private static Optional<Jwt> currentJwt() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        return authentication instanceof JwtAuthenticationToken token ? Optional.of(token.getToken()) : Optional.empty();
    }

    private static <T> T withScope(Scope scope, Supplier<T> work) {
        Scope previous = SCOPE.get();
        SCOPE.set(scope);
        try {
            return work.get();
        } finally {
            if (previous == null) {
                SCOPE.remove();
            } else {
                SCOPE.set(previous);
            }
        }
    }

    private static void requireNoRequestUser() {
        if (currentJwt().isPresent()) {
            throw new IllegalStateException("runAs and runAsSystem are for consumers and jobs; a request takes its tenant from the JWT");
        }
    }

    /** systemJob is set only by runAsSystem; it is the one marker that carries the system identity. */
    private record Scope(String tenantId, String userId, boolean crossTenant, boolean systemJob) {}
}
