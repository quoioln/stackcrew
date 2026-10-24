---
name: stackcrew-spring-kafka-consumer
description: Use when adding or changing a Kafka consumer or producer in a Spring Boot service, such as consuming an OrderPaid event. Gives the typed event, idempotent handler, offset commit, dead-letter topic, header and MDC propagation, outbox and test steps.
kind: task
paths: ["**/*.java"]
requiresAddons: [kafka]
---
# Add a Kafka consumer (Spring Boot 3.2+, spring-kafka 3.x, Java 17+)

Follow these steps in order. Write the SC-PREFLIGHT note first: list the existing topic constants, event records, `EventCodec`, error handler bean, processed-events table, `MdcKeys` and outbox you found and will reuse. If an error handler or codec exists you extend it; you never create a second one.

Delivery is at-least-once, so every consumer is idempotent. The handler in step 3 is the core of this skill; the rest is plumbing around it.

## 0. Find what exists

- Search for `KafkaTopics`, `KafkaHeaderNames`, `EventCodec`, `DefaultErrorHandler`, `processed_event`, `MdcKeys`, `OutboxRelay`, `spring.kafka` in `application*.yml`.
- A new topic means a new constant, a new event record and a new listener class. The error handler, the codec and the processed-events store are shared.

## 1. Constants: topics, groups, headers

```java
public final class KafkaTopics {
    public static final String ORDER_PAID = "payments.order-paid.v1";
    public static final String DLT_SUFFIX = "-dlt";                          // set explicitly: see step 4
    public static final String ORDER_PAID_DLT = ORDER_PAID + DLT_SUFFIX;
    public static final String GROUP_FULFILMENT = "fulfilment-service";
    private KafkaTopics() {}
}

public final class KafkaHeaderNames {
    public static final String CORRELATION_ID = "correlation-id";
    private KafkaHeaderNames() {}
}
```

Annotation attributes accept these because they are compile-time constants. Add `CORRELATION_ID` to the existing `MdcKeys` if it is missing. Create the topic and its dead-letter topic (same or more partitions) through your infrastructure code, not by hand. The dead-letter topic name always comes from `DLT_SUFFIX`: spring-kafka 3.1 and 3.2 (Boot 3.2 and 3.3) default to `<topic>.DLT` while 3.3 and later default to `<topic>-dlt`, so relying on the default breaks on a Boot upgrade.

## 2. The typed event and the codec: parse once, at the edge

Events are records with an id for dedupe. Never `Map<String, Object>` or `JsonNode`.

```java
public record OrderPaid(
        @NotBlank String eventId,
        @NotBlank String orderId,
        @NotNull @Positive BigDecimal amount,
        @NotBlank String currency,
        @NotNull Instant occurredAt) {}
```

The consumers use `StringDeserializer` (see step 5) and map the JSON to the record in one place. The failure path then receives the original string, so the dead-letter topic holds a readable payload and no second serializer is needed.

```java
@Component
public class EventCodec {
    private final ObjectMapper mapper;
    private final jakarta.validation.Validator validator;    // Bean Validation, not Spring's org.springframework.validation.Validator

    public EventCodec(ObjectMapper mapper, jakarta.validation.Validator validator) { this.mapper = mapper; this.validator = validator; }

    public <T> T read(String json, Class<T> type) {
        if (json == null) { throw new InvalidEventException(type); }     // tombstone (null value): not retryable, never an IllegalArgumentException
        T event;
        try {
            event = mapper.readValue(json, type);
        } catch (JsonProcessingException e) {
            throw new InvalidEventException(type);     // no cause: Jackson quotes the payload in its message (PII)
        }
        if (!validator.validate(event).isEmpty()) { throw new InvalidEventException(type); }
        return event;
    }

    public String write(Object event) {
        try {
            return mapper.writeValueAsString(event);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("event is not serializable: " + event.getClass().getSimpleName(), e);
        }
    }
}

public class InvalidEventException extends RuntimeException {      // never retried: see step 4
    private static final long serialVersionUID = 1L;
    public InvalidEventException(Class<?> type) { super("invalid " + type.getSimpleName()); }
}
```

A record with a `null` value (a tombstone, normally only on compacted topics) is treated as invalid and goes to the dead-letter topic. If your topic legitimately carries deletions, handle `record.value() == null` in the listener before calling the codec. The Boot `ObjectMapper` ignores unknown properties, so adding a field to an event is a compatible change. With Avro or Protobuf and a Schema Registry use the registry deserializer and generated classes instead of this codec; the rest of the steps are unchanged.

## 3. Idempotent handler: processed-events table and an atomic insert

