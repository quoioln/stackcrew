---
name: stackcrew-spring-integration-provider
description: Use when adding or changing a third-party provider integration (eKYC, payment, bank, KYC callback) in a Spring Boot service, such as adding provider C06. Gives the port, adapter, ACL mapper, registry, resilience and test steps.
kind: task
paths: ["**/*.java"]
---
# Add a provider integration (Spring Boot 3.2+, Java 17+)

Follow these steps in order. Write the SC-PREFLIGHT note first: list the existing port, registry, template base, constants, mappers and exceptions you found and will reuse. If `ProviderPort` already exists you add an adapter; you never create a second port.

`RestClient` and `JdbcClient` need Spring Boot 3.2+. On 3.0/3.1 use `RestTemplate` built with `RestTemplateBuilder` timeouts (or `WebClient`); every other step is unchanged.

## 0. Find what exists, and pick the shape

- Search for `ProviderPort`, `ProviderRegistry`, `AbstractProviderAdapter`, `ProviderCodes`, `ProviderException`, `*Mapper`, `ProviderProperties`, `ProviderClientFactory`.
- **One rule for the base, registry and strategy:** introduce the template base (step 5) and the registry (step 6) at the second provider, or as soon as `docs/stackcrew/architecture-profile.md` records that more providers are expected (the normal case for an integration hub). Not before.
- **First provider and the profile expects exactly one**: do steps 1-4 with a plain adapter that implements `ProviderPort` directly (same `attempt` body as step 5, wrapped with the same Retry, CircuitBreaker and Bulkhead), and inject the port. Skip the base and the registry. `ProviderClientFactory` and `ProviderProperties` (step 4) are configuration plumbing for HTTP clients and are fine from the first provider.

## 1. Port and typed errors in the domain

The port speaks domain types only. No provider names, no provider fields.

```java
package com.acme.kyc.domain.provider;

public interface ProviderPort {
    String code();                                   // a constant from ProviderCodes
    VerifyResult verify(VerifyCommand command);
}

public record VerifyCommand(@NotBlank String documentNumber, @NotNull byte[] selfie, @NotBlank String requestId) {
    @Override public String toString() {             // a record prints every field: never log PII
        return "VerifyCommand[requestId=" + requestId + "]";
    }
}
public record VerifyResult(VerificationStatus status, BigDecimal score, String providerReference) {}
public enum VerificationStatus { APPROVED, REJECTED, PENDING }

public final class ProviderCodes {
    private ProviderCodes() {}
    public static final String HYPERVERGE = "HYPERVERGE";
    public static final String C06 = "C06";
}
```

Typed errors, one base, so callers and Resilience4j can tell the cases apart:

```java
public abstract class ProviderException extends RuntimeException {
    @Serial private static final long serialVersionUID = 1L;       // required: the build compiles with -Xlint:all -Werror
    private final String providerCode;
    protected ProviderException(String providerCode, String message, Throwable cause) { super(message, cause); this.providerCode = providerCode; }
    public String providerCode() { return providerCode; }
}
public class ProviderUnavailableException extends ProviderException {   // timeout, connection refused, 5xx, 429
    @Serial private static final long serialVersionUID = 1L;
    public ProviderUnavailableException(String code, String message, Throwable cause) { super(code, message, cause); }
}
public class ProviderRejectedException extends ProviderException {      // 4xx: our request was refused; retrying will not help
    @Serial private static final long serialVersionUID = 1L;
    public ProviderRejectedException(String code, String message, Throwable cause) { super(code, message, cause); }
}
public class ProviderProtocolException extends ProviderException {      // undecodable body, unknown result code
    @Serial private static final long serialVersionUID = 1L;
    public ProviderProtocolException(String code, String message, Throwable cause) { super(code, message, cause); }
}
```

Every serializable class you add (exceptions especially) declares `@Serial private static final long serialVersionUID = 1L;`.

## 2. Provider DTOs as records, package-private (the ACL models)

They live next to the adapter and never leave that package.

```java
package com.acme.kyc.infrastructure.c06;

@JsonIgnoreProperties(ignoreUnknown = true)
record C06VerifyRequest(String idNumber, String faceImageBase64, String traceRef) {}

@JsonIgnoreProperties(ignoreUnknown = true)
record C06VerifyResponse(String resultCode, BigDecimal matchScore, String transactionId) {}
```

