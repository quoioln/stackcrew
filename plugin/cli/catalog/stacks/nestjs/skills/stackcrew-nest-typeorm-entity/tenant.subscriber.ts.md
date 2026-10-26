Goes to `src/common/database/tenant.subscriber.ts`.

```ts
// Default location: src/common/database/tenant.subscriber.ts
import { EventSubscriber, type EntitySubscriberInterface, type InsertEvent, type UpdateEvent } from 'typeorm';
import { CrossTenantDeniedError, isCrossTenant, requireTenantId } from '../context/request-context';
import { {{sc:baseTenantEntity}} } from './base-tenant.entity';

/**
 * The guard behind TenantScopedRepository, for every path that reaches TypeORM: inserts get the tenant of the context,
 * a row of another tenant is refused when it is loaded or saved, and no tenant in the context throws
 * MissingTenantError. Inside runCrossTenant loads pass and writes throw (there is no tenant to write with).
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
