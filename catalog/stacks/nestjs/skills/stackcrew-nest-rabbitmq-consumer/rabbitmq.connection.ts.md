Goes to `src/common/messaging/rabbitmq.connection.ts`.

```ts
// Default location: src/common/messaging/rabbitmq.connection.ts
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, type AmqpConnectionManager, type ChannelWrapper, type CreateChannelOpts } from 'amqp-connection-manager';
import type { RabbitMqEnv } from '../../config/env';

const HEARTBEAT_SECONDS = 30;
/** On shutdown, how long closing the connection may take; keep the shutdown bounds under terminationGracePeriodSeconds. */
export const CLOSE_GRACE_MS = 5_000;
/**
 * How long a consumer stays down after a channel error. amqp-connection-manager 4.x re-creates a channel only after a
 * reconnect, and a channel the broker closes (a 406, a failed setup) turns into that reconnect because amqplib's
 * unhandled channel 'error' takes the connection down. So never add an 'error' listener to the raw channel in a setup
 * function: the channel would stay closed with the consumer gone. The default would be the heartbeat (30 s).
 */
const RECONNECT_SECONDS = 5;
const CONNECTED = 'rabbitmq_connected';
const CONNECT_FAILED = 'rabbitmq_connect_failed';
const DISCONNECTED = 'rabbitmq_disconnected';
const CHANNEL_ERROR = 'rabbitmq_channel_error';

/**
 * One long-lived connection per process (amqp-connection-manager): it reconnects by itself, re-runs every channel's
 * setup (topology, prefetch) after a reconnect, then registers again the consumers added through the wrapper's
 * consume(), and holds publishes until the broker is back (each up to its publish timeout). The URL carries
 * credentials, so it is never logged; only error names and AMQP codes are. Closed on shutdown, within CLOSE_GRACE_MS.
 */
@Injectable()
export class RabbitMqConnection implements OnApplicationShutdown {
  private readonly logger = new Logger(RabbitMqConnection.name);
  private readonly manager: AmqpConnectionManager;

  constructor(config: ConfigService<RabbitMqEnv, true>) {
    this.manager = connect([config.get('RABBITMQ_URL', { infer: true })], {
      heartbeatIntervalInSeconds: HEARTBEAT_SECONDS,
      reconnectTimeInSeconds: RECONNECT_SECONDS,
    });
    this.manager.on('connect', () => this.logger.log({ event: CONNECTED }, CONNECTED));
    // `err` is optional in amqp-connection-manager 5's types; typing it so fits 4.x and 5.x
    this.manager.on('connectFailed', ({ err }: { err?: Error }) => this.logger.warn({ event: CONNECT_FAILED, error: err?.name }, CONNECT_FAILED));
    this.manager.on('disconnect', ({ err }: { err?: Error }) => this.logger.warn({ event: DISCONNECTED, error: err?.name }, DISCONNECTED));
  }

  /**
   * A confirm channel unless `confirm: false`: its publish() resolves once the broker has the message. Every channel
   * gets an 'error' listener: amqp-connection-manager emits 'error' when a setup function rejects (a queue redeclared
   * with other arguments gives PRECONDITION_FAILED, 406), and an EventEmitter without a listener throws, which would
   * crash the process. The line names the channel, the error class and the AMQP code; never the message.
   */
  createChannel(name: string, options: CreateChannelOpts = {}): ChannelWrapper {
    const channel = this.manager.createChannel({ ...options, name });
    channel.on('error', (err: Error & { code?: number }) => this.logger.error({ event: CHANNEL_ERROR, channel: name, error: err.name, code: err.code }, CHANNEL_ERROR));
    return channel;
  }

  /** For the readiness probe (@nestjs/terminus). */
  isConnected(): boolean {
    return this.manager.isConnected();
  }

  async onApplicationShutdown(): Promise<void> {
    await settledWithin([this.manager.close()], CLOSE_GRACE_MS); // a close that hangs (a dead broker) must not hold the pod
  }
}

/** Waits for the promises to settle, at most `ms`; never rejects. Shutdown steps use it so each one is bounded. */
export async function settledWithin(promises: readonly Promise<unknown>[], ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, ms));
  });
  await Promise.race([Promise.allSettled(promises), grace]);
  clearTimeout(timer);
}
```