One row per `(consumer group, event id)`. The marker insert and the business effect commit in the same transaction: if the business step fails, the marker rolls back and the retry works.

```sql
CREATE TABLE processed_event (
    consumer_group VARCHAR(100) NOT NULL,
    event_id       VARCHAR(100) NOT NULL,
    processed_at   TIMESTAMP    NOT NULL,
    PRIMARY KEY (consumer_group, event_id)
);
```

`ProcessedEventStore` takes a `Clock`, which Spring Boot does not provide: declare one `@Bean Clock clock() { return Clock.systemUTC(); }` in a shared config class (tests can replace it with `Clock.fixed(...)`).

Use one atomic statement, as in the callback inbox of `stackcrew-spring-integration-provider`. Do not insert and catch `DataIntegrityViolationException`: the transaction is already marked rollback-only.

```java
@Repository
class ProcessedEventStore {
    private static final String P_GROUP = "consumerGroup";
    private static final String P_EVENT_ID = "eventId";
    private static final String P_PROCESSED_AT = "processedAt";
    private static final String INSERT_IF_NEW = """
        INSERT INTO processed_event (consumer_group, event_id, processed_at)
        VALUES (:consumerGroup, :eventId, :processedAt)
        ON CONFLICT (consumer_group, event_id) DO NOTHING""";   // PostgreSQL; MySQL: ON DUPLICATE KEY UPDATE event_id = event_id

    private final JdbcClient jdbc;
    private final Clock clock;

    ProcessedEventStore(JdbcClient jdbc, Clock clock) { this.jdbc = jdbc; this.clock = clock; }

    boolean markIfNew(String consumerGroup, String eventId) {
        return jdbc.sql(INSERT_IF_NEW).param(P_GROUP, consumerGroup).param(P_EVENT_ID, eventId)
            .param(P_PROCESSED_AT, Timestamp.from(clock.instant())).update() == 1;
    }
}
```

On MySQL, Connector/J needs `useAffectedRows=true` on the JDBC URL. Without it a duplicate returns 1 (matched rows) and is treated as new. Purge old rows with a scheduled job, keeping them at least as long as the topic retention plus the longest replay window.

```java
@Service
class OrderPaidHandler {
    private static final Logger log = LoggerFactory.getLogger(OrderPaidHandler.class);

    private final ProcessedEventStore processed;
    private final FulfilmentService fulfilment;

    OrderPaidHandler(ProcessedEventStore processed, FulfilmentService fulfilment) { this.processed = processed; this.fulfilment = fulfilment; }

    @Transactional                                  // called from another bean, so the proxy applies
    public void handle(OrderPaid event) {
        if (!processed.markIfNew(KafkaTopics.GROUP_FULFILMENT, event.eventId())) {
            log.info("duplicate event skipped eventId={}", event.eventId());
            return;
        }
        fulfilment.start(event.orderId(), event.amount());    // database changes only
    }
}
```

- No remote call inside this transaction. If the event needs a third-party call, write an outbox row here and send it from a relay with an idempotency key derived from the event id (see `stackcrew-spring-integration-provider`).
- Key the dedupe on the event id the producer put in the payload. An offset is not stable across a replay or a topic migration.

## 4. Failure path: retry, classify, dead-letter

One shared bean. Spring Boot attaches a `CommonErrorHandler` bean to the auto-configured listener container factory. A custom `ConcurrentKafkaListenerContainerFactory` needs `factory.setCommonErrorHandler(handler)`.

```java
@ConfigurationProperties(prefix = "app.kafka.retry")
@Validated
public record KafkaRetryProperties(@Positive int maxRetries, @NotNull Duration initialInterval,
                                   @Positive double multiplier, @NotNull Duration maxInterval) {}

@Configuration
@EnableConfigurationProperties(KafkaRetryProperties.class)
class KafkaErrorHandlingConfig {

    @Bean
    DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<Object, Object> template, KafkaRetryProperties retry) {
        var recoverer = new DeadLetterPublishingRecoverer(template,       // explicit destination: same partition, suffix from the constant
            (failed, ex) -> new TopicPartition(failed.topic() + KafkaTopics.DLT_SUFFIX, failed.partition()));
        var backOff = new ExponentialBackOffWithMaxRetries(retry.maxRetries());
        backOff.setInitialInterval(retry.initialInterval().toMillis());
        backOff.setMultiplier(retry.multiplier());
        backOff.setMaxInterval(retry.maxInterval().toMillis());
        var handler = new DefaultErrorHandler(recoverer, backOff);
        handler.addNotRetryableExceptions(InvalidEventException.class);   // add the domain exceptions a retry cannot fix
        return handler;
    }
}
```

