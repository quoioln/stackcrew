# Singleton

One shared instance of a collaborator. Get it from the DI container's scope, never from a hand-written global.

## Signals

- A stateless or thread-safe collaborator (client, mapper, registry, cache, clock) is created repeatedly or passed around by hand.
- Code reaches for `static` state or a module-level variable to share an object.
- An expensive resource (connection pool, HTTP client, compiled regex or schema) must be created once.

## Use when

- The object is stateless, or its state is immutable or safely synchronized.
- Creating it more than once is wasteful or wrong (a pool, a registry, a rate limiter).
- The DI container can own it: then the container's default scope is the singleton.

## Do not use when

- The object holds per-request, per-user or per-tenant state: use a request scope, a parameter or a new instance.
- It would be global mutable state (a `static` map, a module-level `let`, a package-level `var` that is written after startup). Forbidden.
- A hand-written `getInstance()` where the container already manages the object.
- The only reason is convenience of access; pass it as a dependency.

## Idioms

### Java (Spring Boot / Quarkus)

- A Spring bean is a singleton by default; do nothing special. Use constructor injection and keep the bean stateless or immutable. Quarkus: `@ApplicationScoped` (or `@Singleton`).
- No `static getInstance()`, no `static` mutable fields. A per-request value goes in a method parameter or a `@RequestScope` bean, never in a field of a singleton.
- A pure constant holder outside the container is a `final` class with a private constructor (like `ProviderCodes`), not an enum with one constant.

### TypeScript (NestJS / Next.js / React / Angular)

- NestJS: providers are singletons by default (`Scope.DEFAULT`). Do not use `Scope.REQUEST` unless per-request state is truly needed, as it makes the dependent chain request-scoped too.
- Angular: `@Injectable({ providedIn: 'root' })` gives one instance per app.
- Next.js: module-level instances are per server process and can be duplicated by hot reload in development; keep clients stateless, or cache on `globalThis` for dev-only resources such as a DB client.
- React: share through context or a store; do not use a module-level mutable variable.

### Go

- Constants and cheap read-only values: a package-level `var x = regexp.MustCompile(...)`, initialized once at program start.
- Expensive or optional values: `sync.OnceValues` (Go 1.21+) for lazy, once-only initialization that returns the load error to every caller instead of panicking; `sync.OnceValue` when it cannot fail. Not a hand-written once-flag plus a package-level pointer.
- Preferred for anything with dependencies: build it in `main` and pass it to constructors. Avoid package-level `var` that is mutated after startup.
- If it holds state, protect it with a mutex or a channel, or do not share it.

## Example

Language: Go. A cheap constant value, and an expensive one initialized lazily and once.

```go
// Cheap and constant: initialized once at program start.
var referencePattern = regexp.MustCompile(`^[A-Z]{3}-\d{8}$`)

// Expensive or optional: built on first use, exactly once (Go 1.21+); the error is returned, not panicked.
var loadModel = sync.OnceValues(func() (*RiskModel, error) {
	return LoadRiskModel(riskModelPath)
})

func ScoreApplication(ctx context.Context, in Application) (RiskScore, error) {
	model, err := loadModel()
	if err != nil {
		return RiskScore{}, fmt.Errorf("load risk model: %w", err)
	}
	return model.Score(ctx, in)
}
```

## AI anti-patterns

- Writing `getInstance()` with double-checked locking in a Spring, Quarkus or Nest project.
- A `static` or module-level mutable map used as a cache or session store.
- Marking a bean `@Scope("prototype")` or Nest `Scope.REQUEST` without per-request state, or the opposite: storing request data in a singleton field.
- A singleton used as a service locator (`Registry.get("x")` from anywhere) instead of injection.
- A package-level `var db *sql.DB` assigned in `init()` and used by every package.
- An enum with one constant as a constants holder in Java.
