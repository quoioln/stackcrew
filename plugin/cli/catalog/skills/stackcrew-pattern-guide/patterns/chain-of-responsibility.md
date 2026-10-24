# Chain of Responsibility

An ordered pipeline of handlers; each handles the request, passes it on, or stops it.

## Signals

- A request goes through several ordered steps: authenticate, authorize, validate, enrich, rate-limit, then handle.
- A long method with many early returns that each guard one concern.
- Steps must be added, removed or reordered by configuration.

## Use when

- There are at least three ordered, independent steps, each able to short-circuit.
- Steps are cross-cutting and reused across endpoints or flows.
- The framework offers a native pipeline (filter chain, middleware, guards, interceptors); then use that.

## Do not use when

- Two steps in a fixed order: call them in sequence.
- Every step always runs and no step can stop the flow; that is plain sequential code or a [Template Method](template-method.md).
- Steps depend on each other's internal state so tightly that they are not independent.
- A custom chain would duplicate what the framework already does.

## Idioms

### Java (Spring Boot / Quarkus)

- Use the framework chain first: servlet `Filter` or `OncePerRequestFilter`, Spring Security's filter chain, `HandlerInterceptor`; Quarkus: JAX-RS filters. Order with `@Order` or explicit registration.
- A custom chain: a `List<Step>` injected by constructor (ordered with `@Order`) and a loop that stops when a step returns a rejection. A `sealed interface` result (`Continue`, `Reject`) beats exceptions for control flow.

### TypeScript (NestJS / Next.js / React / Angular)

- NestJS: middleware, guards, pipes and interceptors already form the chain, in a fixed order; choose the right one instead of building your own.
- Next.js: `middleware.ts` and route handler wrappers; compose with small functions.
- Angular: functional interceptors and route guards. Express-style `(req, res, next)` for plain Node.
- A custom chain: an array of typed functions reduced into one.

### Go

- Middleware: `type Middleware func(http.Handler) http.Handler` and a helper that applies them in order; `chi` provides `r.Use(...)`.
- For non-HTTP: a slice of `func(ctx context.Context, in *Input) error` run in order, stopping at the first error.

## Example

Language: Go. Middleware composed in an explicit order.

```go
type Middleware func(http.Handler) http.Handler

// Chain applies middleware so that the first one listed runs first.
func Chain(final http.Handler, middleware ...Middleware) http.Handler {
	for i := len(middleware) - 1; i >= 0; i-- {
		final = middleware[i](final)
	}
	return final
}

func NewServer(api http.Handler, auth, rateLimit, requestLog Middleware) http.Handler {
	return Chain(api, requestLog, auth, rateLimit)
}
```

## AI anti-patterns

- Building a custom handler chain when the framework already has filters, guards or middleware.
- A chain of two handlers, or a chain where every handler always runs.
- Steps coupled through a shared mutable context bag typed as `Map<String, Object>` or `any`.
- Control flow by throwing exceptions to stop the chain, instead of an explicit result.
- An undocumented order, so authentication ends up after the handler that needs it.
- Skipping the pipeline when the signal is clear: one endpoint method that authenticates, validates, rate-limits and logs by hand.
