Goes to `src/common/messaging/messaging.module.ts`.

```ts
// Default location: src/common/messaging/messaging.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessagePublisher } from './message-publisher';
import { ProcessedMessage } from './processed-message.entity';
import { ProcessedMessageStore } from './processed-message.store';
import { RabbitMqConnection } from './rabbitmq.connection';

/** The broker connection, the publisher and the idempotency store, shared by every consumer and producer module. */
@Module({
  imports: [TypeOrmModule.forFeature([ProcessedMessage])],
  providers: [RabbitMqConnection, MessagePublisher, ProcessedMessageStore],
  exports: [RabbitMqConnection, MessagePublisher, ProcessedMessageStore],
})
export class MessagingModule {}
```
