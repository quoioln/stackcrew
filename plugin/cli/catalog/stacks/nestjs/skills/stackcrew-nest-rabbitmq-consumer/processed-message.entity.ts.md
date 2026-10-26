Goes to `src/common/messaging/processed-message.entity.ts`.

```ts
// Default location: src/common/messaging/processed-message.entity.ts
import { Entity, PrimaryColumn } from 'typeorm';
import { {{sc:baseEntity}} } from '../database/base.entity';

const CONSUMER_LENGTH = 100;
const MESSAGE_ID_LENGTH = 100;

/**
 * The idempotency store: one row per (consumer, message id) a consumer has applied, written in the same transaction as
 * the message's effect. createdAt is when it was applied. Not tenant-scoped: message ids are unique across tenants.
 */
@Entity('processed_message')
export class ProcessedMessage extends {{sc:baseEntity}} {
  @PrimaryColumn({ type: 'varchar', length: CONSUMER_LENGTH, primaryKeyConstraintName: 'processed_message_pkey' })
  readonly consumer!: string;

  @PrimaryColumn({ type: 'varchar', length: MESSAGE_ID_LENGTH, primaryKeyConstraintName: 'processed_message_pkey' })
  readonly messageId!: string;
}
```
