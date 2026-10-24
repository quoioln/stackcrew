# Outbox

Write the event to an outbox table in the same database transaction as the business change; a separate relay publishes it to the broker. This removes the dual write.

## Signals

- A service saves to the database and then publishes to a broker (or calls another service) in the same method.
- "We lost an event after a crash" or "the event was sent but the row rolled back".
- A listener reads data that is not yet committed.

## Use when

- A broker is in use (Kafka, RabbitMQ, a queue) and a DB write and a published event must agree: any dual write. It is required in that case, not optional.
- Consumers rely on every committed change producing exactly one event (at-least-once delivery plus idempotent consumers).
- See `stackcrew-messaging-choice` for choosing the broker; the outbox applies to all of them.

## Do not use when

- Events stay in-process and may be lost on a crash (a UI refresh, a cache eviction).
- There is no database write, only a pure publish.
- The store is itself the log (event sourcing writes events as the source of truth) or the change is captured by CDC from the table directly (Debezium); then the outbox table may be redundant.
- No broker exists yet and none is planned. Do not add infrastructure for it; that is a Decision gate item.

## Idioms

### Java (Spring Boot / Quarkus)

- In the service's `@Transactional` method, save the entity and insert an outbox row (typed record: id, aggregate id, event type constant, payload JSON, created at, status). Never publish to the broker inside the transaction.
- A relay (a scheduled poller with `FOR UPDATE SKIP LOCKED`, or CDC) publishes rows, marks them sent, and retries. Delivery is at-least-once, so consumers dedupe by event id (see `addon-kafka` and `addon-rabbitmq`).
- `@TransactionalEventListener(phase = AFTER_COMMIT)` is not an outbox: a crash after commit loses the event.

### TypeScript (NestJS / Next.js / React / Angular)

- Within one DB transaction (the ORM or query-builder transaction callback), write the business row and the outbox row. A relay (a BullMQ repeatable job, a cron worker or CDC) publishes and marks them.
- Define the event payload as a typed interface or zod schema; the outbox payload column is serialized from it, not from `any`.
- `EventEmitter2` after `save()` is not an outbox; it is an in-process notification.

### Go

- `tx, err := db.BeginTx(ctx, nil)`; insert the business row and the outbox row with the same `tx`, then commit. A relay goroutine or a separate worker polls the table and publishes (with Watermill, via its `Publisher`).
- Use `SELECT ... FOR UPDATE SKIP LOCKED` so several relays do not double-send. Idempotent consumers dedupe by event id.

## Example

Language: Java. The entity and its event are saved in one transaction; the relay publishes later.

```java
@Service
public class OrderService {
    private final OrderRepository orders;
    private final OutboxRepository outbox;

    public OrderService(OrderRepository orders, OutboxRepository outbox) {
        this.orders = orders;
        this.outbox = outbox;
    }

    @Transactional
    public OrderId place(PlaceOrder command) {
        Order order = orders.save(Order.place(command));
        outbox.add(OutboxMessage.of(EventTypes.ORDER_PLACED, order.id(), new OrderPlaced(order.id(), order.total())));
        return order.id();   // no broker call here
    }
}
```

## AI anti-patterns

- Saving, then calling `kafkaTemplate.send` or `emit` in the same method and calling it done (dual write).
- Publishing inside the transaction, so the event leaves before the commit or after a rollback.
- Treating `@TransactionalEventListener` or `EventEmitter2` as an outbox.
- An outbox with no relay, no retry, or no consumer idempotency.
- Adding an outbox when events never leave the process, or building one with no broker in the profile.
- Storing the payload as an untyped `Map<String, Object>` or `any` instead of a typed event.
