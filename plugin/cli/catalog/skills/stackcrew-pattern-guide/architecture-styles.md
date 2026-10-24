# Architecture styles

Pick the style at `init` and record it in `docs/stackcrew/architecture-profile.md` and `stackcrew.json` `decisions[]`. Departing from it later is a Decision gate item. The profile's answers on scale, timeline, stability and extensibility drive the choice; start with the simplest style that fits and move on a present signal, not a guess.

How to read the **Fit** line in each style:
- **Scale**: team size and load. **Timeline**: how fast the first release must ship. **Stability**: how much the requirements and the domain are expected to change. **Extensibility**: how many integrations, providers or channels are expected.

## Layered

Controller, service, repository; each layer depends only on the one below.

**Signals**: simple CRUD, one team, a domain with little behavior, a deadline close.
**Use when**: the service is small to medium, the rules are mostly validation and persistence, and the team knows the framework well.
**Do not use when**: the domain has rich rules that start leaking into controllers and repositories, or many external integrations need isolating (use hexagonal).
**Fit**: scale small to medium, timeline short, stability medium, extensibility low. Move to hexagonal when the first real integration arrives.

## Hexagonal (ports & adapters)

The domain and use cases sit in the middle and depend only on ports; adapters (HTTP, DB, brokers, providers) depend on the domain.

**Signals**: several third-party integrations, a need to test the domain without infrastructure, an expected provider or database swap.
**Use when**: integration-heavy or transaction-heavy systems, long-lived products, strong stability needs; the profile lists more than one external provider.
**Do not use when**: a thin CRUD API or a prototype; the ports would each have one adapter forever.
**Fit**: scale medium to large, timeline medium, stability high, extensibility high. It is the default for integration hubs. See [adapter](patterns/adapter.md) and [anti-corruption-layer](patterns/anti-corruption-layer.md).

## Modular monolith

One deployable, split into modules with explicit public APIs and no cross-module table access.

**Signals**: a growing codebase with tangled packages, several teams in one repository, a likely later split into services.
**Use when**: the domain has clear bounded contexts but you do not need independent deployment or scaling yet; you want microservice-like boundaries without distributed-system cost.
**Do not use when**: the team has no discipline on module boundaries and no way to enforce them (ArchUnit, module checks); or modules truly need different scaling or release cycles today.
**Fit**: scale medium to large, timeline medium, stability high, extensibility medium to high. Often the best default instead of microservices.

## Microservices

Independently deployable services, each owning its data, communicating over the network.

**Signals**: independent teams, parts that need different scaling or release cadence, a clear need for fault isolation or polyglot stacks.
**Use when**: the organization and the domain boundaries are stable enough to justify distributed operations (observability, contracts, [resilience](patterns/resilience.md), messaging, [outbox](patterns/outbox.md)).
**Do not use when**: one small team, an unclear domain, a fast first release, or "for scalability" without a measured need. A distributed monolith is worse than a monolith.
**Fit**: scale large, timeline long, stability high (boundaries must hold), extensibility high. Needs a platform: CI/CD, tracing, a broker (see skill `stackcrew-messaging-choice`).

## CQRS

Separate the model that changes state (commands) from the model that reads it (queries).

**Signals**: read and write shapes differ a lot, heavy read traffic or reports that distort the write model, different scaling or consistency for reads.
**Use when**: reads need denormalized or cached views, or the write side has complex rules; a read model can be eventually consistent.
**Do not use when**: simple CRUD, where one model serves both; the team cannot handle eventual consistency; you only want separate classes (that is just separating services, not CQRS).
**Fit**: scale medium to large, timeline medium to long, stability medium, extensibility high on the read side. Start with separate command and query services on one database; add a separate store only on a measured need.

## Event-driven

Components communicate by publishing and reacting to events.

**Signals**: several consumers react to one fact, a workflow spans services, loose coupling and audit trails matter, spikes need buffering.
**Use when**: producers should not know consumers, and eventual consistency is acceptable; pair with [outbox](patterns/outbox.md) and idempotent consumers. Choose the transport with skill `stackcrew-messaging-choice`.
**Do not use when**: the flow needs an immediate answer to the caller, a strict global order across keys, or the team cannot yet operate and debug asynchronous flows. In-process direct calls are simpler.
**Fit**: scale medium to large, timeline medium to long, stability medium, extensibility high. Start in-process; add a broker when a second independent consumer or durability requires it.

## Frontend structure

Applies to React, Next.js and Angular. Decide these three things and record them in the profile.

**Feature folders vs layer folders**
- Feature folders (`features/orders/{components,hooks,api,state}`) group by business capability. Prefer feature folders for anything beyond a small app: changes stay local and features can be removed or lazy-loaded.
- Layer folders (`components/`, `services/`, `hooks/`) suit small apps and shared UI kits. Keep a thin `shared/` for truly cross-feature code. A feature must not import another feature's internals; go through its public `index`.

**Container / presentational**
- Presentational components take props and render; they have no data fetching. Containers (or hooks, or Angular smart components) fetch data, hold state and pass it down. In React prefer a custom hook for logic over a container component; in Angular, smart components with `OnPush` presentational children.
- Do not split a trivial component only to follow the pattern.

**State choice** (use the lowest rung that works)
1. Local state (`useState`, `signal()`, component fields) for UI state used by one component.
2. Server-state cache (TanStack Query, Angular's `resource` or a query library, Next.js server components with route cache) for anything that comes from an API. Never copy server data into a global store.
3. A store (NgRx, signal store, Zustand, Redux Toolkit) for cross-feature client state: wizard progress, auth session, undo history. Add it on a present signal (prop drilling across several levels, shared mutable client state), not by default.
- URL state (search params) is the source of truth for filters and pagination.