- Non-retryable (go to the dead-letter topic on the first failure): invalid or unparseable payload, a business rule violation that a retry cannot fix. `DefaultErrorHandler` already classifies `DeserializationException`, `MessageConversionException`, `ConversionException`, `MethodArgumentResolutionException`, `NoSuchMethodException` and `ClassCastException` that way. Add your own with `addNotRetryableExceptions`.
- Retryable: transient failures (database unavailable, a dependency timeout). The backoff is bounded by `maxRetries`; the total backoff must stay well under `max.poll.interval.ms`, or the consumer leaves the group. For long outages use non-blocking retry topics (`@RetryableTopic`) instead of a long blocking backoff.
- The recoverer needs the dead-letter topic to have at least as many partitions as the source (it publishes to the same partition). The dead-letter record keeps the original headers and adds exception class, message and stack trace headers. Never put payload data or PII in an exception message. Alert on dead-letter topic depth.
- Offsets: the record is committed after the listener returns (`AckMode.RECORD`). Use a manual `Acknowledgment` only if the handler must hand off to another thread, and then acknowledge after the work completes.

## 5. Configuration

```yaml
spring:
  kafka:
    consumer:
      enable-auto-commit: false
      auto-offset-reset: earliest            # a new group replays from the beginning: decide on purpose
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.apache.kafka.common.serialization.StringDeserializer
    producer:
      acks: all
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.apache.kafka.common.serialization.StringSerializer
      properties:
        enable.idempotence: true
    listener:
      ack-mode: record
      observation-enabled: true              # trace continues from the producer, traceId and spanId in MDC
    template:
      observation-enabled: true              # traceparent is written to the record headers
app:
  kafka:
    retry: { max-retries: 4, initial-interval: 1s, multiplier: 2.0, max-interval: 30s }
```

The group id comes from the constant in `@KafkaListener(groupId = ...)`, so it is not repeated here. Add Actuator and a Micrometer Tracing bridge (OpenTelemetry or Brave) to the build; without a bridge the observation produces no trace. If a framework API forces `Map<String, Object>` (client config in a custom factory), keep it in one config class and mark the line `stackcrew-allow: SC-TYPE Kafka client config`.

## 6. The listener: restore the context, parse, delegate

The listener only restores context, parses and delegates. The correlation id is read from the record header, or created when missing, and removed in `finally`.

```java
@Component
class OrderPaidListener {
    private final EventCodec codec;
    private final OrderPaidHandler handler;

    OrderPaidListener(EventCodec codec, OrderPaidHandler handler) { this.codec = codec; this.handler = handler; }

    @KafkaListener(topics = KafkaTopics.ORDER_PAID, groupId = KafkaTopics.GROUP_FULFILMENT)
    public void on(ConsumerRecord<String, String> record) {
        try (ConsumerMdc ignored = ConsumerMdc.open(record.headers())) {
            handler.handle(codec.read(record.value(), OrderPaid.class));
        }
    }
}

final class ConsumerMdc implements AutoCloseable {
    private ConsumerMdc() {}

    static ConsumerMdc open(Headers headers) {
        Header header = headers.lastHeader(KafkaHeaderNames.CORRELATION_ID);
        String correlationId = header == null ? UUID.randomUUID().toString() : new String(header.value(), StandardCharsets.UTF_8);
        MDC.put(MdcKeys.CORRELATION_ID, correlationId);
        return new ConsumerMdc();
    }

    @Override
    public void close() { MDC.remove(MdcKeys.CORRELATION_ID); }
}
```

- `traceparent` is restored by the listener observation (step 5) when a Micrometer Tracing bridge is present: `traceId` and `spanId` are then in MDC. Do not hand-roll trace ids. Without observation you would have to parse `traceparent` yourself.
- Log event id, topic, partition and offset, never the payload. A record's `toString` prints every field: do not log `event`.
- One listener class per topic and event type. A growing `if/else` on the event type in one listener is a signal for a registry or one listener per type.
- Never block the listener thread on a slow third party without a timeout: it holds the partition and risks a rebalance. Use the provider skill's timeouts, breaker and bulkhead.

## 7. Producing: Outbox, not a dual write

When an event follows a database change, write an outbox row in the same transaction as the state change. A relay publishes it (see the Outbox bullets in the `kafka` add-on rules).

