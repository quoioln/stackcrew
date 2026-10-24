# Decorator

Add behavior around an object without changing it or subclassing it: retry, logging, metrics, caching, authorization.

## Signals

- The same cross-cutting code (timing, logging, caching, retry) is copied around several methods or classes.
- A class has grown a `LoggingXService`, `CachingXService`, `RetryingXService` subclass family.
- The behavior should be switchable by configuration without changing the core class.

## Use when

- Several concerns wrap one contract and may be combined in different orders.
- The wrapped type has a clear interface (port) that the decorator also implements.
- The framework has no native hook for it, or an explicit wrapper is clearer than a hidden proxy.

## Do not use when

- One behavior, applied in one place: put it inline or in the single caller.
- The framework already provides it: use that (see Idioms) instead of writing the wrapper by hand.
- The cross-cutting behavior needs access to the wrapped object's internals; that is not decoration.
- A stack of more than two or three decorators makes the call path hard to follow; reconsider.

## Idioms

### Java (Spring Boot / Quarkus)

- Programmatic: a class that implements the port and holds the delegate through the constructor (`TimedProviderPort implements ProviderPort`). Good for resilience keyed by provider code, with no proxy or self-invocation traps (see [resilience.md](resilience.md)).
- Declarative: Spring AOP aspects, `@Cacheable`, `@Transactional`, Quarkus interceptors. Remember that calling a method through `this` bypasses the proxy.
- Servlet filters and `HandlerInterceptor` are chains, see [chain-of-responsibility.md](chain-of-responsibility.md).

### TypeScript (NestJS / Next.js / React / Angular)

- NestJS: an interceptor (`NestInterceptor`) is the decorator for request handlers; custom TypeScript decorators and method wrappers fit for services.
- A higher-order function: `withRetry(fn, policy)` returns a function of the same type.
- React: a custom hook or a higher-order component only when a hook cannot do the job. Angular: `HttpInterceptorFn` for HTTP calls.

### Go

- A struct that wraps the same small interface: `type timed struct{ next Doer }` with a `Do` method that delegates.
- Or a function type: `type Middleware func(Handler) Handler`; apply with `chain(h, mw1, mw2)`. HTTP middleware is the common case.

## Example

Language: TypeScript. A higher-order function adds timing to any async function of the same type.

```typescript
export type AsyncFn<In, Out> = (input: In) => Promise<Out>;

export function withTiming<In, Out>(
  name: string,
  fn: AsyncFn<In, Out>,
  record: (name: string, millis: number) => void,
): AsyncFn<In, Out> {
  return async (input) => {
    const startedAt = performance.now();
    try {
      return await fn(input);
    } finally {
      record(name, performance.now() - startedAt);
    }
  };
}
```

## AI anti-patterns

- Writing a decorator class for one concern in one place.
- Re-implementing a framework feature (`@Cacheable`, a Nest interceptor, an HTTP middleware) by hand.
- A decorator that changes the contract (different types or semantics) instead of only adding behavior.
- Relying on a Spring proxy annotation from `this.method()` inside the same class.
- Stacking many wrappers without a documented order (retry outside the circuit breaker, or the reverse, by accident).
- Subclassing the target for each concern instead of wrapping it.