- No `JsonNode`, `Map<String, Object>` or `Map<?, ?>`. A polymorphic payload is a `sealed interface` with `@JsonTypeInfo`.
- Fields that may be absent use boxed types (`BigDecimal`, `Integer`), never a primitive that would fail on null.
- Provider status strings are constants or an enum, never compared inline.

## 3. ACL mapper

The only class that knows both vocabularies. Be null-safe: a malformed reply is a typed error, not an NPE.

```java
final class C06Mapper {
    private static final Map<String, VerificationStatus> STATUS = Map.of(
        C06Codes.OK, VerificationStatus.APPROVED,
        C06Codes.NOT_MATCH, VerificationStatus.REJECTED,
        C06Codes.PROCESSING, VerificationStatus.PENDING);

    C06VerifyRequest toRequest(VerifyCommand c) {
        return new C06VerifyRequest(c.documentNumber(), Base64.getEncoder().encodeToString(c.selfie()), c.requestId());
    }

    VerifyResult toDomain(C06VerifyResponse r) {
        if (r == null || r.resultCode() == null || r.matchScore() == null) {
            throw new ProviderProtocolException(ProviderCodes.C06, "missing result code or score", null);
        }
        VerificationStatus status = STATUS.get(r.resultCode());
        if (status == null) {
            throw new ProviderProtocolException(ProviderCodes.C06, "unknown result code", null);
        }
        return new VerifyResult(status, r.matchScore(), r.transactionId());
    }
}
```

## 4. Per-provider configuration: one properties map, one client factory

Do not write a properties record and a `RestClient` bean per provider.

```java
@Validated
@ConfigurationProperties(prefix = "kyc.providers")
public record ProviderProperties(@NotEmpty Map<String, @Valid Endpoint> endpoints) {   // @Valid on the value type cascades into each Endpoint
    public record Endpoint(@NotBlank String baseUrl, @NotNull Duration connectTimeout, @NotNull Duration readTimeout) {}
}

@Component
public class ProviderClientFactory {
    private final ProviderProperties props;
    private final RestClient.Builder builder;

    public ProviderClientFactory(ProviderProperties props, RestClient.Builder builder) { this.props = props; this.builder = builder; }

    public RestClient create(String providerCode) {
        ProviderProperties.Endpoint e = props.endpoints().get(providerCode);
        if (e == null) { throw new IllegalStateException("no endpoint configured for provider " + providerCode); }
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(e.connectTimeout()).build());
        factory.setReadTimeout(e.readTimeout());
        return builder.clone().baseUrl(e.baseUrl()).requestFactory(factory).build();
    }
}
```

```yaml
kyc:
  providers:
    endpoints:
      C06: { baseUrl: "${C06_BASE_URL}", connectTimeout: 2s, readTimeout: 5s }
```

Register the properties with `@ConfigurationPropertiesScan` on the application class or `@EnableConfigurationProperties(ProviderProperties.class)`. The constructor is public so a test can build the factory by hand (see `stackcrew-spring-boot-testing`). Credentials come from environment variables or a vault, bound the same way, never from code or logs.

## 5. Template Method base: authenticate, call, map, audit

A real template: the public `verify` fixes the order, the subclass fills the steps. Resilience4j is applied programmatically here, keyed by provider code, so there are no proxy or self-invocation traps and the retry can be unit-tested without Spring.

