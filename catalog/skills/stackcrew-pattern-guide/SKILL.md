---
name: stackcrew-pattern-guide
description: Use when deciding whether a concrete code change needs a design pattern (Template Method, Factory, Adapter, Bridge, Builder, Strategy, Singleton, Outbox, …) or when reviewing a pattern choice; gives signals, when not to use it, and idioms per language.
kind: advisor
---
# Pattern guide

This guide backs the SC-PATTERN rule: no pattern without a present signal, and if the signal is present, do not skip the pattern. It is language-agnostic. Every pattern file has idioms for Java (Spring Boot / Quarkus), TypeScript (NestJS / Next.js / React / Angular) and Go; read the subsection for the language you are editing.

## How to use this guide

1. Read `docs/stackcrew/architecture-profile.md` and `stackcrew.json` first. They record the architecture style, the integrations expected, and the pattern decisions already made. Follow them.
2. Describe the change in one sentence, then look for signals in the table below. Quote the signal you found in the SC-PREFLIGHT "Pattern" line, for example: "Pattern: Strategy, because a third `if (type == ...)` branch appeared."
3. Open the matching `patterns/<id>.md`. Check **Use when** and **Do not use when** against the real code, not the textbook.
4. If no signal fits, write "no pattern needed" with the reason. That is a valid and common answer.
5. If the pattern would depart from the profile, stop at the Decision gate and ask the user.

## Signal to pattern lookup

| Signal in the code or the requirement | Pattern |
|---|---|
| Several flows share one skeleton and differ in a few steps (authenticate, call, map, audit) | [Template Method](patterns/template-method.md) |
| Pick an implementation by a runtime key; a growing `if/else` or `switch` on a type or provider code (provider integrations: at the second provider, see the rule of three below) | [Strategy](patterns/strategy.md) with a registry; [Factory](patterns/factory.md) when creation itself varies |
| Create one of several implementations, or a family of products that must match | [Factory](patterns/factory.md) |
| Wrap a third-party API or SDK behind an internal port | [Adapter](patterns/adapter.md) |
| Third-party model or DTO differs from the domain model and must not leak into it | [Anti-Corruption Layer](patterns/anti-corruption-layer.md) |
| Two independent axes of change (business kind x channel or provider) | [Bridge](patterns/bridge.md) (rare; prove both axes) |
| Many optional parameters, immutable result, long constructor calls | [Builder](patterns/builder.md) |
| Interchangeable algorithms chosen by context, no shared skeleton | [Strategy](patterns/strategy.md) |
| One shared instance of a stateless or thread-safe collaborator | [Singleton](patterns/singleton.md) (use the DI scope) |
| A DB write and a published event must agree (dual write) | [Outbox](patterns/outbox.md) |
| Cross-cutting behavior around a call: retry, log, metric, cache | [Decorator](patterns/decorator.md) |
| A request passes through ordered, skippable steps (validate, authenticate, enrich) | [Chain of Responsibility](patterns/chain-of-responsibility.md) |
| Network call to something we do not control | [Resilience](patterns/resilience.md) (timeout, retry, circuit breaker, bulkhead) |
| Domain code is tied to persistence details, or several writes must commit together | [Repository / Unit of Work](patterns/repository-unit-of-work.md) |
| Choosing how the whole service or module is structured | [architecture-styles.md](architecture-styles.md) |
| In-process event, lightweight broker or Kafka | skill `stackcrew-messaging-choice` |

## Rules that apply to every pattern

- **No pattern without a present signal.** A signal is something in the code or the requirement today: duplication, a changing axis, a second implementation, a testability problem. "It might be needed later" is not a signal. Prefer the simplest direct solution (KISS, YAGNI).
- **If the signal is present, do not skip the pattern.** A third copy-pasted flow, a `switch` that grows with every provider, or a dual write with no outbox are defects, not style choices.
- **Rule of three.** Duplicate once, tolerate twice, refactor toward the pattern at the third real case. Provider-integration exception: when the profile records that more providers are expected (an integration hub), introduce the Template Method base and the registry at the first provider that has a sibling coming, and in any case at the second; with exactly one provider expected, keep a plain adapter. This matches step 0 of `stackcrew-spring-integration-provider` and applies to the other stacks too.
- **Prefer the language idiom.** A map of functions beats a Strategy class in TypeScript and Go; the DI container beats a hand-rolled Factory or Singleton; a record beats a Builder for few fields; functional options beat a builder in Go; hooks and composition beat class hierarchies in React. Use the idiom when it expresses the same intent more simply.
- **Name by intent.** `ProviderRegistry`, `VerifyTemplate`, `PaymentGatewayAdapter`. Do not name things `Manager`, `Helper` or `Util` to hide a pattern.
- **Patterns serve SOLID.** Use them for SRP, OCP and DIP. If a pattern adds indirection that makes the code harder to read, remove it.
- **Record the decision.** When the choice changes the architecture (a new registry, an outbox, a bridge, a break from the profile), add an entry to `stackcrew.json` `decisions[]` with `id`, `area`, `decision`, `rationale` and `rejected[]`. Small local choices only need the SC-PREFLIGHT line.
- **Anti-pattern-itis.** Do not add an interface for a single implementation with no second one planned, a factory for a constructor call, a builder for three required fields, a singleton holding mutable state, a decorator stack for one behavior, or a chain of one handler. When reviewing, flag both mistakes: a pattern without a signal, and a missing pattern where the signal is clear.
- **Document with the code.** Put the pattern and the rejected alternatives in the ADR or implementation note when one is required; keep the class names aligned with the pattern's intent.

## Related

- Provider integrations in Spring Boot combine Adapter, ACL, Strategy registry, Template Method and Resilience: skill `stackcrew-spring-integration-provider`.
- Add-on rules for brokers: `addon-kafka`, `addon-rabbitmq`, `addon-camel`.
