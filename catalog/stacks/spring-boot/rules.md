---
id: stack-spring-boot
title: Spring Boot 3
---
# Spring Boot 3

Spring Boot 3.x on Java 17+. Applies with the Java rule (SC-TYPE, SC-CONST, SC-REUSE, records, `jakarta.*`).

## Essentials

- Third-party integration (eKYC, payment, bank): domain `ProviderPort` + one `*Adapter` per provider + ACL mapper from provider records to domain types + registry (`Map<String, ProviderPort>` keyed by a constant provider code). Provider DTOs never leave the adapter. Use skill `stackcrew-spring-integration-provider`.
- Layering is controller -> service -> repository. No business logic in controllers, no repository in controllers, and entities never cross the API: map to a `record` DTO.
- Constructor injection only: no field `@Autowired`, `final` fields, stateless beans. A new bean needs a reason, and a 4th dependency is a signal to split the class.
- Every outbound call has a timeout (`RestClient` connect and read timeouts) plus Resilience4j `@CircuitBreaker` and `@Retry` (retry only idempotent calls). Never call a third party with the default client.
- Errors are RFC 7807 `ProblemDetail` through one `@RestControllerAdvice`; request DTOs are records with `@Valid` and Bean Validation (`jakarta.validation.*`).
- Configuration is typed `@ConfigurationProperties` records (`@Validated`); no scattered `@Value`, no secrets in `application.yml` (env or a vault).
- Use `RestClient` (or `WebClient` on a reactive stack) for HTTP; `RestTemplate` is legacy. Declare URLs, paths and header names as constants or properties.
- Log with SLF4J and structured fields: `traceId` (Micrometer Tracing), provider code, outcome, duration. Never log secrets, PII or full bodies. Add a Micrometer metric tagged by provider.
- Provider callbacks (webhooks) are authenticated, idempotent (dedupe on the provider event id) and acknowledged fast; do the work asynchronously.
- `@Transactional` on service methods only, `readOnly = true` for queries, never around a remote call.
- Write tests per `stackcrew-spring-boot-testing`: slice tests, Testcontainers, WireMock for every provider.

## Boot 3 specifics

- Namespace is `jakarta.*`: `jakarta.persistence`, `jakarta.validation`, `jakarta.servlet`. Any `javax.*` import in new code is a bug.
- `RestClient` is built from `RestClient.Builder`, configured once per provider with a base URL property and a request factory with timeouts:

```java
@Bean
RestClient hypervergeClient(RestClient.Builder builder, HypervergeProperties props) {
    var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(props.connectTimeout()).build());
    factory.setReadTimeout(props.readTimeout());
    return builder.baseUrl(props.baseUrl()).requestFactory(factory).build();
}
```

- Error responses use `ProblemDetail`:

```java
@RestControllerAdvice
class ApiExceptionHandler {
    @ExceptionHandler(ProviderUnavailableException.class)
    ProblemDetail onProviderDown(ProviderUnavailableException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_GATEWAY, ex.getMessage());
        pd.setProperty("providerCode", ex.providerCode());
        return pd;
    }
}
```

- Enable `spring.mvc.problemdetails.enabled=true` so framework exceptions use `ProblemDetail` too.
- Observability: Actuator (`health` with liveness and readiness groups), Micrometer metrics, Micrometer Tracing with the OpenTelemetry or Brave bridge. Outbound `RestClient` built from the injected `RestClient.Builder` propagates `traceparent` automatically.
- Configuration properties are records:

```java
@Validated
@ConfigurationProperties(prefix = "kyc.hyperverge")
public record HypervergeProperties(@NotBlank String baseUrl, @NotNull Duration connectTimeout, @NotNull Duration readTimeout) {}
```

## Layering and design