```java
public abstract class AbstractProviderAdapter<REQ, RES> implements ProviderPort {
    private final String providerCode;
    private final ProviderAudit audit;
    private final MeterRegistry meters;
    private final CircuitBreaker circuitBreaker;
    private final Retry retry;
    private final Bulkhead bulkhead;

    protected AbstractProviderAdapter(String providerCode, CircuitBreakerRegistry breakers, RetryRegistry retries,
                                      BulkheadRegistry bulkheads, ProviderAudit audit, MeterRegistry meters) {
        this.providerCode = providerCode;
        this.circuitBreaker = breakers.circuitBreaker(providerCode);
        this.retry = retries.retry(providerCode);
        this.bulkhead = bulkheads.bulkhead(providerCode);
        this.audit = audit;
        this.meters = meters;
    }

    @Override public String code() { return providerCode; }

    /**
     * The template method. Circuit breaker outermost, so one logical call is one breaker record.
     * Not final: a final method called on a CGLIB proxy runs on the proxy instance, whose fields are null.
     */
    @Override
    public VerifyResult verify(VerifyCommand command) {
        Supplier<VerifyResult> guarded = CircuitBreaker.decorateSupplier(circuitBreaker,
            Retry.decorateSupplier(retry, Bulkhead.decorateSupplier(bulkhead, () -> attempt(command))));
        Timer.Sample sample = Timer.start(meters);
        try {
            VerifyResult result = guarded.get();
            finish(sample, command, ProviderMetrics.OUTCOME_SUCCESS, null);
            return result;
        } catch (CallNotPermittedException | BulkheadFullException e) {
            finish(sample, command, ProviderMetrics.OUTCOME_SHORT_CIRCUITED, e);
            throw new ProviderUnavailableException(providerCode, "provider call not permitted", e);
        } catch (ProviderException e) {
            finish(sample, command, ProviderMetrics.outcomeOf(e), e);
            throw e;
        } catch (RuntimeException e) {                         // anything unexpected is still audited and counted
            finish(sample, command, ProviderMetrics.OUTCOME_ERROR, e);
            throw e;
        }
    }

    private VerifyResult attempt(VerifyCommand command) {
        try {
            authenticate();
            return toDomain(call(toRequest(command)));
        } catch (ResourceAccessException e) {                 // timeout, connection refused
            throw new ProviderUnavailableException(providerCode, "provider unreachable", e);
        } catch (RestClientResponseException e) {             // HTTP error status
            throw isRetryableStatus(e.getStatusCode())
                ? new ProviderUnavailableException(providerCode, "provider error " + e.getStatusCode().value(), e)
                : new ProviderRejectedException(providerCode, "provider rejected " + e.getStatusCode().value(), e);
        } catch (RestClientException e) {                     // undecodable body
            throw new ProviderProtocolException(providerCode, "undecodable provider response", e);
        }
    }

    private void finish(Timer.Sample sample, VerifyCommand command, String outcome, Exception failure) {
        sample.stop(Timer.builder(ProviderMetrics.CALLS).tag(ProviderMetrics.TAG_PROVIDER, providerCode)
            .tag(ProviderMetrics.TAG_OUTCOME, outcome).register(meters));
        if (failure == null) {
            audit.success(providerCode, command.requestId());
        } else {
            meters.counter(ProviderMetrics.FAILURES, ProviderMetrics.TAG_PROVIDER, providerCode, ProviderMetrics.TAG_OUTCOME, outcome).increment();
            audit.failure(providerCode, command.requestId(), outcome);
        }
    }

    private static boolean isRetryableStatus(HttpStatusCode status) {
        return status.is5xxServerError() || status.value() == HttpStatus.TOO_MANY_REQUESTS.value();
    }

    protected void authenticate() { }                         // default no-op; token providers override and cache the token
    protected abstract REQ toRequest(VerifyCommand command);
    protected abstract RES call(REQ request);
    protected abstract VerifyResult toDomain(RES response);
}
```

The adapter supplies only the provider-specific steps:

```java
@Component
class C06Adapter extends AbstractProviderAdapter<C06VerifyRequest, C06VerifyResponse> {
    private final RestClient client;
    private final C06Mapper mapper = new C06Mapper();

    C06Adapter(ProviderClientFactory clients, CircuitBreakerRegistry breakers, RetryRegistry retries,
               BulkheadRegistry bulkheads, ProviderAudit audit, MeterRegistry meters) {
        super(ProviderCodes.C06, breakers, retries, bulkheads, audit, meters);
        this.client = clients.create(ProviderCodes.C06);
    }

    @Override protected C06VerifyRequest toRequest(VerifyCommand c) { return mapper.toRequest(c); }
    @Override protected C06VerifyResponse call(C06VerifyRequest request) {
        return client.post().uri(C06Paths.VERIFY).body(request).retrieve().body(C06VerifyResponse.class);
    }
    @Override protected VerifyResult toDomain(C06VerifyResponse response) { return mapper.toDomain(response); }
}
```

