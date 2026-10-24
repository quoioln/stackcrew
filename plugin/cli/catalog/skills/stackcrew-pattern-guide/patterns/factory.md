# Factory / Abstract Factory

Decouple the choice and construction of an implementation from the code that uses it. An abstract factory builds a family of products that must match.

## Signals

- The implementation depends on a runtime parameter (provider code, tenant, file type, environment) and the caller should not know the concrete class.
- Construction needs configuration or collaborators that the caller should not assemble (HTTP client per provider, timeouts, credentials).
- A family of objects must be used together (a client, a signer and a mapper for one provider; a theme with matching widgets).

## Use when

- Creation logic is more than a constructor call: it reads configuration, wires collaborators, or picks among variants.
- Several call sites need the same creation logic (SC-REUSE).
- Objects of one family must never be mixed with objects of another.

## Do not use when

- A plain constructor call or `new` is enough. Do not write `XFactory` that only calls `new X()`.
- The DI container already creates and wires the objects. Let it.
- You only need to look up an existing instance by key. That is a registry (see [strategy.md](strategy.md)), not a factory.

## Idioms

### Java (Spring Boot / Quarkus)

- Selecting a bean by key: inject `List<ProviderPort>` and build a map keyed by `code()` (the registry in `stackcrew-spring-integration-provider`). Do not inject `Map<String, Port>` and use its keys as codes: Spring keys an injected map by bean name, not by `code()`.
- Creating instances on demand, or optional or prototype beans: `ObjectProvider<T>`. Quarkus: `Instance<T>`.
- Per-provider clients: a `ProviderClientFactory` that builds a `RestClient` from `@ConfigurationProperties` is configuration plumbing and is fine from the first provider.
- A `static` factory method on a record or class (`Money.of(...)`) is enough for validated construction.

### TypeScript (NestJS / Next.js / React / Angular)

- NestJS: a provider token plus a `useFactory` provider (`{ provide: PAYMENT_CLIENT, useFactory: (cfg: Config) => ..., inject: [Config] }`). Selection by key goes through a registry.
- A plain function returning the object (`createClient(config)`) is a factory; no class needed.
- Angular: an `InjectionToken` with a `factory`, or `providedIn: 'root'` with `inject()`.
- React: a component map (`Record<Kind, ComponentType<Props>>`) is the factory for UI variants.

### Go

- Prefer an explicit constructor `NewClient(cfg Config) (*Client, error)`. That is Go's factory and is enough most of the time.
- Selection by key: a `map[Kind]func(Config) (Port, error)`, returning the constructor's error to the caller, or a function with a `switch` that returns an interface.
- Return concrete types from constructors and accept interfaces in the consumer; avoid a `Factory` type unless several products must match.

## Example

Language: Go. A constructor map selects the implementation; unknown keys and constructor failures return errors.

```go
var ErrUnknownChannel = errors.New("unknown notification channel")

type Channel string

const (
	ChannelEmail Channel = "email"
	ChannelSMS   Channel = "sms"
)

type Sender interface {
	Send(ctx context.Context, msg Message) error
}

type Senders map[Channel]func(cfg Config) (Sender, error)

func (s Senders) New(ch Channel, cfg Config) (Sender, error) {
	build, ok := s[ch]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrUnknownChannel, ch)
	}
	return build(cfg)
}
```

## AI anti-patterns

- `XFactory` that wraps a single `new X()`, or a `FactoryFactory`.
- A hand-rolled factory when Spring, Nest or Angular DI already provides it.
- Selecting with a `switch` on a string literal in several places instead of one registry or factory.
- Using `Map<String, Object>` or `any` as the creation argument instead of a typed config.
- An abstract factory for a single product, or for a family that has only one member.
- A singleton factory with global mutable state.
