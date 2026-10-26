---
name: stackcrew-spring-jpa-entity
description: Use when adding or changing a JPA entity in a Spring Boot service: the entity class, its Flyway or Liquibase migration, the shared base classes with the four audit fields, tenant isolation with Hibernate @TenantId, cross-tenant reads, and the audit and tenant tests.
kind: task
---
# Add a JPA entity (Spring Boot 3)

Implements `core-persistence` with Spring Data JPA auditing and Hibernate `@TenantId`. Write the SC-PREFLIGHT note first: the entity and its table, whether it is tenant-scoped, and which of the pieces below already exist.

## 1. Find the shared pieces before writing any

Search the codebase and the shared libraries ({{sc:sharedLibraries}}) for `{{sc:baseEntity}}`, `{{sc:baseTenantEntity}}`, `TenantContext`, an `AuditorAware` bean, `@EnableJpaAuditing` and a `CurrentTenantIdentifierResolver`. Use what exists. Create only what is missing, once, in the shared packages (defaults: `{{sc:basePackage}}.common.persistence` and `{{sc:basePackage}}.common.context`), from the files next to this skill:

| File | What it does |
|---|---|
| `BaseEntity.java`, saved as `{{sc:baseEntity}}.java` | `@MappedSuperclass` + `@EntityListeners(AuditingEntityListener.class)` with `createdAt`, `createdBy`, `updatedAt`, `updatedBy`. No id, no setters. |
| `BaseTenantEntity.java`, saved as `{{sc:baseTenantEntity}}.java` | Extends `{{sc:baseEntity}}`, adds the `@TenantId` field `{{sc:tenantColumn}}`; refuses inserts without a tenant and loads of another tenant's row. |
| `PersistenceConfig.java` | `@EnableJpaAuditing`, a UTC `DateTimeProvider` from the `Clock`, and the `HibernatePropertiesCustomizer` that registers the resolver. |
| `JwtAuditorAware.java` | `createdBy`/`updatedBy` = JWT `sub`, the `runAs` user, or `{{sc:systemUser}}`. |
| `JwtTenantIdentifierResolver.java` | Tenant for each Hibernate session; a no-tenant marker instead of null; `isRoot` for cross-tenant reads. |
| `TenantContext.java`, `TenancyProperties.java` | Tenant, user and roles from the JWT (claims `{{sc:tenantClaim}}`, `sub`, `{{sc:rolesClaim}}`); `runAs` for consumers and jobs; `runCrossTenant`. |
| `MissingTenantException.java`, `CrossTenantDeniedException.java` | The two fail-closed errors. |

- `TenantContext` reads the `Jwt` that Spring Security put in the security context (`spring-boot-starter-oauth2-resource-server`). Persistence code never decodes a token.
- **Spring Boot 3.0 and 3.1** (Hibernate 6.1, 6.2): `CurrentTenantIdentifierResolver` is not generic there. Write `implements CurrentTenantIdentifierResolver` and keep the rest, both `@Override` annotations included. On Boot 3.2+ keep `CurrentTenantIdentifierResolver<String>`: the raw form compiles there only without `@Override`, and then Hibernate never calls `isRoot(String)`.

## 2. Configuration

Set `app.tenancy.cross-tenant-roles` to the roles allowed to read across tenants: {{sc:crossTenantRoles}}. Leave it empty when that says none; `{{sc:systemUser}}` is always allowed.

```yaml
spring:
  jpa:
    open-in-view: false          # Hibernate picks the tenant when a session opens; runCrossTenant needs a fresh one
    hibernate:
      ddl-auto: validate         # the migration owns the schema
app:
  tenancy:
    cross-tenant-roles: []       # the roles listed above
```

## 3. The entity

```java
@Entity
@Table(name = "verification")
public class Verification extends {{sc:baseTenantEntity}} {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, length = 64)
    private String reference;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private VerificationStatus status;

    protected Verification() {
        // for JPA
    }

    public Verification(String reference) {
        this.reference = reference;
        this.status = VerificationStatus.PENDING;
    }

    public void approve() {
        this.status = VerificationStatus.APPROVED;
    }

    public UUID getId() {
        return id;
    }

    public String getReference() {
        return reference;
    }

    public VerificationStatus getStatus() {
        return status;
    }
}
```

- Tenant data extends `{{sc:baseTenantEntity}}`; everything else extends `{{sc:baseEntity}}`. `StackcrewArchitectureTest` (SC-ENTITY) fails on an `@Entity` that extends neither.
- Never redeclare the audit fields or the tenant field, never add setters for them, never put them in a request DTO.
- The id strategy is the entity's choice (`@GeneratedValue` UUID here). A plain class: no Lombok `@Data`, `@Builder` or `@AllArgsConstructor`; a protected no-arg constructor for JPA.
- Status values are an enum stored as `STRING`.

## 4. The migration

Flyway, `src/main/resources/db/migration/V<n>__create_verification.sql`. Column names follow Spring Boot's naming strategy (snake_case): the tenant column is the snake_case of `{{sc:tenantColumn}}`.

```sql
create table verification (
    id         uuid         primary key,
    tenant_id  varchar(64)  not null,
    reference  varchar(64)  not null,
    status     varchar(16)  not null,
    created_at timestamptz  not null,
    created_by varchar(128) not null,
    updated_at timestamptz  not null,
    updated_by varchar(128) not null
);

create index verification_tenant_id_idx on verification (tenant_id);
```