- `ProviderMetrics` holds the metric and tag names, the outcome constants (`OUTCOME_SUCCESS`, `OUTCOME_SHORT_CIRCUITED`, `OUTCOME_ERROR`, one per `ProviderException` subtype) and `outcomeOf(ProviderException)`.
- Adapters carry no class-level aspects or annotations that proxy them; resilience lives in the template.
- Token providers override `authenticate()` and cache the token until shortly before expiry; never fetch one per call.
- Providers that differ in every step do not need a base; the port alone is enough.

## 6. Registry: Strategy + Factory

Spring injects every `ProviderPort` as a `List`; the registry keys them by `code()`. Adding a provider adds a bean and nothing else.

```java
@Component
public class ProviderRegistry {
    private final Map<String, ProviderPort> byCode;

    public ProviderRegistry(List<ProviderPort> providers) {
        this.byCode = providers.stream().collect(Collectors.toUnmodifiableMap(ProviderPort::code, Function.identity()));
    }

    public ProviderPort get(String code) {
        ProviderPort port = byCode.get(code);
        if (port == null) { throw new UnknownProviderException(code); }
        return port;
    }
}
```

- Do not inject `Map<String, ProviderPort>` directly and treat its keys as provider codes: Spring keys an injected map by bean name (`c06Adapter`), not by `code()`. Inject the `List` and build the map as above.
- A duplicate code fails at startup (`toUnmodifiableMap` throws), which is intended.
- Adding a provider adds one adapter bean, one `kyc.providers.endpoints.<CODE>` entry and a mapper; it automatically gets the default retry, breaker and bulkhead config from step 7.
- A growing `if (code.equals(...))` or `switch` on a provider code is the wrong shape; this is the right one.

## 7. Resilience: breaker, retry, bulkhead, jitter

- Timeouts first: connect and read timeouts come from `ProviderProperties` (step 4).
- Circuit breaker, retry and bulkhead are applied by the template (step 5) using the registries. The Spring Boot starter builds those registries from `application.yml`, so tuning is per provider and outside the code. Count only real provider trouble: a 4xx or protocol error must neither retry nor open the breaker.

```yaml
resilience4j:
  circuitbreaker:
    configs:
      default:                      # every provider instance inherits this; never leave the exception lists per instance only
        slidingWindowSize: 20
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
        recordExceptions: [com.acme.kyc.domain.provider.ProviderUnavailableException]
        ignoreExceptions: [com.acme.kyc.domain.provider.ProviderRejectedException, com.acme.kyc.domain.provider.ProviderProtocolException]
    instances:
      C06:
        baseConfig: default
        waitDurationInOpenState: 60s      # per-provider override of a number only
  retry:
    configs:
      default:
        maxAttempts: 3
        waitDuration: 500ms
        enableExponentialBackoff: true
        exponentialBackoffMultiplier: 2
        enableRandomizedWait: true
        retryExceptions: [com.acme.kyc.domain.provider.ProviderUnavailableException, org.springframework.web.client.ResourceAccessException]
        ignoreExceptions: [com.acme.kyc.domain.provider.ProviderRejectedException, com.acme.kyc.domain.provider.ProviderProtocolException]
    instances:
      C06:
        baseConfig: default
  bulkhead:
    configs:
      default:
        maxConcurrentCalls: 10
        maxWaitDuration: 0
    instances:
      C06:
        baseConfig: default
```

- The exception lists live in `configs.default`, so a provider added later (or an instance named in code but absent from the YAML) never falls back to the Resilience4j defaults, which retry and record every exception including 4xx. Instances only override numbers.
- `ignoreExceptions` wins over the record/retry lists.
- Retry only idempotent operations (a verification query, a status check). A charge or submission retries only with the provider's idempotency key, or not at all.
- If you prefer annotations (`@CircuitBreaker(name = ProviderCodes.C06)`, `@Retry`) they work only through the Spring proxy: they are inert on a hand-built bean and on self-invocation, and `circuitBreakerAspectOrder=1` and `retryAspectOrder=2` are needed so the breaker wraps the retry. The template above avoids all of that.
- `@TimeLimiter` is for `CompletableFuture` methods only; for blocking `RestClient` calls the client timeouts are the time limit.

