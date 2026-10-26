Goes to `src/common/messaging/processed-message.store.ts`.

```ts
// Default location: src/common/messaging/processed-message.store.ts
import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ProcessedMessage } from './processed-message.entity';

const MESSAGE_ID_COLUMN = 'messageId';

/**
 * The idempotency store. Call it with the manager of the transaction that applies the message, so the marker and the
 * effect commit or roll back together. One atomic insert-or-ignore (ON CONFLICT DO NOTHING): a concurrent duplicate
 * waits on the first one's row and then finds it. Never insert and catch the duplicate-key error inside a transaction:
 * on Postgres the transaction is aborted by then.
 */
@Injectable()
export class ProcessedMessageStore {
  /** True the first time (consumer, messageId) is seen in a committed transaction; false for a duplicate. */
  async markIfNew(manager: EntityManager, consumer: string, messageId: string): Promise<boolean> {
    const result = await manager.createQueryBuilder()
      .insert()
      .into(ProcessedMessage)
      .values({ consumer, messageId })
      .orIgnore()
      .returning([MESSAGE_ID_COLUMN])
      .execute();
    const inserted: unknown = result.raw; // the RETURNING rows: none when the row already existed
    return Array.isArray(inserted) && inserted.length === 1;
  }
}
```
