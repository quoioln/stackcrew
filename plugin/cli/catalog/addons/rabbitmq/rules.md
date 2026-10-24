---
id: addon-rabbitmq
title: RabbitMQ
---
# RabbitMQ

Applies when the profile lists the `rabbitmq` add-on. Extends the core eventing, logging and error-handling rules. Spring Boot examples use Spring AMQP; the rules hold for `amqplib` and `amqp091-go` as well.

## Essentials

- Acknowledge only after the work succeeded (manual ack, or Spring's AUTO mode which acks on a normal return). Never auto-ack (`NONE`) important work. Reject with a deliberate requeue policy.
- Consumers are idempotent: redelivery happens. Dedupe on a message id carried in the payload, with an atomic insert in the same transaction as the business effect.
- Every work queue has a dead-letter exchange (DLX) and a dead-letter queue, plus a retry with backoff and an attempt cap. Spring AMQP requeues a failed message by default (`default-requeue-rejected` is true), which loops a poison message forever: set it to `false`.
- Durable queues and persistent messages for data that must survive a broker restart; publisher confirms on for publishers that must know the broker took the message (`publisher-confirm-type: correlated`, plus `publisher-returns` and `mandatory` for unroutable messages).
- Write to the broker through the Outbox pattern when the message follows a database change: never a dual write.
- Messages are typed records with a message id, type, version and `occurredAt`. No `Map` or `any` past the conversion point; a conversion failure is a non-retryable error.
- Set prefetch (QoS) to bound unacked messages per consumer; start low and raise it only with measurements.
- Exchange, queue and routing-key names are constants. Document the topology (exchange type, bindings, queue arguments) and version it in code.
- Carry `traceparent` and the correlation id in message headers; enable Micrometer observation on the template and the listener container; restore both into MDC in the consumer.
- Connections are long-lived, one channel per thread, automatic recovery on, graceful shutdown. Per-service vhost and credentials with least privilege, and TLS.
- Alert on queue depth, unacked count, consumer count, and dead-letter queue depth.

## When RabbitMQ, and when not

Adding a broker is a Decision gate: record the choice in `stackcrew.json` `decisions[]`.

- RabbitMQ (or another lightweight pub/sub such as Redis or a cloud Pub/Sub): task distribution, rich routing by key, low to medium volume, no replay, per-message ack, TTL and dead-lettering, simple to operate.
- Kafka: replay or long retention, ordering per key, high throughput, several independent consumers at their own pace. Use the `kafka` add-on.
- In-process event: same service, no durability needed.

## Spring Boot configuration

```yaml
spring:
  rabbitmq:
    publisher-confirm-type: correlated
    publisher-returns: true
    template:
      mandatory: true
      observation-enabled: true          # traceparent is written to the message headers
    listener:
      simple:
        acknowledge-mode: auto           # ack on normal return, reject on exception
        default-requeue-rejected: false  # a failure goes to the DLX instead of looping
        prefetch: 10
        observation-enabled: true        # trace continues from the publisher, traceId in MDC
        retry:
          enabled: true
          max-attempts: 4
          initial-interval: 1s
          multiplier: 2.0
          max-interval: 30s
```

- Credentials, host and vhost come from the environment or a vault, never from the committed file.
- In-process retry blocks the consumer thread while it backs off. For long outages use a TTL retry queue instead: the dead-letter queue has a `ttl` and dead-letters back to the main exchange, which gives a delayed redelivery without blocking.

## Topology and failure path

Declare the topology from constants and typed builders:

```java
@Configuration
class PaymentsTopology {
    @Bean
    DirectExchange paymentsExchange() { return new DirectExchange(RabbitNames.PAYMENTS_EXCHANGE); }

    @Bean
    DirectExchange paymentsDeadLetterExchange() { return new DirectExchange(RabbitNames.PAYMENTS_DLX); }

    @Bean
    Queue paymentsQueue() {
        return QueueBuilder.durable(RabbitNames.PAYMENTS_QUEUE)
            .deadLetterExchange(RabbitNames.PAYMENTS_DLX)
            .deadLetterRoutingKey(RabbitNames.PAYMENTS_DLQ)
            .build();
    }

    @Bean
    Queue paymentsDeadLetterQueue() { return QueueBuilder.durable(RabbitNames.PAYMENTS_DLQ).build(); }

    @Bean
    Binding paymentsBinding(Queue paymentsQueue, DirectExchange paymentsExchange) {
        return BindingBuilder.bind(paymentsQueue).to(paymentsExchange).with(RabbitNames.PAYMENT_ROUTING_KEY);
    }

    @Bean
    Binding paymentsDeadLetterBinding(Queue paymentsDeadLetterQueue, DirectExchange paymentsDeadLetterExchange) {
        return BindingBuilder.bind(paymentsDeadLetterQueue).to(paymentsDeadLetterExchange).with(RabbitNames.PAYMENTS_DLQ);
    }
}
```

- A listener that throws is wrapped in `ListenerExecutionFailedException`. Throw `AmqpRejectAndDontRequeueException` for a failure a retry cannot fix (invalid payload, rule violation): it is rejected without requeue whatever the container setting, and the broker dead-letters it.
- A `RepublishMessageRecoverer` bean acks the failed message and republishes it itself: the broker's DLX is then not used for that message. Pick one mechanism per queue and document it.
- Quorum queues (`QueueBuilder.quorum()`) are the default choice for replicated, durable queues on a cluster; classic mirrored queues are legacy.
- Do not requeue in a tight loop. `ImmediateRequeueAmqpException` is for rare, deliberate cases.

## Context propagation

- With observation enabled and a Micrometer Tracing bridge on the classpath, the publisher writes `traceparent` and the consumer continues the trace, so `traceId` and `spanId` are in MDC for the listener.
- The correlation id is your own header: read it from the message properties, or generate one when missing, put it in MDC for the duration of the message and remove it in `finally`.
- Never log the body. Log message id, exchange, routing key, queue, outcome and duration.

## Operations

- Metrics: queue depth, unacked messages, consumer count, publish confirm failures, dead-letter queue depth and age of its oldest message.
- Runbook for a dead-lettered message: inspect, fix the cause, republish it to the main exchange with a tool, never edit the live queue.
- Secrets and certificates come from the environment or a vault. Use one vhost per service, with only the permissions it needs.
- Test with Testcontainers RabbitMQ (`RabbitMQContainer` with `@ServiceConnection`, Boot 3.1+): a duplicate delivery processed once, a poison message ends in the dead-letter queue after the attempt cap, a message is not acked when the work fails.

## Other stacks

- Node (`amqplib`): `channel.ack` only after the handler resolves; `channel.nack(msg, false, false)` to dead-letter; confirm channel for publishers; validate the decoded body with a typed schema.
- Go (`amqp091-go`): manual ack (`Delivery.Ack`), `Nack` with `requeue=false`, `QoS` for prefetch, publisher confirms (`Channel.Confirm`), reconnect on `NotifyClose`.