## 8. Calling and persisting: no transaction around the remote call

Call first, then persist in a different bean so the `@Transactional` proxy applies. Never `this.save(...)` with `@Transactional` on a method of the same class.

```java
@Service
class VerificationFacade {                       // not @Transactional
    private final ProviderRegistry registry;
    private final VerificationRecorder recorder;

    VerificationFacade(ProviderRegistry registry, VerificationRecorder recorder) { this.registry = registry; this.recorder = recorder; }

    VerifyResult verify(String providerCode, VerifyCommand command) {
        VerifyResult result = registry.get(providerCode).verify(command);   // remote call, no transaction open
        recorder.record(command.requestId(), result);                       // other bean: transaction starts here
        return result;
    }
}

@Service
class VerificationRecorder {
    @Transactional
    void record(String requestId, VerifyResult result) { /* repository.save(...) */ }
}
```

`TransactionTemplate` inside the facade is an equivalent alternative.

## 9. Callbacks: authenticate, dedupe in SQL, acknowledge, process later

1. Authenticate (HMAC signature or shared secret, constant-time compare), else 401. Parse into a typed record, else 400.
2. Persist the raw callback idempotently with one atomic statement. Do not catch `DataIntegrityViolationException` inside the same transaction: the transaction is already marked rollback-only.

```java
@Repository
class ProviderEventInbox {
    private static final String P_PROVIDER = "provider";
    private static final String P_EVENT_ID = "eventId";
    private static final String P_PAYLOAD = "payload";
    private static final String P_STATUS = "status";
    private static final String INSERT_IF_NEW = """
        INSERT INTO provider_event (provider_code, event_id, payload, status)
        VALUES (:provider, :eventId, :payload, :status)
        ON CONFLICT (provider_code, event_id) DO NOTHING""";   // PostgreSQL; on MySQL use INSERT ... ON DUPLICATE KEY UPDATE id = id

    private final JdbcClient jdbc;
    ProviderEventInbox(JdbcClient jdbc) { this.jdbc = jdbc; }

    boolean saveIfNew(String provider, String eventId, String payload) {
        return jdbc.sql(INSERT_IF_NEW).param(P_PROVIDER, provider).param(P_EVENT_ID, eventId)
            .param(P_PAYLOAD, payload).param(P_STATUS, EventStatus.NEW.name()).update() == 1;
    }
}
```

   On MySQL, `INSERT ... ON DUPLICATE KEY UPDATE id = id` reports a duplicate as 0 affected rows only when MySQL Connector/J runs with `useAffectedRows=true` (a JDBC URL parameter). Without it a duplicate returns 1 (matched rows), `saveIfNew` says "new" and the event is processed twice. Set it on the datasource URL and cover it with an integration test that inserts the same event twice.
3. Return 200 immediately, also for a duplicate. Do the work after the acknowledgement, never before it.
4. Process from the persisted row, not from the request. Simplest and safest: an inbox poller (`@Scheduled`, claim `NEW` rows with `FOR UPDATE SKIP LOCKED`, mark `DONE`). If you prefer events, the pieces must all be present, or the listener silently never runs:

```java
@Service
class CallbackIngest {                           // insert and publish in ONE transaction, on this bean
    private final ProviderEventInbox inbox;
    private final ApplicationEventPublisher events;
    CallbackIngest(ProviderEventInbox inbox, ApplicationEventPublisher events) { this.inbox = inbox; this.events = events; }

    @Transactional
    public void ingest(String provider, String eventId, String payload) {
        if (inbox.saveIfNew(provider, eventId, payload)) { events.publishEvent(new CallbackStored(provider, eventId)); }
    }
}

@Component
class CallbackProcessor {                        // another bean
    @Async("callbackExecutor")                   // asynchronous, so the 200 is not held up by the work
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    void on(CallbackStored event) { /* load the row by id and process it, idempotently */ }
}
```

   A `@TransactionalEventListener` is not invoked at all when no transaction is active (unless `fallbackExecution = true`), and a synchronous one runs before the caller returns. `@EnableAsync` and a bounded `ThreadPoolTaskExecutor` bean named `callbackExecutor` are required. If the process dies between commit and processing, the row is still `NEW`: keep the poller as the safety net.
