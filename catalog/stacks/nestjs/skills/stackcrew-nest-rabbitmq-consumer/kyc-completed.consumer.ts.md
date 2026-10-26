Goes to `src/modules/customer-profiles/messaging/kyc-completed.consumer.ts`.

```ts
// Default location: src/modules/customer-profiles/messaging/kyc-completed.consumer.ts
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { contextFromMessageHeaders, contextLogFields, runWithRequestContext } from '../../../common/context/request-context';
import { bodyPlaceholder, loadLogBodies, loadMaskOptions, maskCapturedBody } from '../../../common/logging/body-masker';
import { LogEvent, writeCallLine } from '../../../common/logging/log-fields';
import { decodeMessage } from '../../../common/messaging/message-codec';
import { ParkReason, parkReasonOf } from '../../../common/messaging/message-errors';
import { RabbitMqConnection, settledWithin } from '../../../common/messaging/rabbitmq.connection';
import { assertWorkQueue, deadLetterExchange, failedDeliveries, PARKING_ROUTING_KEY } from '../../../common/messaging/work-queue';
import { KycCompletedHandler } from './kyc-completed.handler';
import { KycCompletedMessage } from './kyc-completed.message';
import { KYC_COMPLETED_QUEUE } from './kyc-messaging.constants';

const JSON_CONTENT_TYPE = 'application/json';
const PARKED_REASON_HEADER = 'x-parked-reason';
const CONSUMER_CHANNEL = 'kyc-completed';
/** On shutdown, the bound on the whole drain: the cancel, the deliveries in flight and the channel close. */
const SHUTDOWN_GRACE_MS = 10_000;
const MESSAGE_OUTCOME = 'message_outcome';
const CONSUMER_STOPPED = 'consumer_stopped';
const Outcome = { APPLIED: 'applied', DUPLICATE: 'duplicate', RETRY: 'retry', PARKED: 'parked', PARK_FAILED: 'park_failed', UNSETTLED: 'unsettled' } as const;

/**
 * Consumes kyc.completed (addon-rabbitmq): manual ack after the work, a wait queue for transient failures, a parking
 * queue for messages that cannot succeed. Each delivery runs in the context rebuilt from its headers, logs one masked
 * message_in line, and is acked, retried or parked on the channel that delivered it.
 */
@Injectable()
export class KycCompletedConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(KycCompletedConsumer.name);
  private readonly logBodies = loadLogBodies();
  private readonly maskOptions = loadMaskOptions();
  private readonly inFlight = new Set<Promise<void>>();
  private readonly consumerTag = `${CONSUMER_CHANNEL}-${randomUUID()}`;
  private channel: ChannelWrapper | undefined;
  private registered: Promise<void> = Promise.resolve();
  /** The raw channel of the latest successful setup: deliveries arrive on it, so they are settled on it. */
  private delivering: ConfirmChannel | undefined;
  private consuming = false;
  private stopping = false;

  constructor(
    private readonly rabbit: RabbitMqConnection,
    private readonly handler: KycCompletedHandler,
  ) {}

  /**
   * Starts once the app is up. The ChannelWrapper owns the consumer: after every reconnect it runs setup (topology,
   * prefetch) and then registers the consumer again, and after a broker cancel (the queue was deleted or the broker
   * cancelled the consumer) it registers it again at once on the same channel.
   */
  onApplicationBootstrap(): void {
    const channel = this.rabbit.createChannel(CONSUMER_CHANNEL, { setup: (raw: ConfirmChannel) => this.setup(raw) });
    this.channel = channel;
    channel.on('connect', () => this.refreshConsuming()); // setup ran and the consumer is registered again
    this.registered = this.register(channel);
  }

  /**
   * For the readiness probe only, never liveness: true while a setup succeeded on a live channel and this consumer is
   * registered. A failed setup (logged by RabbitMqConnection) or a closed channel leaves it false until a reconnect.
   */
  isConsuming(): boolean {
    return this.consuming;
  }

  /** Resolves once the topology is declared and the consumer is registered (tests). */
  async ready(): Promise<void> {
    await this.registered;
    await this.channel?.waitForConnect();
  }

  /**
   * Stops new deliveries (the wrapper forgets the cancelled consumer, so no reconnect registers it again), waits for
   * the deliveries in flight, then closes. The cancel, the wait and the close share SHUTDOWN_GRACE_MS; messages still
   * unacked go back to the queue when the channel closes.
   */
  async onModuleDestroy(): Promise<void> {
    this.stopping = true; // a reconnect during the drain runs setup, which then declares and registers nothing
    this.consuming = false;
    const deadline = Date.now() + SHUTDOWN_GRACE_MS;
    if (this.channel !== undefined) {
      const cancelled = this.channel.cancel(this.consumerTag).catch((failure: unknown) => {
        this.logger.warn({ event: CONSUMER_STOPPED, queue: KYC_COMPLETED_QUEUE.queue, error: errorName(failure) }, CONSUMER_STOPPED);
      });
      await settledWithin([cancelled], deadline - Date.now());
    }
    await settledWithin([...this.inFlight], deadline - Date.now());
    if (this.inFlight.size > 0) {
      this.logger.warn({ event: CONSUMER_STOPPED, queue: KYC_COMPLETED_QUEUE.queue, unsettled: this.inFlight.size }, CONSUMER_STOPPED);
    }
    if (this.channel !== undefined) {
      await settledWithin([this.channel.close()], deadline - Date.now()); // the connection close follows, bounded too
    }
  }

  private async register(channel: ChannelWrapper): Promise<void> {
    try {
      await channel.consume(KYC_COMPLETED_QUEUE.queue, (msg) => this.deliver(msg), { noAck: false, consumerTag: this.consumerTag });
      this.refreshConsuming();
    } catch (failure: unknown) {
      // the wrapper keeps the consumer in its list and registers it on the next connect
      this.logger.warn({ event: CONSUMER_STOPPED, queue: KYC_COMPLETED_QUEUE.queue, error: errorName(failure) }, CONSUMER_STOPPED);
    }
  }

  private async setup(raw: ConfirmChannel): Promise<void> {
    this.delivering = undefined;
    this.refreshConsuming();
    if (this.stopping) {
      return; // during the drain: the cancelled consumer is not registered again, so there is nothing to declare
    }
    await assertWorkQueue(raw, KYC_COMPLETED_QUEUE);
    await raw.prefetch(KYC_COMPLETED_QUEUE.prefetch);
    raw.once('close', () => {
      if (this.delivering === raw) {
        this.delivering = undefined;
      }
      this.refreshConsuming(); // false until a reconnect runs setup again
    });
    this.delivering = raw;
  }

  private refreshConsuming(): void {
    this.consuming = !this.stopping && this.delivering !== undefined;
  }

  private deliver(msg: ConsumeMessage): void {
    const channel = this.delivering; // the wrapper registers the consumer on the channel the latest setup got
    if (channel === undefined) {
      this.outcome(msg, Outcome.UNSETTLED); // no live channel to settle on: the broker redelivers it after the close
      return;
    }
    const delivery = this.receive(channel, msg); // never rejects: every path acks, retries or parks, and logs the outcome
    this.inFlight.add(delivery);
    void delivery.finally(() => this.inFlight.delete(delivery));
  }

  /** One delivery, in the context of its headers: x-request-id, x-tenant-id, x-user-id. Never the system identity. */
  private async receive(channel: ConfirmChannel, msg: ConsumeMessage): Promise<void> {
    const headers: Readonly<Record<string, unknown>> | undefined = msg.properties.headers;
    try {
      await runWithRequestContext(contextFromMessageHeaders(headers), async () => {
        let applied: boolean;
        try {
          applied = await this.onMessage(msg.content, contentTypeOf(msg));
        } catch (failure: unknown) {
          await this.settleFailure(channel, msg, headers, failure);
          return;
        }
        this.settle(msg, () => channel.ack(msg), applied ? Outcome.APPLIED : Outcome.DUPLICATE); // after the commit
      });
    } catch (failure: unknown) {
      // not expected: runWithRequestContext refuses only inside another user's context, which a broker callback never
      // has. The message stays unacked and holds one prefetch slot until this channel closes; the broker then redelivers it.
      this.outcome(msg, Outcome.UNSETTLED, failure);
    }
  }

  /** One masked message_in line (over 2 MiB: its size only), then the typed handler. An empty or invalid payload is not retryable. */
  private async onMessage(payload: Buffer | undefined, contentType: string | undefined): Promise<boolean> {
    const type = contentType ?? JSON_CONTENT_TYPE;
    writeCallLine(this.logger, // never throws: the message is handled whatever happens to its line
      () => ({ event: LogEvent.MESSAGE_IN, ...contextLogFields(), reqBody: this.logBodies ? maskCapturedBody(payload, type, this.maskOptions) : undefined }),
      () => ({
        event: LogEvent.MESSAGE_IN, // an empty payload logs no body, as maskBody does
        reqBody: this.logBodies && payload !== undefined && payload.length > 0 ? bodyPlaceholder(type, payload.length) : undefined,
      }),
      'log');
    return this.handler.handle(decodeMessage(KycCompletedMessage, payload));
  }

  /** Non-retryable, or the last attempt: park. Otherwise nack without requeue: the DLX sends it to the wait queue. */
  private async settleFailure(channel: ConfirmChannel, msg: ConsumeMessage, headers: Readonly<Record<string, unknown>> | undefined, failure: unknown): Promise<void> {
    const attempt = failedDeliveries(headers, KYC_COMPLETED_QUEUE.queue) + 1;
    const reason = parkReasonOf(failure) ?? (attempt >= KYC_COMPLETED_QUEUE.maxAttempts ? ParkReason.ATTEMPTS : undefined);
    if (reason === undefined) {
      this.settle(msg, () => channel.nack(msg, false, false), Outcome.RETRY, failure); // back after retryDelayMs, counted in x-death
      return;
    }
    await this.park(channel, msg, reason, failure);
  }

  /** A copy goes to the parking queue on this confirm channel; the original is acked only once the broker has the copy. */
  private async park(channel: ConfirmChannel, msg: ConsumeMessage, reason: ParkReason, failure: unknown): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        channel.publish(deadLetterExchange(KYC_COMPLETED_QUEUE), PARKING_ROUTING_KEY, msg.content, {
          persistent: true,
          contentType: contentTypeOf(msg),
          messageId: messageIdOf(msg),
          headers: { ...msg.properties.headers, [PARKED_REASON_HEADER]: reason },
        }, (error: unknown) => (error ? reject(error) : resolve()));
      });
    } catch (parkFailure: unknown) {
      this.settle(msg, () => channel.nack(msg, false, false), Outcome.PARK_FAILED, parkFailure, reason); // the wait-queue cycle, not lost
      return;
    }
    this.settle(msg, () => channel.ack(msg), Outcome.PARKED, failure, reason);
  }

  /** ack or nack throws once the channel has closed; the broker then redelivers the message, so it is logged as unsettled. */
  private settle(msg: ConsumeMessage, action: () => void, outcome: string, failure?: unknown, reason?: ParkReason): void {
    try {
      action();
    } catch (settleFailure: unknown) {
      this.outcome(msg, Outcome.UNSETTLED, settleFailure, reason);
      return;
    }
    this.outcome(msg, outcome, failure, reason);
  }

  /** Ids and the outcome only, never the payload or an error message. Logging never throws. */
  private outcome(msg: ConsumeMessage, outcome: string, failure?: unknown, reason?: ParkReason): void {
    try {
      const line = { event: MESSAGE_OUTCOME, queue: KYC_COMPLETED_QUEUE.queue, messageId: messageIdOf(msg), outcome, reason, error: errorName(failure) };
      if (failure === undefined) {
        this.logger.log(line, MESSAGE_OUTCOME);
      } else {
        this.logger.warn(line, MESSAGE_OUTCOME);
      }
    } catch {
      process.emitWarning(`${MESSAGE_OUTCOME} line not written`);
    }
  }
}

function errorName(failure: unknown): string | undefined {
  return failure instanceof Error ? failure.name : undefined;
}

function contentTypeOf(msg: ConsumeMessage): string | undefined {
  const value: unknown = msg.properties.contentType;
  return typeof value === 'string' ? value : undefined;
}

function messageIdOf(msg: ConsumeMessage): string | undefined {
  const value: unknown = msg.properties.messageId;
  return typeof value === 'string' ? value : undefined;
}
```
