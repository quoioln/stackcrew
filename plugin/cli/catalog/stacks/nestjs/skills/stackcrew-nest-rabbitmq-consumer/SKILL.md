---
name: stackcrew-nest-rabbitmq-consumer
description: Use when adding or changing a RabbitMQ consumer or producer in a NestJS service with amqp-connection-manager and amqplib, such as consuming kyc.completed: the typed message and codec, the idempotency store, manual ack, the dead-letter exchange with wait and parking queues, the tenant and user context from message headers, the masked message_in line, publishing with the context headers, and the tests on a real broker.
kind: task
requiresAddons: ["rabbitmq"]
---
# Add a RabbitMQ consumer (NestJS 10, amqp-connection-manager)

Follow these steps in order. Write the SC-PREFLIGHT note first: the connection provider, the publisher, the codec, the idempotency table, the topology helper and the queue constants that already exist and that you will reuse. If a connection or an idempotency store exists you extend it; you never create a second one.

This implements `addon-rabbitmq` for Node. The example consumes `kyc.completed` and sets a customer profile's status. The request context, the masker and `writeCallLine` come from `stackcrew-nest-request-logging`; the tenant repository from `stackcrew-nest-typeorm-entity`. Set those up first.

## 1. Dependencies (ask the user before adding any)

- `amqp-connection-manager` 4.1.x, with `amqplib`: one connection that reconnects by itself and re-runs each channel's setup. On `amqplib` 0.10 add `@types/amqplib` as a dev dependency; `amqplib` 2.x ships its own types. `amqp-connection-manager` 5 needs Node 22 and depends on an ESM-only package: Node 22 loads it, but Jest's CommonJS runtime does not without extra configuration, so a Nest 10 project tested with Jest stays on 4.1.x.
- Tests: `@testcontainers/rabbitmq` and `@testcontainers/postgresql` (the same major as the project's Testcontainers), with `rabbitmq:4-alpine` and `postgres:16-alpine`.
- Do not switch to the `@nestjs/microservices` RMQ transport for this: it has no built-in wait queue, attempt cap or confirmed parking, and the code below needs the delivering channel for each settlement.

## 2. Files

Each `<file>.md` next to this skill holds one source file: its first line says where the file goes, and the code block is the file's content. The `common/messaging` files are shared by every consumer and producer; the `messaging` folder of the feature holds one consumer.

| File | What it does |
|---|---|
| `messaging.types.ts.md` | `MessageEnvelope` (id, type, version, occurredAt), `WorkQueue`, `ContextHeaders`. |
| `rabbitmq.connection.ts.md` | `RabbitMqConnection`: the one connection; `createChannel(name, options)` adds a structured `'error'` listener; never logs the URL. |
| `work-queue.ts.md` | `assertWorkQueue` (main, DLX, wait, parking) and `failedDeliveries` from `x-death`. |
| `message-errors.ts.md` | `ParkReason`, `NonRetryableMessageError`, `InvalidMessageError`, `parkReasonOf`. |
| `message-codec.ts.md` | `decodeMessage(Class, payload)`: parse once, validate, or throw a non-retryable error. |
| `message-publisher.ts.md` | `MessagePublisher` and `contextHeaders`: persistent JSON, confirms, the three headers. |
| `processed-message.entity.ts.md`, `create-processed-message.migration.ts.md` | The idempotency table, extending `{{sc:baseEntity}}`. |
| `processed-message.store.ts.md` | `markIfNew(manager, consumer, messageId)`: insert-or-ignore in the caller's transaction. |
| `messaging.module.ts.md` | Connection, publisher and store. |
| `kyc-completed.message.ts.md` | The typed message (class-validator). |
| `kyc-messaging.constants.ts.md` | Exchange, routing key, queue, retry delay, attempts, prefetch, consumer name. |
| `kyc-completed.handler.ts.md` | Marker and effect in one transaction, through `withManager`. |
| `kyc-completed.consumer.ts.md` | Topology, context, `message_in`, ack, retry or park. |
| `kyc-completed.module.ts.md` | The consumer's module. |
| `message-codec.spec.ts.md`, `work-queue.spec.ts.md` | Unit tests. |
| `kyc-completed.consumer.e2e.spec.ts.md` | e2e tests on RabbitMQ and Postgres. |

## 3. Configuration and wiring

Add a section to `src/config/env.ts`, then add `parseEnvSection(RabbitMqEnv, raw)` to `validateEnv`, `RabbitMqEnv` to the `Env` type, and its variables to the `raw` of the `validateEnv` test in `env.spec.ts`:

```ts
// src/config/env.ts (add)
export class RabbitMqEnv {
  /** amqp:// or amqps:// with the credentials of this service's own vhost user. Never logged. */
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['amqp', 'amqps'] })
  RABBITMQ_URL!: string;
}
```

- Add `CreateProcessedMessage1730000000001` to `migrations` in `DatabaseModule` (rename the timestamp to follow the project's last migration).
- Import `KycCompletedModule` in `AppModule`. `main.ts` calls `app.enableShutdownHooks()`, so a deploy cancels the consumer (`onModuleDestroy`), sets `stopping` (a reconnect during the drain registers nothing), and waits for the cancel, the deliveries in flight and the channel close, all within `SHUTDOWN_GRACE_MS`. Nest runs `onModuleDestroy` deepest module first, so `MessagingModule`'s hooks would run before the consumers drained: the publisher therefore closes its channel in `beforeApplicationShutdown`, which runs after every module's `onModuleDestroy` (a handler can still publish during the drain), and the connection closes in `onApplicationShutdown`, last; each within `CLOSE_GRACE_MS`. Anything still unacked goes back to the queue. Keep `SHUTDOWN_GRACE_MS` plus twice `CLOSE_GRACE_MS` (20 s with the defaults) under the pod's `terminationGracePeriodSeconds` (30 s by default), less any `preStop` delay.
- Readiness only, never liveness: the readiness probe (`@nestjs/terminus`, for example `/health/ready`) reports down when `RabbitMqConnection.isConnected()` or `KycCompletedConsumer.isConsuming()` is false. The liveness probe never reads them; a restart cannot fix a broker or queue problem, and `core-backend-api` keeps liveness and readiness separate.
- That readiness couples the HTTP API to the broker. A broker outage, or a deleted queue (which cancels the consumer on every replica at once), makes every replica not ready together, and the Service has no endpoints left for HTTP until the reconnect. When the HTTP API must survive a broker outage, run the consumers as a separate Deployment (the same image, started with only the messaging modules) whose readiness reads the consumer, and leave the broker out of the API Deployment's readiness.
- Use `amqps` and a vhost per service with only the permissions it needs, outside local development.

## 4. Topology (addon-rabbitmq)

`assertWorkQueue` declares, on every (re)connect:

- the **main queue** (quorum), bound to the producer's exchange with the routing key, with a **dead-letter exchange** `<queue>.dlx`: a nacked message goes there with key `wait`;
- the **wait queue** with `x-message-ttl` = `retryDelayMs`: when it expires, the message goes back through the default exchange to the main queue only (never through the producer's exchange, which would hand the retry to every other bound queue);
- the **parking queue**, no TTL, for messages that cannot succeed.
- Main and wait queues use `x-dead-letter-strategy: at-least-once` with `x-overflow: reject-publish`, so a message is not lost between queues.
- The attempt count is the broker's `x-death` count for the main queue (reason `rejected`). At `maxAttempts` a failing message is parked instead of nacked.
- Queue arguments are fixed when a queue is first declared; redeclaring with other values closes the channel (`PRECONDITION_FAILED`). Change them with a new queue name or a broker policy.
- Names, the delay, the cap and the prefetch are constants in the feature (`KYC_COMPLETED_QUEUE`).

## 5. The message and the codec

- One class per message type and version, with class-validator rules and the envelope fields `messageId`, `type`, `version`, `occurredAt`. No `any`, no `Record<string, unknown>` past the codec.
- `decodeMessage` parses once, at the edge. An empty payload (a tombstone), text that is not a JSON object, or a message that breaks its schema throws `InvalidMessageError`: parked at once, never retried. Unknown fields are dropped, so a producer can add a field; a breaking change is a new version with its own class.
- No error message or exception cause carries payload text.

## 6. The consumer

`kyc-completed.consumer.ts` is the shape to copy:

- `onApplicationBootstrap` creates a channel (`createChannel(name, { setup })`) whose `setup` declares the topology and sets `prefetch`, and registers the consumer through the wrapper (`channel.consume(queue, onMessage, { noAck: false, consumerTag })`). The wrapper owns the consumer: after every reconnect it runs `setup` and then registers it again.
- After a broker cancel (the queue was deleted or the broker cancelled the consumer), the wrapper re-registers the consumer at once, on the same channel. When the queue is gone, that registration gets a 404, which closes the channel; recovery is then the reconnect described below, whose `setup` re-declares the queue before the consumer is registered again. No restart is needed.
- `setup` records the raw channel it got. Deliveries arrive on that channel, so they are acked, nacked or parked on it, never through the wrapper's current channel.
- Every channel needs an `'error'` listener: amqp-connection-manager emits `'error'` when `setup` rejects (a queue redeclared with other arguments gives `PRECONDITION_FAILED`, 406), and an emitter with no listener throws and crashes the process. `RabbitMqConnection.createChannel` attaches one that logs the channel, the error class and the AMQP code, never the message.
- A channel the broker closes (a 406 from a double ack, a failed setup) is not re-created on its own: amqp-connection-manager 4.x re-creates channels after a reconnect. amqplib's unhandled channel `'error'` takes the connection down, and `RabbitMqConnection` reconnects after `RECONNECT_SECONDS`, which runs every setup again. Do not attach an `'error'` listener to the raw channel inside `setup`: it would keep the connection up and leave the consumer gone. The reconnect is of the shared connection, so it pauses publishing too: amqp-connection-manager holds each publish in memory until the connection is back, at most `PUBLISH_TIMEOUT_MS` (then the publish rejects). While a setup keeps failing, this repeats every `RECONNECT_SECONDS`; fix the cause, such as the queue arguments.
- A failed setup does not exit the process. `isConsuming()` stays false, so the readiness probe fails. A rolling deploy then stops before it replaces the pods that are still ready, and the not-ready pod is taken out of the service's endpoints, so it gets no traffic, rather than restarted into the same `PRECONDITION_FAILED`. `isConsuming()` is false from a channel close until the reconnect's `setup` succeeds. Alert on the readiness failure and on a consumer count of 0.
- Each delivery runs inside `runWithRequestContext(contextFromMessageHeaders(headers), ...)`: the request id, tenant and user come from `x-request-id`, `x-tenant-id` and `x-user-id`, sanitized; unsafe values count as absent. A consumer never runs as the system identity: `x-user-id: {{sc:systemUser}}` is an ordinary user and cannot call `runCrossTenant`. Only scheduled jobs use `runAsSystem`.
- One `message_in` line per delivery through `writeCallLine(..., 'log')` with the payload through `maskCapturedBody`: PII and secrets masked, a payload over 2 MiB logs `<CT N bytes>` unparsed (as for HTTP bodies), an empty payload logs no body, and the line can never fail the message.
- Then the handler, then exactly one settlement, on the channel that delivered the message:
  - success or duplicate: `ack`, outside the `try` that classifies handler failures: a failed `ack` (the channel closed after the commit) is logged as `unsettled`, never treated as a handler failure; the broker redelivers it and the idempotency store skips it;
  - a transient failure (a database or network error): `nack(msg, false, false)`, so the DLX sends it to the wait queue; never `requeue: true`, which loops a poison message;
  - a non-retryable failure (`parkReasonOf`: invalid message, missing tenant, a cross-tenant denial, a business rule) or the last attempt: publish a copy to the parking queue on the confirm channel with `x-parked-reason`, wait for the confirm, then `ack`. If the copy is not confirmed, `nack` instead, so the message takes the wait-queue cycle rather than being lost.
- A `message_outcome` line per delivery with the queue, `messageId`, outcome, park reason and error class: ids only, never the payload or an error message.
- `prefetch` bounds the unacked messages, and those messages are handled concurrently. When order per aggregate matters, use `prefetch: 1` or one queue per partition key.

## 7. Idempotency

- Delivery is at least once. Dedupe on the `messageId` the producer put in the payload, never on a delivery tag or a redelivered flag.
- `ProcessedMessageStore.markIfNew(manager, consumer, messageId)` is one `INSERT ... ON CONFLICT DO NOTHING` in the same transaction as the effect: if the effect fails, the marker rolls back and the next attempt applies it; a duplicate, even a concurrent one, finds the marker and changes nothing. Never insert and catch the duplicate-key error.
- Purge old rows with a job, keeping them longer than any redelivery or replay window.

## 8. The handler

- `dataSource.transaction(async (manager) => ...)`: the marker, then the tenant entity through `this.profiles.withManager(manager)`. Never a manager method on a tenant entity, and never a remote call inside the transaction (write an outbox row instead).
- A row that is not in the message's tenant is not found (`update` returns 0): throw a `NonRetryableMessageError`, never search other tenants.
- Classify failures deliberately: a `NonRetryableMessageError` for what a retry cannot fix; let database and network errors propagate so the message is retried.

## 9. Producing

- `MessagePublisher.publish(exchange, routingKey, message, ctx)` sends persistent JSON with `messageId` and `type` as properties and the headers `x-request-id`, `x-tenant-id`, `x-user-id` from the context. It resolves when the broker confirmed the message.
- **Outbox** when the message follows a database change: write an outbox row in the same transaction as the change, with the message and `contextHeaders(currentContext())` captured at that moment; a relay job then publishes pending rows, outside any transaction, and marks a row sent only after the confirm. The relay runs in `runAsSystem`, but it passes the context stored with the row, so the consumer sees the original user and tenant. Never publish and write the database as two independent steps.
- The `messageId` is generated once, when the outbox row is created, never at send time.

## 10. Operations

- Readiness: `RabbitMqConnection.isConnected()` and `KycCompletedConsumer.isConsuming()` in the `@nestjs/terminus` check (section 3); `ready()` resolves once the consumer is registered, for tests.
- Every broker channel and connection wrapper has a structured error listener (`rabbitmq_channel_error`, `rabbitmq_connect_failed`, `rabbitmq_disconnected`): error class and code, never the message or the URL.
- Alert on main-queue depth, unacked count, consumer count, wait-queue depth growing and parking-queue depth.
- Parked message runbook: inspect it and its `x-parked-reason`, fix the cause, republish it to the main exchange with a tool. Never edit a live queue by hand. The parking queue holds payloads: treat it as sensitive.

## 11. Tests

- **Unit:** `message-codec.spec.ts` (every invalid shape is an `InvalidMessageError` with its reason, unknown fields are dropped, the error never quotes the payload) and `work-queue.spec.ts` (`x-death` counting).
- **e2e on a real broker and database** (`test/kyc-completed.consumer.e2e.spec.ts`, the `stack-nestjs-testing` harness): RabbitMQ and Postgres in Testcontainers, the real consumer, migrations and subscribers. Cover:
  - the message is applied in the tenant of `x-tenant-id` as the user of `x-user-id`, and the handler sees that context;
  - one `message_in` line with the payload masked, and no body for an empty payload;
  - a duplicate delivery is applied once (wait for both outcomes);
  - a poison message, a tombstone and a schema violation are parked at once, delivered once, with no `x-death`;
  - `x-user-id: {{sc:systemUser}}` cannot read across tenants or change another tenant's row;
  - a message without `x-tenant-id` is parked;
  - a transient failure is retried through the wait queue and then applied, and after `maxAttempts` it is parked;
  - a payload over 2 MiB logs only its size and is still applied;
  - on shutdown, the delivery in flight is acked before the channel closes, and a later message waits in the queue;
  - on a Nest context with the real module shape, the hooks run consumer `onModuleDestroy`, publisher `beforeApplicationShutdown`, connection `onApplicationShutdown`, and a handler that publishes during the drain gets its confirm;
  - a failed setup (`PRECONDITION_FAILED`) is logged with its code, the process stays up, and `isConsuming()` is false;
  - after a broker cancel (the queue deleted) the consumer is registered again and consumes, without a restart.
- The rows that stop, cancel or break a consumer run on a vhost of their own, with their own connection and consumer, so the rows can run in any order (`jest --randomize`).
- Poll with a deadline for outcomes; never sleep a fixed time.

## Do not

- Do not auto-ack (`noAck: true`), and do not ack before the work committed.
- Do not `nack` with `requeue: true` or retry in a loop in the consumer; the wait queue and the attempt cap do that.
- Do not route a retry back through the producer's exchange.
- Do not dedupe by catching a duplicate-key error, or on the delivery tag.
- Do not take the tenant from the payload, and do not run a consumer as the system identity.
- Do not log the payload outside the masked `message_in` line, or put payload text in an error or header.
- Do not publish to the broker and write the database as two independent steps; use the outbox.
- Do not use `any` for a message; parse it into its class at the edge.