```java
@Component
class OrderPaidPublisher {
    private final KafkaTemplate<String, String> template;
    private final EventCodec codec;

    OrderPaidPublisher(KafkaTemplate<String, String> template, EventCodec codec) { this.template = template; this.codec = codec; }

    CompletableFuture<SendResult<String, String>> publish(OrderPaid event, String correlationId) {
        var record = new ProducerRecord<>(KafkaTopics.ORDER_PAID, event.orderId(), codec.write(event));   // key = aggregate id: ordering per order
        record.headers().add(KafkaHeaderNames.CORRELATION_ID, correlationId.getBytes(StandardCharsets.UTF_8));
        return template.send(record);
    }
}
```

- The relay calls `publish(...)` outside any database transaction, waits for the broker ack, then marks the outbox row published. A send failure leaves the row unpublished for the next run. Consumers dedupe, so a repeat is safe.
- Trace continuity: store the current `traceparent` (`Propagator.inject` from Micrometer Tracing) in a column of the outbox row when it is written, and in the relay restore it (`Propagator.extract` into a span that wraps the send) so the template observation continues the original trace. Without it the relay starts a new trace and the consumer's trace is cut from the request that caused the event.
- The event id is generated once, when the outbox row is created, never at send time.

## 8. Tests

Pick one broker for tests: `@EmbeddedKafka` for fast tests in the build, Testcontainers Kafka (`KafkaContainer` with `@ServiceConnection`, or `@DynamicPropertySource` for `spring.kafka.bootstrap-servers`) when the test depends on real broker behaviour such as rebalances or transactions.

```java
@SpringBootTest(properties = "spring.kafka.consumer.auto-offset-reset=earliest")
@EmbeddedKafka(partitions = 1, topics = {KafkaTopics.ORDER_PAID, KafkaTopics.ORDER_PAID_DLT})
@Testcontainers
@DirtiesContext
class OrderPaidListenerIT {
    @Container @ServiceConnection
    static final PostgreSQLContainer<?> DB = new PostgreSQLContainer<>(TestImages.POSTGRES);   // the SQL in step 3 is PostgreSQL

    @Autowired private KafkaTemplate<String, String> template;
    @Autowired private EventCodec codec;
    @Autowired private JdbcClient jdbc;

    @Test
    void duplicate_event_is_applied_once() {
        String original = codec.write(new OrderPaid("evt-1", "ord-1", new BigDecimal("10.00"), "VND", Instant.now()));
        String sentinel = codec.write(new OrderPaid("evt-2", "ord-sentinel", new BigDecimal("1.00"), "VND", Instant.now()));
        template.send(KafkaTopics.ORDER_PAID, "ord-1", original);
        template.send(KafkaTopics.ORDER_PAID, "ord-1", original);      // the duplicate
        template.send(KafkaTopics.ORDER_PAID, "ord-1", sentinel);      // same key, so same partition: processed after the duplicate
        await().atMost(Duration.ofSeconds(15)).untilAsserted(() -> assertThat(fulfilments("ord-sentinel")).isEqualTo(1));
        assertThat(fulfilments("ord-1")).isEqualTo(1);                 // only now can the duplicate have been processed and skipped
    }

    private int fulfilments(String orderId) {
        return jdbc.sql("SELECT COUNT(*) FROM fulfilment WHERE order_id = :orderId").param("orderId", orderId).query(Integer.class).single();
    }
}
```

`await()` is Awaitility's (`org.awaitility.Awaitility.await`, included in `spring-boot-starter-test`). `TestImages.POSTGRES` is the project's pinned image constant. Apply the schema through the project's migrations (Flyway or Liquibase), not by hand in the test.

Cover each of these:

- the same event delivered twice changes state once (always wait for a later sentinel event on the same key before asserting, or the test passes before the duplicate is consumed);
- an unparseable or invalid payload reaches `KafkaTopics.ORDER_PAID_DLT` after one attempt (assert one delivery, no backoff);
- a transient failure retries and then succeeds, and the offset is committed only after success;
- retries are exhausted and the record lands on the dead-letter topic with the original payload;
- a record without a correlation header gets a generated one in MDC.

Unit-test `EventCodec` and the handler without Kafka (the handler needs only a database slice test).

## Do not

- Do not `Map<String, Object>`, `JsonNode` or `Object` an event, and do not hardcode topic, group or header names.
- Do not auto-commit offsets, and do not acknowledge before the work is done.
- Do not dedupe on the offset, and do not catch the duplicate-key exception to detect a duplicate.
- Do not retry an invalid payload, and do not swallow an exception in the listener (the offset would be committed and the record lost).
- Do not call a third party inside the handler transaction, and do not dual-write to the database and Kafka.
- Do not log the payload, the `ConsumerRecord`, or an exception message that quotes the payload.
- Do not process on another thread and acknowledge before it finishes.
- Do not consume the dead-letter topic with the same handler by reflex: replay is a deliberate, owned procedure.
