---
name: stackcrew-spring-integration-provider
description: Use when adding or changing a third-party provider integration (eKYC, payment, bank, KYC callback) in a Spring Boot service, such as adding provider C06. Gives the port, adapter, ACL mapper, registry, resilience and test steps.
kind: task
paths: ["**/*.java"]
---
# Add a provider integration (Spring Boot 3)

Follow these steps in order. Write the SC-PREFLIGHT note first: list the existing port, registry, template base, constants and mappers you found and will reuse. If `ProviderPort` already exists, you add an adapter; you do not create a second port.

## 0. Find what exists

- Search for `ProviderPort`, `ProviderRegistry`, `AbstractProviderAdapter`, `ProviderCodes`, `*Mapper`, `*Properties` and any other `*Adapter`.
- Copy the structure of the newest adapter, but not its code: shared logic goes into the template base (step 5).
- No port yet (first provider)? Create it in step 1 and note it as new in the preflight.

## 1. Port in the domain

The port speaks domain types only. No provider names, no provider fields.

```java
package com.acme.kyc.domain.provider;

public interface ProviderPort {
    String code();                                  // a constant from ProviderCodes
    VerifyResult verify(VerifyCommand command);
}

public record VerifyCommand(@NotBlank String documentNumber, @NotNull byte[] selfie, @NotBlank String requestId) {}
public record VerifyResult(VerificationStatus status, BigDecimal score, String providerReference) {}
public enum VerificationStatus { APPROVED, REJECTED, PENDING }
```

Provider codes are constants, never inline strings:

```java
public final class ProviderCodes {
    private ProviderCodes() {}
    public static final String HYPERVERGE = "HYPERVERGE";
    public static final String C06 = "C06";
}
```

## 2. Provider DTOs as records, package-private

Request and response shapes of this provider live next to its adapter and never leave that package. These are the anti-corruption layer (ACL) models.

```java
package com.acme.kyc.infrastructure.c06;

record C06VerifyRequest(String idNumber, String faceImageBase64, String traceRef) {}
record C06VerifyResponse(String resultCode, Double matchScore, String transactionId) {}
```

- No `JsonNode`, `Map<String, Object>` or `Map<?, ?>`. If the provider payload is polymorphic, model it with a `sealed interface` and `@JsonTypeInfo`.
- Use `@JsonIgnoreProperties(ignoreUnknown = true)` on responses so a new provider field does not break you.
- Provider status strings are mapped through a constant table or enum, not compared inline.

## 3. ACL mapper

One class converts both directions. It is the only place that knows both vocabularies.

```java
final class C06Mapper {
    private static final Map<String, VerificationStatus> STATUS = Map.of(
        C06Codes.OK, VerificationStatus.APPROVED,
        C06Codes.NOT_MATCH, VerificationStatus.REJECTED,
        C06Codes.PROCESSING, VerificationStatus.PENDING);

    C06VerifyRequest toRequest(VerifyCommand c) { ... }

    VerifyResult toDomain(C06VerifyResponse r) {
        VerificationStatus status = STATUS.get(r.resultCode());
        if (status == null) {
            throw new ProviderProtocolException(ProviderCodes.C06, "unknown result code " + r.resultCode());
        }
        return new VerifyResult(status, BigDecimal.valueOf(r.matchScore()), r.transactionId());
    }
}
```

An unknown code is a typed error, never a silent default.

## 4. One adapter per provider

```java
@Component
class C06Adapter extends AbstractProviderAdapter<C06VerifyRequest, C06VerifyResponse> implements ProviderPort {
    private final RestClient client;
    private final C06Mapper mapper = new C06Mapper();

    C06Adapter(@Qualifier("c06Client") RestClient client, ProviderAudit audit, MeterRegistry meters) {
        super(ProviderCodes.C06, audit, meters);
        this.client = client;
    }

    @Override public String code() { return ProviderCodes.C06; }

    @Override
    @CircuitBreaker(name = ProviderCodes.C06)
    @Retry(name = ProviderCodes.C06)
    public VerifyResult verify(VerifyCommand command) {
        return execute(command.requestId(), () -> mapper.toDomain(call(mapper.toRequest(command))));
    }

    private C06VerifyResponse call(C06VerifyRequest request) {
        return client.post().uri(C06Paths.VERIFY).body(request).retrieve().body(C06VerifyResponse.class);
    }
}
```

- The `RestClient` for each provider is a `@Bean` with base URL and timeouts from `@ConfigurationProperties` (see the Spring Boot rule). No URL literal in the adapter; paths are constants.
- Adapters depend on their own client, mapper and shared infrastructure, never on another provider's adapter.
- Only the adapter and mapper import provider records.

## 5. Template Method base: auth, call, map, audit

The common flow lives once. Adapters override only what differs. Create it when the second provider arrives, or lift it now if copy-paste is starting.

```java
abstract class AbstractProviderAdapter<REQ, RES> {
    private final String providerCode;
    private final ProviderAudit audit;
    private final Timer timer;

    protected <T> T execute(String requestId, Supplier<T> action) {
        long start = System.nanoTime();
        try {
            T result = action.get();
            audit.success(providerCode, requestId);
            return result;
        } catch (RestClientResponseException e) {
            audit.failure(providerCode, requestId, e.getStatusCode().value());
            throw ProviderErrors.translate(providerCode, e);
        } finally {
            timer.record(System.nanoTime() - start, TimeUnit.NANOSECONDS);
        }
    }

    protected void authenticate() { }              // default: no-op; override for token providers
}
```

