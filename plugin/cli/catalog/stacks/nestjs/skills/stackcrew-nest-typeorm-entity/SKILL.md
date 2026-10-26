---
name: stackcrew-nest-typeorm-entity
description: Use when adding or changing a TypeORM entity in a NestJS service: the entity class, its migration, the shared base classes with the four audit fields, AuditSubscriber, tenant isolation through TenantScopedRepository and TenantSubscriber, cross-tenant reads with runCrossTenant, and the audit and tenant tests on Postgres.
kind: task
requiresAddons: ["typeorm"]
---
# Add a TypeORM entity (NestJS 10, TypeORM 0.3)

Implements `core-persistence` and `addon-typeorm`. Write the SC-PREFLIGHT note first: the entity and its table, whether it is tenant-scoped, and which of the pieces below already exist. The request context (`runWithRequestContext`, `runAsSystem`, `runCrossTenant`, `requireTenantId`) comes from `stackcrew-nest-request-logging` (`src/common/context/request-context.ts`); set that up first.

## 1. Find the shared pieces before writing any

Search the codebase and the shared libraries ({{sc:sharedLibraries}}) for `{{sc:baseEntity}}`, `{{sc:baseTenantEntity}}`, an `EntitySubscriberInterface` that fills `createdBy`, and `TenantScopedRepository`. Use what exists. Create only what is missing, once, from the files next to this skill (the first line of each names its default location):

| File | What it does |
|---|---|
| `base.entity.ts` | `{{sc:baseEntity}}`: `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, readonly, no id. |
| `base-tenant.entity.ts` | `{{sc:baseTenantEntity}}`: adds `{{sc:tenantColumn}}` (`update: false`). |
| `audit.subscriber.ts` | `AuditSubscriber`: `createdBy`/`updatedBy` = the context user, or `{{sc:systemUser}}`. |
| `tenant.subscriber.ts` | `TenantSubscriber`: assigns the tenant on insert; refuses a row of another tenant when it is loaded or saved. |
| `tenant-scoped.repository.ts` | `TenantScopedRepository<T>`: the tenant condition on every read, count, update, delete and soft delete. |
| `customer-profile.entity.ts`, `customer-profile.repository.ts` | An example tenant entity and its repository. |
| `create-customer-profile.migration.ts` | Its migration, saved as `src/database/migrations/<timestamp>-create-customer-profile.ts`. |
| `customer-profile.persistence.spec.ts` | The audit and tenant tests (section 7). |

Never extend or import TypeORM's own `BaseEntity` (Active Record); the stackcrew ESLint config refuses it.

## 2. DataSource

```ts
// src/database/database.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditSubscriber } from '../common/database/audit.subscriber';
import { TenantSubscriber } from '../common/database/tenant.subscriber';
import type { DatabaseEnv } from '../config/env';
import { CreateCustomerProfile1730000000000 } from './migrations/1730000000000-create-customer-profile';

