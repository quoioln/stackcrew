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
- An `enum` with one constant is acceptable for a pure constant holder outside the container.

### TypeScript (NestJS / Next.js / React / Angular)

- NestJS: providers are singletons by default (`Scope.DEFAULT`). Do not use `Scope.REQUEST` unless per-request state is truly needed, as it makes the dependent chain request-scoped too.
- Angular: `@Injectable({ providedIn: 'root' })` gives one instance per app.
- Next.js: module-level instances are per server process and can be duplicated by hot reload in development; keep clients stateless, or cache on `globalThis` for dev-only resources such as a DB client.
- React: share through context or a store; do not use a module-level mutable variable.

### Go

- A package-level instance is initialized lazily with `sync.Once` when it is truly needed, or built in `main` and passed to constructors (preferred).
- Pass dependencies explicitly. Avoid package-level `var` that is mutated after startup.
- If it holds state, protect it with a mutex or a channel, or do not share it.

## Example

Language: Go. A lazily created, read-only compiled expression, shared safely.

```go
var (
	referencePattern     *regexp.Regexp
	referencePatternOnce sync.Once
)

const referenceExpr = `^[A-Z]{3}-\d{8}$`

func ReferencePattern() *regexp.Regexp {
	referencePatternOnce.Do(func() {
		referencePattern = regexp.MustCompile(referenceExpr)
	})
	return referencePattern
}
```

## AI anti-patterns

- Writing `getInstance()` with double-checked locking in a Spring, Quarkus or Nest project.
- A `static` or module-level mutable map used as a cache or session store.
- Marking a bean `@Scope("prototype")` or Nest `Scope.REQUEST` without per-request state, or the opposite: storing request data in a singleton field.
- A singleton used as a service locator (`Registry.get("x")` from anywhere) instead of injection.
- A package-level `var db *sql.DB` assigned in `init()` and used by every package.