- Token-based providers override `authenticate()` and cache the token until shortly before expiry. Never fetch a token per call.
- Do not use Template Method when providers differ in every step; then the port alone is enough.

## 6. Registry: Strategy + Factory

Spring injects every `ProviderPort`; the registry keys them by code. Adding a provider adds a bean and nothing else.

```java
@Component
public class ProviderRegistry {
    private final Map<String, ProviderPort> byCode;

    public ProviderRegistry(List<ProviderPort> providers) {
        this.byCode = providers.stream().collect(Collectors.toUnmodifiableMap(ProviderPort::code, Function.identity()));
    }

    public ProviderPort get(String code) {
        ProviderPort port = byCode.get(code);
        if (port == null) {
            throw new UnknownProviderException(code);
        }
        return port;
    }
}
```

- Services call `registry.get(code).verify(command)`. A growing `if (code.equals("..."))` or `switch` on a provider code is the wrong shape; this is the right one.
- A duplicate code fails at startup (`toUnmodifiableMap` throws), which is the intended behavior.

## 7. Resilience

- Timeouts first: connect and read timeouts on the provider `RestClient` (properties, not literals).
- `@CircuitBreaker(name = ...)` and `@Retry(name = ...)` from `io.github.resilience4j.*.annotation`, with the instance name a constant. Tune per provider in `application.yml`:

```yaml
resilience4j:
  circuitbreaker:
    circuitBreakerAspectOrder: 1
    instances:
      C06:
        slidingWindowSize: 20
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
  retry:
    retryAspectOrder: 2
    instances:
      C06:
        maxAttempts: 3
        waitDuration: 500ms
        enableExponentialBackoff: true
```

- Retry only idempotent operations (a verification query, a status check). A non-idempotent call (charge, submit) retries only with the provider's idempotency key, or not at all.
- `@TimeLimiter` is for `CompletableFuture` methods only. For blocking `RestClient` calls the client timeouts are the time limit.
- Translate failures into typed exceptions (`ProviderUnavailableException`, `ProviderProtocolException`); the global `ProblemDetail` advice maps them to a status.

## 8. Callbacks and idempotency

For a provider webhook or callback endpoint:

1. Authenticate it (HMAC signature or shared secret, compared in constant time), reject otherwise with 401.
2. Parse into a typed record. Reject a malformed body with 400.
3. Deduplicate on the provider event id with a unique constraint (table `provider_event(provider_code, event_id)`), so a redelivery is a no-op that still returns 200.
4. Persist, acknowledge quickly, then process asynchronously.
5. For your own outbound mutating calls, send an idempotency key derived from the business request id, and store it.

## 9. Logging and metrics per provider

- Log with the provider code and trace id on every call and every failure; `traceId` comes from MDC (Micrometer Tracing), not generated by hand:

```java
log.info("provider call ok provider={} requestId={} traceId={} durationMs={}", providerCode, requestId, MDC.get(MdcKeys.TRACE_ID), ms);
```

- Never log document numbers, images, tokens or full bodies; mask identifiers with the shared `Masking` util.
- Metrics: a `Timer` and a failure `Counter` tagged `provider=<code>` and `outcome`; Resilience4j exposes breaker state metrics under the same instance name.

## 10. Tests with WireMock

One test class per adapter (`C06AdapterTest`) using `@WireMockTest`:

- success mapped to the domain result;
- 4xx and 5xx mapped to typed exceptions;
- timeout fails within the configured read timeout;
- malformed or unknown-code body gives `ProviderProtocolException`;
- retry: a scenario that fails once then succeeds;
- callback delivered twice is processed once.

Also add the new code to the registry test (`ProviderRegistryTest`) and make sure `StackcrewArchitectureTest` passes.

## Camel variant (only if the profile lists the camel add-on)

Skip this section unless `stackcrew.json` has `camel` in `addons`. When it does, route many providers with Apache Camel instead of the hand-written template base:

- One `RouteBuilder` per provider route, `from("direct:verify-c06")` to the HTTP component, with the error handler (`onException`, `redeliveryPolicy`, dead letter channel) declared on the route.
- Keep the same port: a `CamelProviderAdapter implements ProviderPort` calls `ProducerTemplate` with a typed body and maps the typed reply through the same ACL mapper.
- Typed beans only at route edges; no `Map<String, Object>` exchange bodies.
- Retry, throttling and DLQ come from Camel EIPs, not from stacked Resilience4j annotations on the same call.

## Do not

- Do not let a provider record, `JsonNode` or `Map<String, Object>` reach a service, controller or domain type.
- Do not copy an existing adapter and edit it; lift the shared flow into the template base first.
- Do not hardcode URLs, provider codes, header names, status strings or timeouts.
- Do not add an `if/else` chain on the provider code; use the registry.
- Do not create a factory, strategy or bridge when there is a single provider and no second one in sight; a port plus adapter is enough until the second provider arrives.
- Do not retry non-idempotent calls blindly, and do not swallow provider errors into `null` or an empty result.
- Do not call the provider from a `@Transactional` method; call first, then persist.
- Do not test against the real provider; use WireMock.