- Controller: map HTTP to a command or query record, call one service method, map the result to a response record. Nothing else.
- Service: business rules and transactions. Depends on ports (interfaces) for anything external, never on a concrete adapter.
- Repository: Spring Data interface only; a service never builds SQL strings.
- Pick a pattern only with a signal (see `stackcrew-pattern-guide`): growing `if/switch` on a provider code is Strategy + registry; the same step sequence with different calls is Template Method; wrapping a third-party model is an Adapter with an ACL.
- A fourth provider added by copy-paste of an existing adapter is an SC-REUSE violation: lift the shared flow into the template base first.

## Provider integration (summary)

1. `ProviderPort` in the domain package speaks only domain records (`VerifyCommand`, `VerifyResult`).
2. `XxxAdapter implements ProviderPort` in `infrastructure.<provider>`; its request and response records are package-private and mapped by `XxxMapper`.
3. `ProviderRegistry` is built from the injected `List<ProviderPort>` or `Map<String, ProviderPort>`; the key comes from `ProviderPort.code()`, which returns a constant from `ProviderCodes`.
4. The shared flow (authenticate, call, map, audit) lives once in `AbstractProviderAdapter` (Template Method); adapters override only the provider-specific steps.
5. Resilience4j annotations and timeouts sit on the adapter call; the registry and callers see typed domain exceptions only.
6. Callbacks: verify the signature, dedupe on the event id, persist, then process.
7. A WireMock contract test per provider with success, 4xx, 5xx, timeout and malformed-body cases.

Full steps with code: skill `stackcrew-spring-integration-provider`.

## Resilience

- Order the aspects so the circuit breaker wraps the retry: `resilience4j.circuitbreaker.circuitBreakerAspectOrder=1` and `resilience4j.retry.retryAspectOrder=2`.
- Tune per provider instance in `application.yml` (`resilience4j.circuitbreaker.instances.<provider>`, `resilience4j.retry.instances.<provider>`), not in code. The instance name is a constant shared with the annotation.
- A fallback returns a typed domain result or throws a typed exception; it never returns `null` or an empty map.
- `@TimeLimiter` works only on methods returning `CompletableFuture`; for synchronous calls rely on `RestClient` timeouts.

## Data access with Spring Data JPA

- Never expose entities over the API: map to record DTOs or projections.
- Avoid N+1: fetch joins, `@EntityGraph` or projections; keep associations `LAZY` and check the SQL.
- Set `spring.jpa.open-in-view=false` in production.
- Paginate every list query with `Pageable`; never return an unbounded collection.
- Use `@Version` for optimistic locking on concurrently updated entities and handle `OptimisticLockException`.
- Schema changes go through Flyway or Liquibase; never `ddl-auto=update` or `create` in production (use `validate`).
- Manage both sides of a bidirectional relation; understand `cascade` and `orphanRemoval` before using them.
- Bulk changes use modifying queries or batching; do not load entities to delete them.
- Index foreign keys and query predicates; review the generated SQL for hot paths.
- Entities are plain classes: no Lombok `@Data`, `@Builder` or `@AllArgsConstructor`.

## Security

- Spring Security with method-level authorization (`@PreAuthorize`), deny by default, CSRF protection for cookie auth, a CORS allowlist, and object-level checks (no IDOR).
- Store provider credentials in a vault or env variables bound through `@ConfigurationProperties`; never in code, logs or the repository.

## Logging and observability config

- Logback with a plain pattern for dev and JSON (logstash-logback-encoder) for prod, switched by Spring profile.
- A `OncePerRequestFilter` fills MDC (`requestId`, `traceId`, `spanId`, `userId`) at entry and clears it in `finally`.
- Request logging records method, templated route, status and duration; never the body or the `Authorization` header.
- A masking converter redacts sensitive fields in Logback output.
- Levels per package through `logging.level.*`; never DEBUG SQL in prod. Use `org.hibernate.SQL=DEBUG` and `org.hibernate.orm.jdbc.bind=TRACE` in dev only, and a slow-query log (datasource-proxy or p6spy at about 300 ms) in prod.
- Flyway or Liquibase log applied versions at INFO.
