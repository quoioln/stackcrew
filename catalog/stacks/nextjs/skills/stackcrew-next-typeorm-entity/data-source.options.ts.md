Goes to `src/shared/db/data-source.options.ts`.

```ts
// Default location: src/shared/db/data-source.options.ts
import type { DataSourceOptions } from 'typeorm';
import { databaseEnv } from '../../env';
import { CustomerProfile } from '../../features/customer-profiles/customer-profile.entity';
import { AuditSubscriber } from './audit.subscriber';
import { CreateCustomerProfile1730000000000 } from './migrations/1730000000000-create-customer-profile';
import { TenantSubscriber } from './tenant.subscriber';

const QUERY_TIMEOUT_MS = 5_000;
const POOL_SIZE = 10;

/**
 * Every entity, subscriber and migration, listed by class. Next.js bundles server code, so path globs
 * ('src/**\/*.entity.ts') find nothing at run time. Add each new entity and migration here.
 */
export const ENTITIES = [CustomerProfile];
export const SUBSCRIBERS = [AuditSubscriber, TenantSubscriber];
export const MIGRATIONS = [CreateCustomerProfile1730000000000];

/**
 * The options of the app's DataSource (data-source.ts) and of the TypeORM CLI (data-source.cli.ts). No 'server-only'
 * here: the CLI runs this file outside Next.js. Migrations own the schema: never synchronize, never run them on boot.
 */
export function dataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseEnv().DATABASE_URL,
    entities: ENTITIES,
    subscribers: SUBSCRIBERS,
    migrations: MIGRATIONS,
    synchronize: false,
    migrationsRun: false,
    uuidExtension: 'pgcrypto',
    extra: { max: POOL_SIZE, statement_timeout: QUERY_TIMEOUT_MS },
  };
}
```
