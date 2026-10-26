Goes to `src/common/messaging/rabbitmq.connection.ts`.

```ts
// Default location: src/common/messaging/rabbitmq.connection.ts
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, type AmqpConnectionManager, type ChannelWrapper, type CreateChannelOpts } from 'amqp-connection-manager';
import type { RabbitMqEnv } from '../../config/env';

const HEARTBEAT_SECONDS = 30;
const CONNECTED = 'rabbitmq_connected';
const CONNECT_FAILED = 'rabbitmq_connect_failed';
const DISCONNECTED = 'rabbitmq_disconnected';

/**
 * One long-lived connection per process (amqp-connection-manager): it reconnects by itself, re-runs every channel's
 * setup (topology, prefetch, consumer) after a reconnect, and holds publishes until the broker is back. The URL
 * carries credentials, so it is never logged; only the error name is. Closed on shutdown.
 */
@Injectable()
export class RabbitMqConnection implements OnApplicationShutdown {
  private readonly logger = new Logger(RabbitMqConnection.name);
  private readonly manager: AmqpConnectionManager;

  constructor(config: ConfigService<RabbitMqEnv, true>) {
    this.manager = connect([config.get('RABBITMQ_URL', { infer: true })], { heartbeatIntervalInSeconds: HEARTBEAT_SECONDS });
    this.manager.on('connect', () => this.logger.log({ event: CONNECTED }, CONNECTED));
    this.manager.on('connectFailed', ({ err }: { err: Error }) => this.logger.warn({ event: CONNECT_FAILED, error: err.name }, CONNECT_FAILED));
    this.manager.on('disconnect', ({ err }: { err: Error }) => this.logger.warn({ event: DISCONNECTED, error: err.name }, DISCONNECTED));
  }

  /** A confirm channel unless `confirm: false`: its publish() resolves once the broker has the message. */
  createChannel(options: CreateChannelOpts = {}): ChannelWrapper {
    return this.manager.createChannel(options);
  }

  /** For the readiness probe (@nestjs/terminus). */
  isConnected(): boolean {
    return this.manager.isConnected();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.manager.close();
  }
}
```
