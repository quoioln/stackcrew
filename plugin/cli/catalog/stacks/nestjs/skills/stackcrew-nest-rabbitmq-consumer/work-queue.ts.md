Goes to `src/common/messaging/work-queue.ts`.

```ts
// Default location: src/common/messaging/work-queue.ts
import type { ConfirmChannel } from 'amqplib';
import type { WorkQueue } from './messaging.types';

export const WAIT_ROUTING_KEY = 'wait';
export const PARKING_ROUTING_KEY = 'parking';
const TOPIC = 'topic';
const DIRECT = 'direct';
const DEFAULT_EXCHANGE = '';
const DEATH_HEADER = 'x-death';
const REJECTED = 'rejected';

/** Quorum queues; dead-lettering at least once (it needs reject-publish), so a message is never lost on its way. */
const REPLICATED = { 'x-queue-type': 'quorum', 'x-dead-letter-strategy': 'at-least-once', 'x-overflow': 'reject-publish' };

export const deadLetterExchange = (q: WorkQueue): string => `${q.queue}.dlx`;
export const waitQueue = (q: WorkQueue): string => `${q.queue}.wait`;
export const parkingQueue = (q: WorkQueue): string => `${q.queue}.parking`;

/**
 * Declares the topology; safe to run on every (re)connect. The arguments must match an existing queue, or the broker
 * closes the channel (PRECONDITION_FAILED): change them with a new queue name or a broker policy.
 * - main queue, bound to the producer's exchange: a rejected (nacked) message goes to the DLX with key "wait";
 * - wait queue: after retryDelayMs the message goes back through the default exchange to the main queue only, never
 *   to the producer's exchange, which would hand the retry to every other queue bound to it;
 * - parking queue, no TTL: messages that cannot succeed, for a person to inspect and republish.
 */
export async function assertWorkQueue(channel: ConfirmChannel, q: WorkQueue): Promise<void> {
  const dlx = deadLetterExchange(q);
  await channel.assertExchange(q.exchange, TOPIC, { durable: true });
  await channel.assertExchange(dlx, DIRECT, { durable: true });
  await channel.assertQueue(q.queue, {
    durable: true,
    arguments: { ...REPLICATED, 'x-dead-letter-exchange': dlx, 'x-dead-letter-routing-key': WAIT_ROUTING_KEY },
  });
  await channel.assertQueue(waitQueue(q), {
    durable: true,
    arguments: { ...REPLICATED, 'x-message-ttl': q.retryDelayMs, 'x-dead-letter-exchange': DEFAULT_EXCHANGE, 'x-dead-letter-routing-key': q.queue },
  });
  await channel.assertQueue(parkingQueue(q), { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  await channel.bindQueue(q.queue, q.exchange, q.routingKey);
  await channel.bindQueue(waitQueue(q), dlx, WAIT_ROUTING_KEY);
  await channel.bindQueue(parkingQueue(q), dlx, PARKING_ROUTING_KEY);
}

/** Earlier failed deliveries of this message: the broker's x-death count for the main queue, reason "rejected". */
export function failedDeliveries(headers: Readonly<Record<string, unknown>> | undefined, queue: string): number {
  const deaths: unknown = headers?.[DEATH_HEADER];
  const entries: readonly unknown[] = Array.isArray(deaths) ? deaths : [];
  for (const death of entries) {
    if (typeof death === 'object' && death !== null && 'queue' in death && death.queue === queue
      && 'reason' in death && death.reason === REJECTED && 'count' in death && typeof death.count === 'number') {
      return death.count;
    }
  }
  return 0;
}
```
