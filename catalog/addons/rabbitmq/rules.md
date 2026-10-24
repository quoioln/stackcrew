---
id: addon-rabbitmq
title: RabbitMQ
---
# RabbitMQ

Applies when the profile lists the `rabbitmq` add-on. Extends the core eventing, logging and error-handling rules. Spring Boot examples use Spring AMQP; the rules hold for `amqplib` and `amqp091-go` as well.

## Essentials

- Acknowledge only after the work succeeded (manual ack, or Spring's AUTO mode which acks on a normal return). Never auto-ack (`NONE`) important work. Reject with a deliberate requeue policy.
- Consumers are idempotent: redelivery happens. Dedupe on a message id carried in the payload, with an atomic insert in the same transaction as the business effect.
- Every work queue has a dead-letter exchange (DLX), a wait queue with a TTL for delayed retry, an attempt cap and a parking-lot queue with no TTL. Spring AMQP requeues a failed message by default (`default-requeue-rejected` is true), which loops a poison message forever: set it to `false`.
- Durable queues and persistent messages for data that must survive a broker restart; publisher confirms on for publishers that must know the broker took the message (`publisher-confirm-type: correlated`, plus `publisher-returns` and `mandatory` for unroutable messages).
- Write to the broker through the Outbox pattern when the message follows a database change: never a dual write.
- Messages are typed records with a message id, type, version and `occurredAt`. No `Map` or `any` past the conversion point; a conversion failure is a non-retryable error.
- Set prefetch (QoS) to bound unacked messages per consumer; start low and raise it only with measurements.
- Exchange, queue and routing-key names are constants. Document the topology (exchange type, bindings, queue arguments) and version it in code.
- Carry `traceparent` and the correlation id in message headers; enable Micrometer observation on the template and the listener container; restore both into MDC in the consumer.
- Connections are long-lived, one channel per thread, automatic recovery on, graceful shutdown. Per-service vhost and credentials with least privilege, and TLS.
- Alert on queue depth, unacked count, consumer count, and parking-lot queue depth (and wait-queue depth growing).

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
        retry:                           # in-process retries for short transient errors
          enabled: true
          max-attempts: 3
          initial-interval: 500ms
          multiplier: 2.0
          max-interval: 5s
```

- Credentials, host and vhost come from the environment or a vault, never from the committed file.
- The Boot `retry.*` settings retry every exception, including a message that can never succeed. Classify them with a `RabbitRetryTemplateCustomizer` (Spring Boot 3.x, spring-retry) and a recoverer, below.
- Publisher confirms only help if the publisher waits for them. See "Publishing" below.

## Topology: main queue, wait queue with TTL, parking lot

A failure worth retrying later goes main queue, then wait queue, then back to the main queue after the TTL. The attempt count comes from the broker (`x-death`), and an exhausted message lands in a parking-lot queue with no TTL. A single dead-letter queue with a TTL that routes back to the main queue loops a poison message forever: never build that.

```java
@Configuration
class PaymentsTopology {
    @Bean
    DirectExchange paymentsExchange() { return new DirectExchange(RabbitNames.PAYMENTS_EXCHANGE); }

    @Bean
    DirectExchange paymentsWaitExchange() { return new DirectExchange(RabbitNames.PAYMENTS_WAIT_EXCHANGE); }

    @Bean
    DirectExchange paymentsParkingExchange() { return new DirectExchange(RabbitNames.PAYMENTS_PARKING_EXCHANGE); }

    @Bean
    Queue paymentsQueue() {            // a rejected message is dead-lettered to the wait exchange
        return QueueBuilder.durable(RabbitNames.PAYMENTS_QUEUE).quorum()
            .deadLetterExchange(RabbitNames.PAYMENTS_WAIT_EXCHANGE)
            .deadLetterRoutingKey(RabbitNames.PAYMENTS_WAIT_KEY)
            .withArgument(RabbitNames.ARG_DEAD_LETTER_STRATEGY, RabbitNames.AT_LEAST_ONCE)   // "x-dead-letter-strategy"
            .overflow(QueueBuilder.Overflow.rejectPublish)                                     // required by at-least-once
            .build();
    }

    @Bean
    Queue paymentsWaitQueue() {        // the delay: after the TTL the message returns to the main exchange
        return QueueBuilder.durable(RabbitNames.PAYMENTS_WAIT_QUEUE).quorum()
            .ttl(RabbitNames.RETRY_DELAY_MS)
            .deadLetterExchange(RabbitNames.PAYMENTS_EXCHANGE)
            .deadLetterRoutingKey(RabbitNames.PAYMENT_ROUTING_KEY)
            .withArgument(RabbitNames.ARG_DEAD_LETTER_STRATEGY, RabbitNames.AT_LEAST_ONCE)
            .overflow(QueueBuilder.Overflow.rejectPublish)
            .build();
    }

    @Bean
    Queue paymentsParkingQueue() {     // no TTL: a human decides
        return QueueBuilder.durable(RabbitNames.PAYMENTS_PARKING_QUEUE).quorum().build();
    }

    @Bean
    Binding paymentsBinding(Queue paymentsQueue, DirectExchange paymentsExchange) {
        return BindingBuilder.bind(paymentsQueue).to(paymentsExchange).with(RabbitNames.PAYMENT_ROUTING_KEY);
    }

    @Bean
    Binding paymentsWaitBinding(Queue paymentsWaitQueue, DirectExchange paymentsWaitExchange) {
        return BindingBuilder.bind(paymentsWaitQueue).to(paymentsWaitExchange).with(RabbitNames.PAYMENTS_WAIT_KEY);
    }

    @Bean
    Binding paymentsParkingBinding(Queue paymentsParkingQueue, DirectExchange paymentsParkingExchange) {
        return BindingBuilder.bind(paymentsParkingQueue).to(paymentsParkingExchange).with(RabbitNames.PAYMENTS_PARKING_KEY);
    }
}
```

- Quorum queues (`QueueBuilder.durable(name).quorum()`) are the default for replicated, durable queues on a cluster; classic mirrored queues are legacy. They support the per-queue `ttl` used here.
- Quorum queues dead-letter at-most-once by default: a message can be lost if the dead-letter target is unavailable. `x-dead-letter-strategy: at-least-once` fixes that and requires `overflow: reject-publish` on the queue, so set both on every queue that dead-letters (main and wait).
- Cap the cycles from the broker's `x-death` header: each pass through the wait queue increments the count. RabbitMQ 4 ignores `x-*` headers set by a client, so the count must come from broker dead-lettering, as here. Spring AMQP 3.2+ also maps it to the `retry-count` header (`MessageProperties.RETRY_COUNT`, `getRetryCount()`), which does not exist in 3.1 (Boot 3.2 and 3.3). The helper below reads `x-death` and works on both. At the cap the listener throws `AmqpRejectAndDontRequeueException`: it is in the non-retryable set, so the shared recoverer (below) parks the message with publisher confirms.

```java
@RabbitListener(queues = RabbitNames.PAYMENTS_QUEUE)
public void on(Message message, PaymentRequested request) {
    if (attempts(message) >= RabbitNames.MAX_REDELIVERIES) {
        throw new AmqpRejectAndDontRequeueException("attempt cap reached");   // fatal: the recoverer parks it
    }
    handler.handle(request);                      // idempotent; throws on failure
}

static long attempts(Message message) {           // x-death: one entry per queue and reason, with a count
    List<Map<String, ?>> deaths = message.getMessageProperties().getXDeathHeader();
    if (deaths == null || deaths.isEmpty()) { return 0; }
    return deaths.get(0).get(RabbitNames.X_DEATH_COUNT) instanceof Number count ? count.longValue() : 0;   // "count"
}
```

## Failure classification

- Non-retryable failures (invalid or unconvertible payload, rule violation) must not be retried in process and must not cycle through the wait queue: they go to the parking lot at once. Transient failures retry in process a few times, then take the wait-queue cycle.
- Use one shared set of exception types for the retry policy (which sees the listener exception wrapped, so it must traverse causes) and for the recoverer:

```java
final class RetryClassification {
    // Same families as Spring AMQP's DefaultExceptionStrategy: never retry what cannot succeed.
    static final Map<Class<? extends Throwable>, Boolean> RETRYABLE = Map.of(
        InvalidMessageException.class, false,
        AmqpRejectAndDontRequeueException.class, false,
        org.springframework.amqp.support.converter.MessageConversionException.class, false,
        org.springframework.messaging.converter.MessageConversionException.class, false,
        org.springframework.messaging.handler.invocation.MethodArgumentResolutionException.class, false,
        ClassCastException.class, false);

    static boolean isFatal(Throwable failure) {
        for (Throwable t = failure; t != null; t = t.getCause()) {
            for (Class<? extends Throwable> fatal : RETRYABLE.keySet()) {
                if (fatal.isInstance(t)) { return true; }       // subclasses count too
            }
        }
        return false;
    }

    private RetryClassification() {}
}

@Configuration
class RabbitRetryConfig {
    @Bean
    RabbitRetryTemplateCustomizer listenerRetryClassification(RabbitProperties rabbit) {
        int maxAttempts = rabbit.getListener().getSimple().getRetry().getMaxAttempts();
        return (target, retryTemplate) -> {
            if (target == RabbitRetryTemplateCustomizer.Target.LISTENER) {
                // traverseCauses = true (the listener exception wraps yours); unlisted exceptions retry
                retryTemplate.setRetryPolicy(new SimpleRetryPolicy(maxAttempts, RetryClassification.RETRYABLE, true, true));
            }
        };
    }

    @Bean
    MessageRecoverer parkingRecoverer(RabbitTemplate template) {
        var parking = new RepublishMessageRecovererWithConfirms(template,
            RabbitNames.PAYMENTS_PARKING_EXCHANGE, RabbitNames.PAYMENTS_PARKING_KEY, CachingConnectionFactory.ConfirmType.CORRELATED);
        parking.setConfirmTimeout(RabbitNames.PARKING_CONFIRM_TIMEOUT_MS);
        return (message, cause) -> {
            if (RetryClassification.isFatal(cause)) {
                parking.recover(message, cause);          // waits for the broker confirm; acked only once parked
            } else {
                throw new AmqpRejectAndDontRequeueException("retry via the wait queue", cause);   // rejected, dead-lettered
            }
        };
    }
}
```

- `InvalidMessageException` is your own typed exception for a failed validation. The two `MessageConversionException` classes (AMQP converter and Spring messaging converter) are spelled out because the simple names clash. Throw `AmqpRejectAndDontRequeueException` only for a deliberate park.
- Parking must not lose the message, and it is the one publish that must not be fire-and-forget: `RepublishMessageRecovererWithConfirms` (spring-rabbit 2.3.3+) waits for the confirm and throws `AmqpNackReceivedException` on a nack or `AmqpMessageReturnedException` on an unroutable message. The failure leaves the original message unacked-and-rejected, so it goes back into the wait-queue cycle instead of being lost. It needs `publisher-confirm-type: correlated` and `publisher-returns: true`.
- The recoverer republishes with exception headers (class, message, stack trace): treat the parking lot as sensitive and never put payload data in an exception message.
- The recoverer runs when in-process retries are exhausted, or at once for a non-retryable exception.
- Do not requeue in a tight loop. `ImmediateRequeueAmqpException` is for rare, deliberate cases.

## Publishing: confirms and returns

`publisher-confirm-type: correlated`, `publisher-returns` and `mandatory` only take effect when the publisher waits for the result. Send with a `CorrelationData` (its id is the message id), wait on `getFuture()` with a timeout, and count the send as done only when the confirm is an ack and `getReturned()` is null (a non-null value means the message was unroutable). The accessors are `CorrelationData.getFuture()`, `CorrelationData.Confirm.isAck()` and `CorrelationData.getReturned()` on Spring AMQP 3.x and 4.0 (`ack()` exists only on 4.0).

```java
CorrelationData correlation = new CorrelationData(row.messageId());
rabbitTemplate.convertAndSend(row.exchange(), row.routingKey(), row.payload(), correlation);
CorrelationData.Confirm confirm = correlation.getFuture().get(RabbitNames.CONFIRM_TIMEOUT_MS, TimeUnit.MILLISECONDS);   // throws on timeout
if (confirm.isAck() && correlation.getReturned() == null) {
    outbox.markPublished(row.id());                // only now
}                                                  // otherwise leave the row for the next run
```

- A timeout, a nack or a returned message leaves the outbox row unpublished for the next run: consumers dedupe, so a repeat is safe.
- A fire-and-forget `convertAndSend` without `CorrelationData` ignores the broker's answer and can lose a message silently.

## Context propagation

- With observation enabled and a Micrometer Tracing bridge on the classpath, the publisher writes `traceparent` and the consumer continues the trace, so `traceId` and `spanId` are in MDC for the listener.
- The correlation id is your own header: read it from the message properties, or generate one when missing, put it in MDC for the duration of the message and remove it in `finally`.
- Never log the body. Log message id, exchange, routing key, queue, outcome and duration.

## Operations

- Metrics: queue depth, unacked messages, consumer count, publish confirm failures, wait-queue depth, parking-lot depth and age of its oldest message.
- Runbook for a parked message: inspect, fix the cause, republish it to the main exchange with a tool, never edit the live queue.
- Secrets and certificates come from the environment or a vault. Use one vhost per service, with only the permissions it needs.
- Test with Testcontainers RabbitMQ (`RabbitMQContainer` with `@ServiceConnection`, Boot 3.1+): a duplicate delivery processed once, a poison message ends in the parking-lot queue after the attempt cap, a message is not acked when the work fails.

## Other stacks

- Node (`amqplib`): `channel.ack` only after the handler resolves; `channel.nack(msg, false, false)` to dead-letter; confirm channel for publishers; validate the decoded body with a typed schema.
- Go (`amqp091-go`): manual ack (`Delivery.Ack`), `Nack` with `requeue=false`, `QoS` for prefetch, publisher confirms (`Channel.Confirm`), reconnect on `NotifyClose`.