- Times are `timestamptz` (UTC `Instant`). Every query of a tenant table filters on the tenant column, so it leads each index used by a hot query (`(tenant_id, status)` rather than `(status)`).
- Liquibase: the same columns in a changeSet, with `TIMESTAMP WITH TIME ZONE` for the two times. Never edit an applied migration; add a new one.

## 5. Repository and queries

```java
public interface VerificationRepository extends JpaRepository<Verification, UUID> {

    Page<Verification> findByStatus(VerificationStatus status, Pageable pageable);
}
```

- Hibernate adds the tenant to derived queries, JPQL and Criteria, `count`, `existsById`, and to `@Modifying` JPQL `update` and `delete`. Never write `where v.tenantId = :tenant` yourself.
- Load by id (`findById`, `deleteById`, `delete`, the merge inside `save`): Hibernate 6.6 (Spring Boot 3.4+) filters it and returns nothing. Before 6.6 it loads any tenant's row; the `@PostLoad` guard in `{{sc:baseTenantEntity}}` then throws `CrossTenantDeniedException`, so the row never leaves the session. Keep the guard on every version.
- **Native SQL on a tenant table is banned**: `nativeQuery = true`, `JdbcTemplate`, `JdbcClient`, `EntityManager.createNativeQuery`. Hibernate does not filter it. There is no exception to this rule; cross-tenant reads use `runCrossTenant` with JPQL.
- A bulk JPQL `update` skips the auditing listener: set `updatedAt` and `updatedBy` in the statement and prove it with a test, or load, change and save.
- Every list query takes a `Pageable`.

## 6. Where the tenant comes from

- **Request:** the JWT, through Spring Security. Nothing to do. With `open-in-view=false` Hibernate reads the tenant when each transaction starts.
- **Message consumer:** producers always send the headers `x-tenant-id`, `x-user-id` and `x-request-id`. The listener sets the context before any transaction starts, so the listener method itself is not `@Transactional`:

```java
TenantContext.runAs(tenantIdHeader, userIdHeader, () -> verificationService.handle(command));
```

- **Job:** `TenantContext.runAs(tenantId, TenantContext.SYSTEM_USER, ...)` for each tenant, one unit of work each.
- **Another thread** (`@Async`, an executor): the context does not follow. Pass the tenant and user ids and call `runAs` there.
- **No tenant:** reads return no rows, inserts throw `MissingTenantException`. Never catch it to retry without a tenant.
- `runAs` refuses to run inside a request that has a JWT: a request cannot switch tenants.

## 7. Cross-tenant reads

```java
List<VolumeRow> rows = tenantContext.runCrossTenant("monthly volume report", () -> reports.volumeByTenant());
```

- `runCrossTenant` checks the caller (roles in `app.tenancy.cross-tenant-roles`, from claim `{{sc:rolesClaim}}`, or the user `{{sc:systemUser}}`), logs `event=cross_tenant` with `userId`, `tenantId` and `reason`, and runs the work in a new read-only transaction whose session has no tenant filter (`isRoot`). Anyone else gets `CrossTenantDeniedException`.
- Map `CrossTenantDeniedException` to the same 404 `ProblemDetail` as a missing row. Before Hibernate 6.6 it is also what a lookup of another tenant's id throws (section 5), and a 403 there would confirm that the id exists; a 404 also gives the same answer on every Boot version.
- The reason is a short, human-readable sentence; it is in the log.
- Read only: an insert inside throws `MissingTenantException`. Return DTOs or projections; entities are detached when the work returns.
- It works inside an outer `@Transactional` (the new transaction suspends it). It throws `IllegalStateException` when open-in-view bound an `EntityManager` to the request.
- `isRoot` is honored from Hibernate 6.1.5 (Spring Boot 3.0.0) on, so every Boot 3.x uses this one path. Do not add a second bypass: no native SQL, no second resolver, no flag that skips the filter.

## 8. Tests

Write the tests from `stackcrew-spring-boot-testing` ("Entity base, audit and tenant isolation"), against Testcontainers Postgres:

- the four audit fields on insert and on update, and `{{sc:systemUser}}` without a user;
- tenant B cannot read, count, find by id or delete tenant A's row, and no tenant reads nothing and inserts nothing;
- if the code calls `runCrossTenant`: an allowed role reads every tenant, any other role gets `CrossTenantDeniedException`.

Use `@SpringBootTest` without a test transaction, or `@DataJpaTest` with `@AutoConfigureTestDatabase(replace = Replace.NONE)`, `@Transactional(propagation = Propagation.NOT_SUPPORTED)` and `@Import(PersistenceConfig.class)`. A test transaction opens the session before the test signs in, so the tenant never changes and isolation is not tested.

## Do not

- Do not create a second base class when `{{sc:baseEntity}}` exists in the codebase or a shared library.
- Do not set `createdAt`, `createdBy`, `updatedAt`, `updatedBy` or the tenant in code, DTOs or SQL inserts.
- Do not read the tenant from a request parameter, a path variable, a header of an HTTP request or the body.
- Do not query a tenant table with native SQL, and do not add a manual tenant `where`.
- Do not put `@EnableJpaAuditing` on the application class: `@WebMvcTest` slices then fail.
- Do not return entities from a controller: map them to response records.
