# Resilience (Timeout, Retry, Circuit Breaker, Bulkhead)

Protect the service from slow or failing dependencies that you do not control.

## Signals

- A network call to a third party, another service, a database or a broker.
- A provider outage that makes threads, connections or the whole service hang.
- A retry loop written by hand, or no timeout on an HTTP client.

## Use when

- Every outbound call to something you do not control: set a **timeout** first.
- **Retry** only idempotent operations, or ones with an idempotency key; use exponential backoff with jitter and a small attempt limit.
- **Circuit breaker** when repeated failures should stop traffic to a dependency for a while. Count only real provider trouble: a 4xx or a protocol error neither retries nor opens the breaker.
- **Bulkhead** when one slow dependency must not exhaust threads or connections shared with others.
- Key the configuration per provider, and record metrics for state changes and rejections.

## Do not use when

- Retrying a non-idempotent call (a payment charge) without an idempotency key.
- Stacking retries at several layers (client, service and gateway), which multiplies load during an outage.
- In-process calls and pure computation.
- A breaker with no visibility: an open circuit must show in logs, metrics and Grafana.

## Idioms

### Java (Spring Boot / Quarkus)

- Resilience4j, applied programmatically and keyed by provider code (see `stackcrew-spring-integration-provider`, step 5 for the template and step 7 for the YAML): create `CircuitBreaker`, `Retry` and `Bulkhead` from the registries and decorate the call. There are no proxy or self-invocation traps and the retry is unit-testable without Spring.
- Order: bulkhead innermost, then retry, circuit breaker outermost, so one logical call is one breaker record. In the `Decorators` builder the last `with...` call is the outermost.
- `CallNotPermittedException` and `BulkheadFullException` are translated to the typed `ProviderUnavailableException`; callers never see library exceptions.
- Annotation style (`@CircuitBreaker`, `@Retry`) works only through the proxy and needs aspect order set so the breaker wraps the retry; calls via `this` skip it.
- Quarkus: SmallRye Fault Tolerance (`@Timeout`, `@Retry`, `@CircuitBreaker`). Resilience4j 2.x supports Java 17; 3.x requires Java 21. `Decorators` is in `resilience4j-all`.
- Also configure the HTTP client connect and read timeouts.

### TypeScript (NestJS / Next.js / React / Angular)

- `cockatiel` composes policies with `wrap(...)`; the first policy listed is the outermost, so use `wrap(circuitBreaker, retry, timeout)` to keep the breaker outermost. `opossum` is a circuit breaker for Node. Create one policy per dependency and reuse it.
- Use `AbortSignal.timeout(ms)` for `fetch` and pass the signal into the call.
- Frontend: TanStack Query's `retry` and `retryDelay` for idempotent reads; do not retry mutations automatically.

### Go

- `context.WithTimeout` on every call and an HTTP client with `Timeout`. Import `github.com/sony/gobreaker/v2`, the generic version: `gobreaker.NewCircuitBreaker[T](settings)` and `Execute`. The v1 package returns `interface{}`, which violates SC-TYPE.
- A small retry helper with backoff and jitter that respects `ctx.Done()`. Create one breaker per dependency at startup.

## Example

Language: Java. Programmatic Resilience4j decoration, keyed by provider code; the circuit breaker is declared last, so it is outermost.

```java
public VerifyResult callWithResilience(String providerCode, Supplier<VerifyResult> call) {
    CircuitBreaker breaker = breakers.circuitBreaker(providerCode);
    Retry retry = retries.retry(providerCode);
    Bulkhead bulkhead = bulkheads.bulkhead(providerCode);

    // Order, innermost to outermost: bulkhead, retry, circuit breaker (one logical call = one breaker record).
    Supplier<VerifyResult> guarded = Decorators.ofSupplier(call)
            .withBulkhead(bulkhead)
            .withRetry(retry)
            .withCircuitBreaker(breaker)
            .decorate();
    try {
        return guarded.get();
    } catch (CallNotPermittedException | BulkheadFullException e) {
        throw new ProviderUnavailableException(providerCode, "provider call not permitted", e);
    }
}
```

## AI anti-patterns

- An HTTP call with no timeout.
- A hand-written `for` loop retry with a fixed sleep and no jitter or limit.
- Retrying non-idempotent calls, or retrying on every exception including 4xx client errors.
- Retries at every layer, so one failure becomes dozens of calls.
- Wrapping the breaker inside the retry, so each attempt is a separate breaker record and the breaker trips on retry noise.
- `@Retry` or `@CircuitBreaker` on a method invoked via `this`, so nothing happens.
- A shared breaker for all providers, so one outage opens the circuit for all of them.
- Letting `CallNotPermittedException` reach the caller instead of a typed domain error.
- Importing the non-generic `gobreaker` v1 package in Go.
