---
id: addon-kafka
title: Apache Kafka
---
# Apache Kafka

Applies when the profile lists the `kafka` add-on. Extends the core eventing, logging and error-handling rules. Spring Boot examples need spring-kafka 3.x (Boot 3.2+); the rules themselves hold for `kafkajs` and `segmentio/kafka-go`.

## Essentials

- Consumers are idempotent (at-least-once): dedupe on the payload event id, never the offset, with a processed-events table and one atomic insert in the business transaction. Spring Boot: skill `stackcrew-spring-kafka-consumer`.
- Commit offsets only after the work succeeded: auto-commit off, `AckMode.RECORD`. Failures retry with backoff, then go to a dead-letter topic; one bad record never blocks a partition.
- Classify errors: non-retryable (invalid payload, rule violation) go straight to the dead-letter topic; only transient ones retry, with a cap and backoff.
- Events are typed records (or Avro/Protobuf classes) with event id, type, version, `occurredAt`; never `Map`, `JsonNode` or `any` past deserialization. Schema changes stay backward compatible.
- Producers: `enable.idempotence=true`, `acks=all`; Outbox pattern when the event follows a database change, never a dual write.
- Topic names, consumer group ids, header names and partition keys are constants. Document the key wherever per-entity ordering matters (key by aggregate id).
- Carry `traceparent` and the correlation id in message headers. Enable Micrometer observation on the template and the listener container; restore both ids into MDC in the consumer so logs correlate across services.
- Alert on consumer lag, processing latency and dead-letter topic depth. A dead-letter record has an owner and a replay procedure.
- Dead-letter records carry the original payload plus exception message and stack trace in headers. Treat that topic as sensitive: same ACLs and retention as the source, no PII in exception messages.
- Size `max.poll.records` and `max.poll.interval.ms` to the real processing time plus the total retry backoff; stop the container gracefully on shutdown.
- Test with `@EmbeddedKafka` or Testcontainers Kafka: duplicate delivery processed once, poison record reaches the dead-letter topic, offset not committed on a transient failure.

## When Kafka, and when not

Adding a broker is a Decision gate: record the choice in `stackcrew.json` `decisions[]`.

- In-process event (Spring `ApplicationEvent`, Nest `EventEmitter`, Go channel): same service, no durability needed.
- Lightweight broker or work queue (RabbitMQ or a cloud Pub/Sub): task distribution, rich routing, low to medium volume, no replay, per-message ack, TTL and dead-lettering. Use the `rabbitmq` add-on. Redis is a weaker fit: Redis Pub/Sub is not a work queue (at-most-once, no persistence or ack). Redis Streams has consumer-group acks but no native dead-letter exchange or per-message TTL, and its durability depends on AOF/RDB.
- Kafka: replay or long retention, ordering per key, high throughput, several independent consumers at their own pace, audit trail, event sourcing or stream processing.

## Delivery semantics

- Assume at-least-once on both sides. Exactly-once (transactions, EOS) is a deliberate, documented choice for a kafka-to-kafka flow, never a replacement for an idempotent handler that touches a database or a third party.
- A third-party call made from a consumer carries an idempotency key derived from the event id (see `stackcrew-spring-integration-provider`). Never call a third party inside the handler transaction.
- Processed-event rows are kept at least as long as the topic retention plus the longest replay window, then purged by a scheduled job.

## Producer configuration (Spring Boot)

Typed properties, no Java `Map`:

```yaml
spring:
  kafka:
    producer:
      acks: all
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.apache.kafka.common.serialization.StringSerializer
      properties:
        enable.idempotence: true
    template:
      observation-enabled: true          # traceparent is added to the record headers
```

- The payload is serialized from a typed record in one codec class (`EventCodec`); the wire format is JSON with a stable schema, or Avro/Protobuf with a Schema Registry and a compatibility mode (BACKWARD or FULL) enforced in CI.
- `KafkaTemplate.send(...)` returns a `CompletableFuture` in spring-kafka 3.x: handle the failure path (log, metric, keep the outbox row unpublished), never fire and forget.
- Outbox: the state change and the outbox row commit in one transaction. A relay claims a batch (`FOR UPDATE SKIP LOCKED`, short transaction), sends outside that transaction, waits for the broker ack, then marks the row published. At-least-once again, so consumers stay idempotent. Debezium CDC is an equivalent relay.

## Consumer configuration (Spring Boot)

```yaml
spring:
  kafka:
    consumer:
      enable-auto-commit: false
      auto-offset-reset: earliest        # a new group starts from the beginning: decide on purpose
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.apache.kafka.common.serialization.StringDeserializer
    listener:
      ack-mode: record
      observation-enabled: true          # restores the trace into MDC (traceId, spanId)
```

- Failure path: a `DefaultErrorHandler` bean with a `DeadLetterPublishingRecoverer` and an exponential backoff with a retry cap. Spring Boot attaches a `CommonErrorHandler` bean to the default listener container factory. A custom factory calls `setCommonErrorHandler(...)`. Set the dead-letter topic name explicitly with a destination resolver built from a constant suffix: the default is `<topic>.DLT` in spring-kafka 3.1 and 3.2 and `<topic>-dlt` from 3.3, so never rely on it. The default resolver keeps the partition number, so the dead-letter topic needs at least as many partitions as the source.
- `DefaultErrorHandler` already treats `DeserializationException`, `MessageConversionException`, `ConversionException`, `MethodArgumentResolutionException`, `NoSuchMethodException` and `ClassCastException` as not retryable. Add your own with `addNotRetryableExceptions(...)`.
- Retries in `DefaultErrorHandler` block the partition while they back off. For long outages use non-blocking retry topics (`@RetryableTopic`) instead of a long blocking backoff.
- Parse the payload into the typed record at the first line of the listener, validate it, and throw a non-retryable exception that does not echo the payload.

## Context propagation

- With observation enabled and a Micrometer Tracing bridge on the classpath, the producer writes `traceparent` and the consumer continues the same trace, so `traceId` and `spanId` are in MDC for every log line of the listener.
- The correlation id is your own header: read it from the record, or generate one when missing, put it in MDC for the duration of the record and remove it in `finally`.
- The context headers `x-request-id`, `x-tenant-id` and `x-user-id` travel with every record (`core-persistence`): the producer sends them, the consumer restores them (MDC, and the tenant context for the handler) and clears them in `finally`.
- The payload is logged once per record, in the `message_in` line through the shared body masker (`core-logging`); never by hand, never the record's `toString`. Other lines log event id, topic, partition, offset, outcome and duration.

## Operations

- Metrics: consumer lag per group and partition (broker-side exporter or the client metrics), listener duration and failure count (the listener observation gives `spring.kafka.listener`), dead-letter topic depth and age of the oldest record.
- Runbook for a dead-letter record: inspect headers, fix the cause, replay from the dead-letter topic through a tool or a one-off producer, never by editing the source topic.
- Consumers scale to the partition count; set `concurrency` accordingly. Changing the key or the partition count breaks ordering: plan it as a migration.
- Secrets (SASL credentials, keystores) come from the environment or a vault, never from `application.yml`. Use TLS and per-service ACLs with least privilege.

## Other stacks

- Node (`kafkajs`): `eachMessage` commits only after the handler resolves; use a typed schema validator (zod, class-validator) on the decoded value; publish failures to a dead-letter topic with the original bytes plus error metadata; read the trace headers into AsyncLocalStorage.
- Go (`segmentio/kafka-go`): fetch then commit explicitly after processing (`FetchMessage` and `CommitMessages`), a dead-letter writer, context carrying the ids, graceful `Close`.
