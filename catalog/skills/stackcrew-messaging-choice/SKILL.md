---
name: stackcrew-messaging-choice
description: Use when deciding between in-process events, a lightweight broker (RabbitMQ, Redis, cloud Pub/Sub) and Kafka for a concrete integration or event flow.
kind: advisor
---
# Messaging choice

Pick the lightest transport that meets the requirement. Adding a broker or an integration framework is new infrastructure: stop at the Decision gate, present 2-3 options with trade-offs, and record the outcome in `stackcrew.json` `decisions[]`. Read `docs/stackcrew/architecture-profile.md` first; it may already have decided.

## Decision tree

Answer in order and stop at the first match.

1. **Same service, no durability needed, a lost event on a crash is acceptable?**
   Use **in-process events**:
   - Java: Spring `ApplicationEvent` with `@EventListener` (use `@TransactionalEventListener(phase = AFTER_COMMIT)` to react after a commit; it is still lost on a crash).
   - NestJS: `EventEmitter2` from `@nestjs/event-emitter` (`EventEmitterModule.forRoot()`, `emit`, `@OnEvent`).
   - Go: channels (with `context` for shutdown) or a small typed callback list.
   - Next.js, React, Angular: component or store events and signals; not a messaging concern.
2. **Work distribution, task queue, routing by key, low to medium volume, no replay, per-message ack, TTL or dead-lettering, simple operations?**
   Use a **lightweight broker**: RabbitMQ (rules: `addon-rabbitmq`), Redis Streams or Pub/Sub, or a cloud Pub/Sub. For background jobs in NestJS use BullMQ (Redis); in Go use Watermill with the chosen backend.
3. **Replay or long retention, ordering per key, high throughput, many independent consumers reading at their own pace, audit trail or event sourcing, stream processing?**
   Use **Kafka** (rules: `addon-kafka`).
4. **Routing, transformation and delivery across many providers (Enterprise Integration Patterns), redelivery, DLQ, throttling?**
   On the JVM (Spring Boot, Quarkus) consider **Apache Camel** (rules: `addon-camel`); Camel is JVM-only and runs on top of a transport from steps 1-3. It is a routing layer, not a broker. For NestJS and Go, build the equivalent with adapter + registry + pipeline (see [adapter](../stackcrew-pattern-guide/patterns/adapter.md), [strategy](../stackcrew-pattern-guide/patterns/strategy.md), [chain of responsibility](../stackcrew-pattern-guide/patterns/chain-of-responsibility.md)), plus [resilience](../stackcrew-pattern-guide/patterns/resilience.md); queues via BullMQ (Node) or Watermill (Go).

If two answers are true, choose the earlier (lighter) step unless a requirement forces the later one, and write the reason.

## Comparison

| Need | In-process | Lightweight broker | Kafka |
|---|---|---|---|
| Survives a crash | No | Yes (durable queues) | Yes |
| Replay old events | No | No (or limited with Redis Streams) | Yes |
| Order | Call order | Per queue | Per partition key |
| Many independent consumers at their own pace | No | Fan-out exchange or consumer groups | Yes, consumer groups |
| Throughput | In memory | Low to medium | High |
| Per-message ack, TTL, DLX | No | Yes | Offsets; DLQ is built by you |
| Operations | None | Light | Heavier |

## Rules for every choice

- **Outbox:** when a database write and an event must agree (a dual write), use the Outbox pattern whatever transport you chose. See [outbox](../stackcrew-pattern-guide/patterns/outbox.md) in skill `stackcrew-pattern-guide`. In-process events with no broker do not need it.
- **At-least-once means idempotent consumers:** dedupe by event id. Add a dead-letter path and an alert on its size.
- **Typed events:** a named record, interface or struct per event; no `Map<String, Object>`, `any` or `interface{}` payloads. Event types and topic or queue names are constants.
- **Do not start with Kafka** for a flow that a task queue or an in-process event covers. Do not use in-process events across services.
- **Observability:** consumer lag, retries and DLQ counts feed the dashboards (`addon-observability`).

## Related

- Add-on rules (apply when listed in the profile): `addon-kafka`, `addon-rabbitmq`, `addon-camel`.
- Spring Boot: skills `stackcrew-spring-kafka-consumer` and `stackcrew-spring-integration-provider`.
- Patterns: skill `stackcrew-pattern-guide`.