const QUERY_TIMEOUT_MS = 5_000;
const POOL_SIZE = 10;

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<DatabaseEnv, true>) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL', { infer: true }),
        autoLoadEntities: true,
        subscribers: [AuditSubscriber, TenantSubscriber],
        migrations: [CreateCustomerProfile1730000000000],
        synchronize: false,
        uuidExtension: 'pgcrypto',
        extra: { max: POOL_SIZE, statement_timeout: QUERY_TIMEOUT_MS },
      }),
    }),
  ],
})
export class DatabaseModule {}
```

- Add `DATABASE_URL` to the env validation: this section in `src/config/env.ts`, plus `parseEnvSection(DatabaseEnv, raw)` in `validateEnv` and `DatabaseEnv` in the `Env` type.

```ts
// src/config/env.ts (add)
export class DatabaseEnv {
  @IsUrl({ protocols: ['postgres', 'postgresql'], require_tld: false })
  DATABASE_URL!: string;
}
```

- Both subscribers carry `@EventSubscriber()`. A subscriber class listed in `subscribers` without the decorator is never called.
- `synchronize: false` everywhere except a throwaway local database; migrations own the schema. Keep SQL and parameter logging off in production.
- `uuidExtension: 'pgcrypto'` makes TypeORM expect `gen_random_uuid()`, which Postgres 13+ has built in.

## 3. The entity

`customer-profile.entity.ts` is the shape to copy:

- Tenant data extends `{{sc:baseTenantEntity}}`; everything else extends `{{sc:baseEntity}}`. The stackcrew ESLint config fails on an `@Entity()` class that extends nothing.
- Never redeclare the audit fields or `{{sc:tenantColumn}}`, never assign them, never put them in a request DTO. They are `readonly`; the subscribers write them.
- The id strategy is the entity's choice (`@PrimaryGeneratedColumn('uuid')` here). Give constraints and indexes explicit names so the migration matches.
- Lengths and other numbers are named constants. Status values are an `as const` object stored as `varchar`.
- Entities never leave the service layer: map them to a response DTO (stack rule).

## 4. The migration

`create-customer-profile.migration.ts`: columns are named like the properties (TypeORM's default naming), so they are quoted camelCase: `"{{sc:tenantColumn}}"`, `"createdAt"`. With a snake_case naming strategy in the project, write them snake_case.

- Times are `TIMESTAMP WITH TIME ZONE`; `createdAt` and `updatedAt` default to `now()`.
- The tenant column leads every index a hot query uses (`("{{sc:tenantColumn}}", "status")` rather than `("status")`).
- Check that the migration matches the entities: after `runMigrations()`, `dataSource.driver.createSchemaBuilder().log()` must return no queries. Never edit an applied migration; add a new one.

## 5. Repository and writes

```ts
// a service method
async verify(id: string): Promise<boolean> {
  const changed = await this.profiles.update({ id }, { status: CustomerProfileStatus.VERIFIED });
  return changed === 1; // 0: no such row in this tenant (or soft deleted): answer 404
}
```

- Services inject the entity's `TenantScopedRepository` subclass (`CustomerProfileRepository`), never `Repository<T>`, `EntityManager`, `DataSource` or a QueryBuilder for a tenant entity.
- `find`, `findOne`, `findOneBy` and `count` add `{{sc:tenantColumn}} = <context tenant>` to the where (every element of an array where). A lookup by id of another tenant's row returns `null`.
- `update`, `delete` and `softDelete` add the same condition and return the number of rows changed; another tenant's row gives `0`. `update` and `softDelete` skip soft-deleted rows.
- `save` and `create`: the tenant and the audit fields are assigned on insert. `TenantSubscriber` refuses a save whose row belongs to another tenant (TypeORM loads the row by id before updating it) and refuses to load such a row anywhere.
- `softDelete` sets the `@DeleteDateColumn` through `update()`, so `updatedBy` is filled. Do not call TypeORM's own `softDelete`, `restore`, `upsert` (its update branch) or raw SQL on an audited entity; they skip the subscriber. `.callListeners(false)` skips it too.
- A bulk or QueryBuilder write a feature needs becomes a method of the entity's repository class, built on `writeScope` the same way, with an "audit fields filled" test. Raw SQL on a tenant table is banned.
- Every list query is paginated (`take`/`skip` or keyset) with a maximum page size and a stable `order`.

## 6. Where the tenant comes from

- **Request:** the JWT, through `JwtStrategy` and `RequestContextInterceptor` (stack rule, request-logging skill). Nothing to do in the service.
- **Message consumer:** `runWithRequestContext(contextFromMessageHeaders(headers), handler)`, from `x-tenant-id`, `x-user-id`, `x-request-id`. Producers always send them.
- **Job and migration:** `runAsSystem(tenantId, work)`, one tenant per unit of work, or `undefined` when the job touches no tenant entity. It is the only way to act as `{{sc:systemUser}}`. Seeds and data migrations run through it too.
- **No tenant:** every read and write of a tenant entity throws `MissingTenantError`. Never catch it to retry without a tenant.

## 7. Cross-tenant reads

```ts
const rows = await runCrossTenant('monthly volume report', () => this.profiles.find({ order: { createdAt: 'DESC' }, take: REPORT_PAGE_SIZE }));
```

- Allowed for a role in `CROSS_TENANT_ROLES` (claim `{{sc:rolesClaim}}`; default {{sc:crossTenantRoles}}) and inside `runAsSystem`. Anyone else gets `CrossTenantDeniedError`, which the filter maps to 404. A token `sub`, an `x-user-id` header or a context user that happens to be `{{sc:systemUser}}` does not count.
- It logs `event=cross_tenant` with `userId`, `tenantId` and the reason. The reason is a short, human-readable sentence.
- Read only: inside, there is no tenant, so every write throws `MissingTenantError`. Return DTOs.
- Do not add a second bypass: no raw SQL, no flag that skips the condition, no second repository without it.

## 8. Tests

`customer-profile.persistence.spec.ts` runs against a real Postgres in Testcontainers (`@testcontainers/postgresql`; ask the user before adding it) with the real migration and both subscribers. Write the same tests for every new tenant entity:

- the four audit fields on insert, on `update`, on a `save` of a loaded row and on `softDelete`, and `{{sc:systemUser}}` inside `runAsSystem`;
- tenant B cannot read, count, find by id, update, delete, soft delete or save over tenant A's row, and the row is unchanged afterwards;
- no tenant: reads and writes throw `MissingTenantError`;
- a cross-tenant role reads every tenant and cannot write; another role is denied; `runAsSystem` reads; a context user or consumer header named `{{sc:systemUser}}` is denied.

`process.env.CROSS_TENANT_ROLES` is set on the first line of the spec: `tenancyEnv()` reads it once per test file.

## Do not

- Do not create a second base class when `{{sc:baseEntity}}` exists in the codebase or a shared library.
- Do not set `createdAt`, `createdBy`, `updatedAt`, `updatedBy` or `{{sc:tenantColumn}}` in code, DTOs or SQL inserts.
- Do not read the tenant from a request parameter, a path variable, an HTTP header or the body.
- Do not inject `Repository<T>`, `EntityManager` or `DataSource` for a tenant entity, and do not write a `where` on `{{sc:tenantColumn}}` by hand.
- Do not return entities from a controller.
