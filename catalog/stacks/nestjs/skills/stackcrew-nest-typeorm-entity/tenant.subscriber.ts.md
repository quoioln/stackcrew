Goes to `src/common/database/tenant.subscriber.ts`.

```ts
// Default location: src/common/database/tenant.subscriber.ts
import { EventSubscriber, type EntitySubscriberInterface, type InsertEvent, type UpdateEvent } from 'typeorm';
import { CrossTenantDeniedError, isCrossTenant, requireTenantId } from '../context/request-context';
import { {{sc:baseTenantEntity}} } from './base-tenant.entity';

/**
 * A second line of defence behind TenantScopedRepository. It guards what TypeORM tells subscribers about: inserts get
 * the tenant of the context, a row of another tenant is refused when it is loaded (afterLoad) or saved over (save
 * loads the row first), and no tenant in the context throws MissingTenantError. It cannot see the rows that an
 * update() or delete() by criteria touches: those are tenant-safe only through TenantScopedRepository (withManager
 * inside a transaction), never through Repository, EntityManager or a QueryBuilder. Inside runCrossTenant loads pass
 * and writes throw (there is no tenant to write with).
 */
@EventSubscriber()
export class TenantSubscriber implements EntitySubscriberInterface<{{sc:baseTenantEntity}}> {
  listenTo(): typeof {{sc:baseTenantEntity}} {
    return {{sc:baseTenantEntity}};
  }

  beforeInsert(event: InsertEvent<{{sc:baseTenantEntity}}>): void {
    const tenantId = requireTenantId();
    const given: unknown = event.entity.{{sc:tenantColumn}};
    if (given !== undefined && given !== tenantId) {
      throw new CrossTenantDeniedError('insert for another tenant');
    }
    Object.assign(event.entity, { {{sc:tenantColumn}}: tenantId });
  }

  afterLoad(entity: {{sc:baseTenantEntity}}): void {
    if (isCrossTenant()) {
      return;
    }
    const owner: unknown = entity.{{sc:tenantColumn}};
    if (owner !== undefined && owner !== requireTenantId()) {
      throw new CrossTenantDeniedError('a row of another tenant was loaded');
    }
  }

  beforeUpdate(event: UpdateEvent<{{sc:baseTenantEntity}}>): void {
    const tenantId = requireTenantId();
    const owner: unknown = event.databaseEntity?.{{sc:tenantColumn}};
    const given: unknown = event.entity?.{{sc:tenantColumn}};
    if ((owner !== undefined && owner !== tenantId) || (given !== undefined && given !== tenantId)) {
      throw new CrossTenantDeniedError("update of another tenant's row");
    }
  }
}
```
