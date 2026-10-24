---
id: stack-spring-boot
title: Spring Boot 3
---
# Spring Boot 3

Spring Boot 3.x on Java 17+. Applies with the Java rule (SC-TYPE, SC-CONST, SC-REUSE, records, Jakarta EE names). `RestClient` and `JdbcClient` need Boot 3.2+; on 3.0/3.1 use `RestTemplate` (via `RestTemplateBuilder` with timeouts) or `WebClient`.

## Essentials

- Third-party integration (eKYC, payment, bank): domain `ProviderPort` + one `*Adapter` per provider + ACL mapper from provider records to domain types + a registry built from the injected `List<ProviderPort>`, keyed by a constant `code()`. Provider DTOs never leave the adapter. Use skill `stackcrew-spring-integration-provider`.
- Layering is controller -> service -> repository. No business logic in controllers, no repository in controllers, entities never cross the API: the service returns a domain result and the controller maps it to a `record` DTO.
- Constructor injection only: no field `@Autowired`, `final` fields, stateless beans. A 4th dependency is a signal to split the class.
- Every outbound call has connect and read timeouts, plus circuit breaker, retry (idempotent calls only, with jitter) and bulkhead from Resilience4j; 4xx and protocol errors neither retry nor trip the breaker. Never call a third party with the default client.
- Provider callbacks (webhooks) are authenticated, idempotent (dedupe on the provider event id with an atomic insert, not a caught exception) and acknowledged fast; process from the persisted row.
- Log with SLF4J and structured fields: `traceId` (Micrometer Tracing), provider code, outcome, duration. Never log secrets, PII or full bodies (a record's `toString` prints every field). Add a Micrometer metric tagged by provider.
- Errors are RFC 7807 `ProblemDetail` through one `@RestControllerAdvice` with a stable, safe `detail`; request DTOs are records with `@Valid` and Bean Validation (`jakarta.validation.*`).
- Configuration is typed `@ConfigurationProperties` records (`@Validated`), one map keyed by provider code rather than a class per provider; no scattered `@Value`, no secrets in `application.yml` (env or a vault).
- Use `RestClient` (or `WebClient` on a reactive stack) for HTTP; `RestTemplate` is legacy. URLs come from properties, paths and header names from constants.
- `@Transactional` on service methods only, `readOnly = true` for queries, never around a remote call, and never relied on through `this.` self-invocation.
- Write tests per `stackcrew-spring-boot-testing`: slice tests, Testcontainers, WireMock for every provider.

## Boot 3 specifics

- Jakarta EE APIs use the `jakarta.*` namespace: `jakarta.persistence`, `jakarta.validation`, `jakarta.servlet`, `jakarta.annotation`, `jakarta.transaction`, `jakarta.inject`, `jakarta.ws.rs`. A `javax.persistence|validation|servlet|annotation|transaction|inject|ws.rs` import in new code is a bug. JDK packages keep `javax`: `javax.crypto`, `javax.sql`, `javax.net.ssl`.
- Build each provider `RestClient` from the injected `RestClient.Builder` through one factory, with timeouts from properties (see the skill, step 4):

```java
@ConfigurationProperties(prefix = "kyc.providers")
public record ProviderProperties(Map<String, Endpoint> endpoints) {
    public record Endpoint(String baseUrl, Duration connectTimeout, Duration readTimeout) {}
}

RestClient create(String providerCode) {
    ProviderProperties.Endpoint e = props.endpoints().get(providerCode);
    var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(e.connectTimeout()).build());
    factory.setReadTimeout(e.readTimeout());
    return builder.clone().baseUrl(e.baseUrl()).requestFactory(factory).build();
}
```

- Error responses use `ProblemDetail` with a constant, safe `detail`; never `ex.getMessage()` (it can carry provider codes or PII):

```java
@RestControllerAdvice
class ApiExceptionHandler {
    @ExceptionHandler(ProviderUnavailableException.class)
    ProblemDetail onProviderDown(ProviderUnavailableException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_GATEWAY, ProblemDetails.PROVIDER_UNAVAILABLE);
    }
}
```

- Enable `spring.mvc.problemdetails.enabled=true` so framework exceptions use `ProblemDetail` too.
- Observability: Actuator (`health` with liveness and readiness groups), Micrometer metrics, Micrometer Tracing with the OpenTelemetry or Brave bridge. A `RestClient` built from the injected `RestClient.Builder` propagates `traceparent` automatically.

## Layering and design

- Controller: map HTTP to a command or query record, call one service method, map the domain result to a response record. Nothing else.
- Service: business rules and transactions. Depends on ports (interfaces) for anything external, never on a concrete adapter.
- Repository: Spring Data interface only; a service never builds SQL strings.
- Pick a pattern only with a signal (see `stackcrew-pattern-guide`): growing `if/switch` on a provider code is Strategy + registry; the same step sequence with different calls is Template Method; wrapping a third-party model is an Adapter with an ACL.
- A second provider added by copy-paste of the first adapter is an SC-REUSE violation: introduce the template base, registry and strategy at the second provider, or as soon as `docs/stackcrew/architecture-profile.md` records that more providers are expected. For a single provider with no more expected a port plus adapter is enough; `ProviderClientFactory` and `ProviderProperties` are configuration plumbing and fine from the first.

## Untyped data belongs at the edge

- Boundary deserialization of a dynamic payload and framework configuration live in `infrastructure`, `adapter` or `config` packages. `StackcrewArchitectureTest` scans `..service..` and `..domain..` only, so an untyped value there is a violation; elsewhere the guard still flags the line and you waive it on the same line with `stackcrew-allow: SC-TYPE <reason>` (for example a Kafka client config `Map<String, Object>` or `Jwt.getClaims()`).
- A JSON attribute of a domain entity (for example a JSONB column) is a typed record plus a JPA `AttributeConverter`, not a `Map<String, Object>` or `JsonNode` field.

## Provider integration (summary)

1. `ProviderPort` in the domain package speaks only domain records (`VerifyCommand`, `VerifyResult`) and throws typed `ProviderException`s.
2. `XxxAdapter` in `infrastructure.<provider>`; its request and response records are package-private and mapped by `XxxMapper` (null-safe: a malformed reply is `ProviderProtocolException`, not an NPE).
3. `ProviderRegistry` is built from the injected `List<ProviderPort>` with `Collectors.toUnmodifiableMap(ProviderPort::code, ...)`. Do not inject `Map<String, ProviderPort>` and assume its keys are provider codes: Spring keys an injected map by bean name.
4. The shared flow (authenticate, call, map, audit) lives once in a public `AbstractProviderAdapter` whose template method applies Resilience4j programmatically from the registries (no proxy traps, testable by hand); its methods are not `final`, since a final method on a CGLIB proxy runs against null fields. Introduce base and registry at the second provider or when the architecture profile records that more are expected.
5. Error translation inside the template: `ResourceAccessException` and 5xx/429 to `ProviderUnavailableException`, other 4xx to `ProviderRejectedException`, undecodable body to `ProviderProtocolException`.
6. Callbacks: verify the signature, insert the raw event atomically (`INSERT ... ON CONFLICT DO NOTHING`), return 200, process from the stored row.
7. A WireMock contract test per provider with success, 4xx, 5xx, timeout and malformed-body cases.

Full steps with code: skill `stackcrew-spring-integration-provider`.

## Transactions and async

- A remote call never runs inside a `@Transactional` method. Call first, then persist in a different bean (another `@Service`) or with `TransactionTemplate`; `this.save()` on a `@Transactional` method of the same class bypasses the proxy.
- Persist an incoming callback with one atomic idempotent statement, acknowledge, and process later from the persisted row (an inbox poller is the simplest; with events, insert and `publishEvent` inside one `@Transactional` method of the ingest bean and make the `@TransactionalEventListener(phase = AFTER_COMMIT)` listener on another bean `@Async` with `@EnableAsync` and a bounded executor, since such a listener never runs without a transaction and a synchronous one delays the 200). Never catch `DataIntegrityViolationException` inside the same transaction.
- `@Async`, `@Retry`, `@CircuitBreaker` and `@Transactional` all work through the proxy: they do nothing on `this.` calls or on a hand-built bean in a unit test.

## Resilience

- Keep the Resilience4j config per provider in `application.yml` (`resilience4j.circuitbreaker.instances.<provider>`, `.retry.instances.<provider>`, `.bulkhead.instances.<provider>`); the instance name is the provider-code constant. The starter turns it into `CircuitBreakerRegistry`, `RetryRegistry` and `BulkheadRegistry` beans.
- Put the exception lists in `configs.default` (`baseConfig: default`), not only per instance, so every provider, including one added later, gets them. Count only real provider trouble. Retry: `retryExceptions` = `ProviderUnavailableException`, `ResourceAccessException`; `ignoreExceptions` = `ProviderRejectedException`, `ProviderProtocolException`. Circuit breaker: `recordExceptions` = `ProviderUnavailableException`; `ignoreExceptions` = the same two. Ignore wins over record or retry.
- Retry with exponential backoff and jitter (`enableExponentialBackoff`, `enableRandomizedWait`); cap attempts; retry only idempotent operations.
- Add a bulkhead (`maxConcurrentCalls`) per provider so one slow provider cannot exhaust the thread pool.
- If annotations are used instead of the programmatic template, set `resilience4j.circuitbreaker.circuitBreakerAspectOrder=1` and `resilience4j.retry.retryAspectOrder=2` so the breaker wraps the retry.
- A fallback returns a typed domain result or throws a typed exception; never `null` or an empty map.
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
- A masking converter redacts sensitive fields in Logback output. Do not log a command or request record directly: its `toString` prints every field, so override `toString` or log selected fields.
- Levels per package through `logging.level.*`; never DEBUG SQL in prod. Use `org.hibernate.SQL=DEBUG` and `org.hibernate.orm.jdbc.bind=TRACE` in dev only, and a slow-query log (datasource-proxy or p6spy at about 300 ms) in prod.
- Flyway or Liquibase log applied versions at INFO.
