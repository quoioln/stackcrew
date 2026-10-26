Goes to `src/common/database/audit.subscriber.ts`.

```ts
// Default location: src/common/database/audit.subscriber.ts
import { EventSubscriber, type EntitySubscriberInterface, type InsertEvent, type UpdateEvent } from 'typeorm';
import { currentActor } from '../context/request-context';
import { {{sc:baseEntity}} } from './base.entity';

/**
 * Fills createdBy and updatedBy from the request context ({{sc:systemUser}} when there is no user). TypeORM 0.3 calls it
 * on save, insert, update and QueryBuilder insert/update; on update() event.entity holds only the values being set,
 * and assigning updatedBy adds that column to the statement. Without @EventSubscriber() it is never called.
 */
@EventSubscriber()
export class AuditSubscriber implements EntitySubscriberInterface<{{sc:baseEntity}}> {
  listenTo(): typeof {{sc:baseEntity}} {
    return {{sc:baseEntity}};
  }

  beforeInsert(event: InsertEvent<{{sc:baseEntity}}>): void {
    const actor = currentActor();
    Object.assign(event.entity, { createdBy: actor, updatedBy: actor });
  }

  beforeUpdate(event: UpdateEvent<{{sc:baseEntity}}>): void {
    if (event.entity !== undefined) {
      Object.assign(event.entity, { updatedBy: currentActor() });
    }
  }
}
```
