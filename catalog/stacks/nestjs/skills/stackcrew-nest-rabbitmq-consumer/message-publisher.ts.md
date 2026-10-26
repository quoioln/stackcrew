Goes to `src/common/messaging/message-publisher.ts`.

```ts
// Default location: src/common/messaging/message-publisher.ts
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { ChannelWrapper } from 'amqp-connection-manager';
import { randomUUID } from 'node:crypto';
import { currentContext, REQUEST_ID_HEADER, TENANT_ID_HEADER, USER_ID_HEADER, type RequestContext } from '../context/request-context';
import type { ContextHeaders, MessageEnvelope } from './messaging.types';
import { RabbitMqConnection } from './rabbitmq.connection';

const JSON_CONTENT_TYPE = 'application/json';
const PUBLISH_TIMEOUT_MS = 10_000;
const PUBLISHER_CHANNEL = 'publisher';

/** The three context headers of a context: what a consumer rebuilds its own context from. */
export function contextHeaders(ctx: RequestContext | undefined): ContextHeaders {
  const headers: ContextHeaders = { [REQUEST_ID_HEADER]: ctx?.requestId ?? randomUUID() };
  if (ctx?.tenantId !== undefined) {
    headers[TENANT_ID_HEADER] = ctx.tenantId;
  }
  if (ctx?.userId !== undefined) {
    headers[USER_ID_HEADER] = ctx.userId;
  }
  return headers;
}

/**
 * Publishes a typed message as persistent JSON, with its id and type as message properties and the three context
 * headers. The promise resolves when the broker confirmed the message (confirm channel) and rejects on a nack or after
 * PUBLISH_TIMEOUT_MS. While the broker is down the message waits in this process's memory and a crash loses it: a
 * message that follows a database change goes through an outbox, and the relay passes the context stored with the row.
 */
@Injectable()
export class MessagePublisher implements OnModuleDestroy {
  private readonly channel: ChannelWrapper;

  constructor(rabbit: RabbitMqConnection) {
    this.channel = rabbit.createChannel(PUBLISHER_CHANNEL);
  }

  async publish(exchange: string, routingKey: string, message: MessageEnvelope, ctx: RequestContext | undefined = currentContext()): Promise<void> {
    await this.channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      contentType: JSON_CONTENT_TYPE,
      messageId: message.messageId,
      type: message.type,
      headers: contextHeaders(ctx),
      timeout: PUBLISH_TIMEOUT_MS,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel.close();
  }
}
```
