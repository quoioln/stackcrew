Goes to `src/modules/customer-profiles/messaging/kyc-completed.consumer.ts`.

```ts
// Default location: src/modules/customer-profiles/messaging/kyc-completed.consumer.ts
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { contextFromMessageHeaders, contextLogFields, runWithRequestContext } from '../../../common/context/request-context';
import { bodyPlaceholder, loadLogBodies, loadMaskOptions, maskBody } from '../../../common/logging/body-masker';
import { LogEvent, writeCallLine } from '../../../common/logging/log-fields';
import { decodeMessage } from '../../../common/messaging/message-codec';
import { ParkReason, parkReasonOf } from '../../../common/messaging/message-errors';
import { RabbitMqConnection } from '../../../common/messaging/rabbitmq.connection';
import { assertWorkQueue, deadLetterExchange, failedDeliveries, PARKING_ROUTING_KEY } from '../../../common/messaging/work-queue';
import { KycCompletedHandler } from './kyc-completed.handler';
import { KycCompletedMessage } from './kyc-completed.message';
import { KYC_COMPLETED_QUEUE } from './kyc-messaging.constants';

const JSON_CONTENT_TYPE = 'application/json';
const PARKED_REASON_HEADER = 'x-parked-reason';
const MESSAGE_OUTCOME = 'message_outcome';
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
  private channel: ChannelWrapper | undefined;

  constructor(
    private readonly rabbit: RabbitMqConnection,
    private readonly handler: KycCompletedHandler,
  ) {}

  /** Starts once the app is up. amqp-connection-manager runs setup again after every reconnect. */
  onApplicationBootstrap(): void {
    this.channel = this.rabbit.createChannel({ setup: (channel: ConfirmChannel) => this.setup(channel) });
  }

  /** Resolves once the topology is declared and the consumer is registered (readiness, tests). */
  async ready(): Promise<void> {
    await this.channel?.waitForConnect();
  }

  /** Stops deliveries; messages not acked yet go back to the queue for another consumer. */
  async onModuleDestroy(): Promise<void> {
    await this.channel?.close();
  }

  private async setup(channel: ConfirmChannel): Promise<void> {
    await assertWorkQueue(channel, KYC_COMPLETED_QUEUE);
    await channel.prefetch(KYC_COMPLETED_QUEUE.prefetch);
    await channel.consume(KYC_COMPLETED_QUEUE.queue, (msg) => {
      if (msg !== null) {
        void this.receive(channel, msg); // never rejects: every path acks, retries or parks, and logs the outcome
      }
    }, { noAck: false });
  }

  /** One delivery, in the context of its headers: x-request-id, x-tenant-id, x-user-id. Never the system identity. */
  private async receive(channel: ConfirmChannel, msg: ConsumeMessage): Promise<void> {
    const headers: Readonly<Record<string, unknown>> | undefined = msg.properties.headers;
    try {
      await runWithRequestContext(contextFromMessageHeaders(headers), async () => {
        try {
          const applied = await this.onMessage(msg.content, contentTypeOf(msg));
          channel.ack(msg);
          this.outcome(msg, applied ? Outcome.APPLIED : Outcome.DUPLICATE);
        } catch (failure: unknown) {
          await this.settleFailure(channel, msg, headers, failure);
        }
      });
    } catch (failure: unknown) {
      this.outcome(msg, Outcome.UNSETTLED, failure); // the channel closed after the delivery: the broker redelivers it
    }
  }

  /** One masked message_in line, then the typed handler. An empty or invalid payload is not retryable. */
  private async onMessage(payload: Buffer | undefined, contentType: string | undefined): Promise<boolean> {
    const type = contentType ?? JSON_CONTENT_TYPE;
    writeCallLine(this.logger, // never throws: the message is handled whatever happens to its line
      () => ({ event: LogEvent.MESSAGE_IN, ...contextLogFields(), reqBody: this.logBodies ? maskBody(payload, type, this.maskOptions) : undefined }),
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
      channel.nack(msg, false, false); // back to the main queue after retryDelayMs; the broker counts it in x-death
      this.outcome(msg, Outcome.RETRY, failure);
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
      channel.nack(msg, false, false); // not parked: it takes the wait-queue cycle instead of being lost
      this.outcome(msg, Outcome.PARK_FAILED, parkFailure, reason);
      return;
    }
    channel.ack(msg);
    this.outcome(msg, Outcome.PARKED, failure, reason);
  }

  /** Ids and the outcome only, never the payload or an error message. Logging never throws. */
  private outcome(msg: ConsumeMessage, outcome: string, failure?: unknown, reason?: ParkReason): void {
    try {
      const line = { event: MESSAGE_OUTCOME, queue: KYC_COMPLETED_QUEUE.queue, messageId: messageIdOf(msg), outcome, reason,
        error: failure instanceof Error ? failure.name : undefined };
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

function contentTypeOf(msg: ConsumeMessage): string | undefined {
  const value: unknown = msg.properties.contentType;
  return typeof value === 'string' ? value : undefined;
}

function messageIdOf(msg: ConsumeMessage): string | undefined {
  const value: unknown = msg.properties.messageId;
  return typeof value === 'string' ? value : undefined;
}
```
