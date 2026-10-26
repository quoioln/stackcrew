Goes to `src/common/messaging/messaging.types.ts`.

```ts
// Default location: src/common/messaging/messaging.types.ts

/** Every message is a typed record with an id (the dedupe key), a type, a version and when it happened (UTC). */
export type MessageEnvelope = {
  readonly messageId: string;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
};

/**
 * One work queue and its retry topology (addon-rabbitmq): the main queue, its dead-letter exchange, a wait queue
 * whose TTL sends a failed message back for another attempt, and a parking-lot queue with no TTL.
 */
export type WorkQueue = {
  /** The producer's exchange (topic) and the routing key this queue is bound with. */
  readonly exchange: string;
  readonly routingKey: string;
  /** The main queue. The dead-letter exchange, the wait queue and the parking queue are named after it. */
  readonly queue: string;
  /** The wait before the next attempt. It is a queue argument: an existing queue keeps the value it was declared with. */
  readonly retryDelayMs: number;
  /** Deliveries before a failing message is parked, counted by the broker in x-death. */
  readonly maxAttempts: number;
  /** Unacked messages per consumer (QoS). */
  readonly prefetch: number;
};

/** x-request-id, x-tenant-id and x-user-id: the headers a consumer rebuilds its context from. */
export type ContextHeaders = Record<string, string>;
```