5. For your own outbound mutating calls send an idempotency key derived from the business request id, and store it.

## 10. Logging and metrics per provider

- Log provider code, request id and trace id on every call and failure. `traceId` comes from MDC (Micrometer Tracing), not from hand-made ids:

```java
log.info("provider call ok provider={} requestId={} traceId={}", providerCode, requestId, MDC.get(MdcKeys.TRACE_ID));
```

- Never log document numbers, images, tokens or full bodies. A record's `toString` prints every field: override it (see `VerifyCommand`) or log only selected fields; mask identifiers with the shared `Masking` util.
- Metrics: the `Timer` (tags `provider`, `outcome`) and failure `Counter` in the template; Resilience4j adds breaker, retry and bulkhead metrics under the same instance name.

## 11. Tests with WireMock

One test class per adapter (`C06AdapterTest`) with `@WireMockTest`. Because Resilience4j is applied in the template, a hand-built adapter test exercises retry and breaker with no Spring context.

- success mapped to the domain result;
- 4xx gives `ProviderRejectedException` with no retry (verify one request);
- 5xx gives `ProviderUnavailableException` after the configured attempts;
- timeout gives `ProviderUnavailableException`; with retry on, the call takes about `maxAttempts` read timeouts plus backoff, so use `maxAttempts(1)` or short timeouts in the test when asserting duration;
- malformed body and unknown or missing result code give `ProviderProtocolException`;
- retry: a WireMock scenario that fails once then succeeds;
- callback delivered twice is processed once.

Add the new code to `ProviderRegistryTest`, and make sure `StackcrewArchitectureTest` still passes.

## Camel variant (only if the profile lists the camel add-on)

Skip this section unless `stackcrew.json` has `camel` in `addons`. When it does, route many providers with Apache Camel instead of the hand-written template base:

- One `RouteBuilder` per provider for the port entry: `from(CamelEndpoints.VERIFY_C06)` (a constant such as `"direct:verify-c06"`) receives the typed request record, throttles, maps through the ACL mapper and calls the HTTP component (marshal and unmarshal JSON in a separate `direct:` route). It declares no `handled(true)` and no dead letter channel: typed exceptions propagate to the caller.
- Keep the same port: a `CamelProviderAdapter implements ProviderPort` calls `ProducerTemplate.requestBody` with the typed record, unwraps `CamelExecutionException` and rethrows the typed provider exception (`ProviderRejectedException`, `ProviderUnavailableException`), then maps the typed reply through the same ACL mapper.
- Retry, redelivery and the dead letter channel belong to a separate async ingress route in its own `RouteBuilder` (broker in, unmarshal, validate, idempotent consumer, then `to(CamelEndpoints.VERIFY_C06)`); see the `camel` add-on rules.
- Typed beans only at route edges; no `Map<String, Object>` exchange bodies.
- Retry, throttling and DLQ come from Camel EIPs. Do not also wrap the same call in Resilience4j retry.

## Do not

- Do not let a provider record, `JsonNode` or `Map<String, Object>` reach a service, controller or domain type.
- Do not copy an existing adapter and edit it; use the template base.
- Do not hardcode URLs, provider codes, header names, status strings, qualifier names, endpoints or timeouts.
- Do not add an `if/else` chain on the provider code; use the registry.
- Do not build a template base, registry or strategy for a single provider when `docs/stackcrew/architecture-profile.md` does not record that more are expected (`ProviderClientFactory` and `ProviderProperties` are plain configuration plumbing and are fine from the first provider).
- Do not retry non-idempotent calls blindly, do not retry or trip the breaker on 4xx, and do not swallow provider errors into `null` or an empty result.
- Do not call the provider inside a `@Transactional` method, and do not rely on `@Transactional`, `@Retry` or `@CircuitBreaker` through `this.` self-invocation.
- Do not return provider messages or codes to API clients; use a stable `ProblemDetail` detail.
- Do not test against the real provider; use WireMock.
