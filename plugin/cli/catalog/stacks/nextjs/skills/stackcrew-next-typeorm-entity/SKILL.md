---
name: stackcrew-next-typeorm-entity
description: Use when adding or changing a TypeORM entity in a Next.js app: the entity class and its migration through the TypeORM CLI, the shared base classes with the four audit fields, AuditSubscriber, tenant isolation through TenantScopedRepository and TenantSubscriber, cross-tenant reads with runCrossTenant, the DataSource that survives dev reloads, the Next.js config TypeORM needs, and the audit and tenant tests on Postgres.
kind: task
requiresAddons: ["typeorm"]
---
# Add a TypeORM entity (Next.js 16, TypeORM 0.3)

Implements `core-persistence` and `addon-typeorm`. Write the SC-PREFLIGHT note first: the entity and its table, whether it is tenant-scoped, and which of the pieces below already exist. The request context (`runWithRequestContext`, `runAsSystem`, `runCrossTenant`, `requireTenantId`, `getRequestContext`) comes from `stackcrew-next-request-logging` (`src/shared/context/`); set that up first.

## 1. Find the shared pieces before writing any

Search the codebase and the shared libraries ({{sc:sharedLibraries}}) for `{{sc:baseEntity}}`, `{{sc:baseTenantEntity}}`, an `EntitySubscriberInterface` that fills `createdBy`, `TenantScopedRepository` and a `new DataSource(`. Use what exists. Create only what is missing, once, from the files next to this skill. Each `<file>.md` holds one source file: its first line says where the file goes, and the code block is the file's content.

| File | What it does |
|---|---|
| `base.entity.ts.md` | `{{sc:baseEntity}}`: `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, readonly, no id, explicit column types. |
| `base-tenant.entity.ts.md` | `{{sc:baseTenantEntity}}`: adds `{{sc:tenantColumn}}` (`update: false`). |
| `audit.subscriber.ts.md` | `AuditSubscriber`: `createdBy`/`updatedBy` = the context user, or `{{sc:systemUser}}`. |
| `tenant.subscriber.ts.md` | `TenantSubscriber`: assigns the tenant on insert; refuses a row of another tenant when it is loaded or saved. |
| `tenant-scoped.repository.ts.md` | `TenantScopedRepository<T>`: the tenant condition on every read, count, update, delete and soft delete; `withManager(manager)` for transactions. The same class as in the NestJS stack. |
| `data-source.options.ts.md` | The entities, subscribers and migrations, listed by class, and the options shared by the app and the CLI. |
| `data-source.ts.md` | `getDataSource()`: the DataSource of the process, kept on `globalThis` (`'server-only'`). |
| `data-source.cli.ts.md` | The DataSource the TypeORM CLI loads. |
| `customer-profile.entity.ts.md`, `customer-profile.repository.ts.md` | An example tenant entity, its repository and `customerProfiles()`. |
| `create-customer-profile.migration.ts.md` | Its migration, saved as `src/shared/db/migrations/<timestamp>-create-customer-profile.ts`. |
| `customer-profile.persistence.int.spec.ts.md` | The audit and tenant tests (section 8). |

Never extend or import TypeORM's own `BaseEntity` (Active Record); the stackcrew ESLint config refuses it.

## 2. Configuration

Add the database URL to `src/env.ts`: this line in `server`, and the section function at the end of the file.

```ts
// src/env.ts (add to server)
/** The Postgres database of the app, the TypeORM CLI and the integration tests. */
DATABASE_URL: z.string().url(),
```

```ts
// src/env.ts (add)
export type DatabaseEnv = Pick<typeof env, 'DATABASE_URL'>;

/** The DataSource options read the connection here (data-source.options.ts). */
export function databaseEnv(): DatabaseEnv {
  return env;
}
```

- `next.config.ts` lists `typeorm` (and `pino`) in `serverExternalPackages` (stack rule, Persistence). The build passes without `typeorm` there, but TypeORM is then bundled into each server layer, and a webpack build warns about its optional drivers (`mysql`, `react-native-sqlite-storage` and others). `pg` is on the built-in list.
- `tsconfig.json` sets `"experimentalDecorators": true`. Every column names its `type` (`{ type: 'varchar', length: 64 }`): Vitest never emits decorator metadata and Next.js does so only with `emitDecoratorMetadata`, so TypeORM cannot infer a type from the property.
- `synchronize: false` and `migrationsRun: false` everywhere: migrations own the schema and run as a deploy step, never on boot.
- `uuidExtension: 'pgcrypto'` makes TypeORM expect `gen_random_uuid()`, which Postgres 13+ has built in.

## 3. The DataSource

- Server code gets it through `getDataSource()`, or through a repository factory such as `customerProfiles()`. Never `new DataSource(...)` in a request.
- It lives on `globalThis`, so `next dev` does not open a new pool on every edit, and it is keyed by the entity list of the module that asks. Next.js evaluates server modules once per layer, one copy for Server Components and server actions and another for route handlers, and each copy has its own entity classes and its own request context: a DataSource built from one layer's classes cannot serve the other. So the process has one DataSource, and one pool, per server layer (two in a Turbopack build); size `POOL_SIZE` accordingly.
- An edit of an entity under `next dev` gives that layer a new DataSource; the idle connections of the old one close on their own.
- Entities, subscribers and migrations are listed by class in `data-source.options.ts`. Path globs find nothing in a bundle, and the production build minifies class names, so tables, indexes, constraints and migration `name`s are explicit strings.

## 4. The entity

`customer-profile.entity.ts.md` is the shape to copy:

- Tenant data extends `{{sc:baseTenantEntity}}`; everything else extends `{{sc:baseEntity}}`. The stackcrew ESLint config fails on an `@Entity()` class that extends nothing.
- Never redeclare the audit fields or `{{sc:tenantColumn}}`, never assign them, never put them in a zod schema or a DTO the client sends. They are `readonly`; the subscribers write them.
- The id strategy is the entity's choice (`@PrimaryGeneratedColumn('uuid')` here). Give constraints and indexes explicit names so the migration matches.
- Lengths and other numbers are named constants. Status values are an `as const` object stored as `varchar`.
- Entities never reach the client: a mapper turns them into DTOs (stack rule, Server actions).

## 5. The migration

Generate it with the TypeORM CLI, run through `tsx` (a dev dependency: ask first) so it reads the TypeScript options file and the env file. With yarn (`yarn tsx …`); with npm, `npx tsx …`:

```bash
yarn tsx --env-file=.env.local node_modules/typeorm/cli.js migration:generate src/shared/db/migrations/CreateCustomerProfile -d src/shared/db/data-source.cli.ts
yarn tsx --env-file=.env.local node_modules/typeorm/cli.js migration:run -d src/shared/db/data-source.cli.ts
yarn tsx --env-file=.env.local node_modules/typeorm/cli.js migration:revert -d src/shared/db/data-source.cli.ts
```

- Read the generated file before you keep it, and add its class to `MIGRATIONS` in `data-source.options.ts`. `create-customer-profile.migration.ts.md` is the reviewed result for the example entity.
- Columns are named like the properties (TypeORM's default naming), so they are quoted camelCase: `"{{sc:tenantColumn}}"`, `"createdAt"`. Times are `TIMESTAMP WITH TIME ZONE`; `createdAt` and `updatedAt` default to `now()`.
- The tenant column leads every index a hot query uses (`("{{sc:tenantColumn}}", "status")` rather than `("status")`).
- The integration test checks that the migrations match the entities: after `runMigrations()`, `dataSource.driver.createSchemaBuilder().log()` must return no queries. Never edit an applied migration; add a new one.

## 6. Repository and writes

- Server code (an action, a route handler, a loader) uses the entity's repository, `await customerProfiles()`, never `getRepository(Entity)`, the `EntityManager` or a QueryBuilder for a tenant entity. `getDataSource()` is for opening a transaction.
- `find`, `findOne`, `findOneBy` and `count` add `{{sc:tenantColumn}} = <context tenant>` to the where (every element of an array where). A lookup by id of another tenant's row returns `null`: answer `NOT_FOUND` or call `notFound()`.
- `update`, `delete` and `softDelete` add the same condition and return the number of rows changed; another tenant's row gives `0`. `update` and `softDelete` skip soft-deleted rows.
- `save` and `create`: the tenant and the audit fields are assigned on insert. `TenantSubscriber` refuses a save whose row belongs to another tenant and refuses to load such a row anywhere.
- `softDelete` sets the `@DeleteDateColumn` through `update()`, so `updatedBy` is filled. Do not call TypeORM's own `softDelete`, `restore`, `upsert` (its update branch) or raw SQL on an audited entity; they skip the subscriber. `.callListeners(false)` skips it too.
- A bulk or QueryBuilder write a feature needs becomes a method of the entity's repository class, built on `writeScope`, with an "audit fields filled" test. Raw SQL on a tenant table is banned.
- Every list query is paginated (`take`/`skip` or keyset) with a maximum page size and a stable `order`.
- Transactions: the tenant entity goes through `withManager(manager)`, the same scoped API (subclass methods included) on the transaction's manager:

```ts
// in a server action, after the checks: the writes of one transaction
const dataSource = await getDataSource();
const profiles = await customerProfiles();
const changed = await dataSource.transaction(async (manager) => profiles.withManager(manager).update({ id }, { status: CustomerProfileStatus.VERIFIED }));
```

- Never use any manager method on a tenant entity (getRepository, update, delete, increment, decrement, softDelete, restore, upsert, createQueryBuilder…), for example `manager.getRepository(CustomerProfile).update(...)`: none carries the tenant condition, and `TenantSubscriber` cannot see the rows an update or delete by criteria touches, so tenant B would change tenant A's rows. Never call a remote service inside a transaction.

## 7. Where the tenant comes from

- **Server action or route handler:** the wrapper's context (`withActionLogging`, `withRouteLogging`), from `auth()`. Nothing to do in the code.
- **Server Component:** the loader runs inside `runInRequestContext(fn)`; without it, every tenant read throws `MissingTenantError`.
- **Message consumer:** `runWithRequestContext(contextFromMessageHeaders(headers), handler)`, from `x-tenant-id`, `x-user-id`, `x-request-id`.
- **Job, script and data migration:** `runAsSystem(tenantId, work)`, one tenant per unit of work, or `undefined` when the job touches no tenant entity. It is the only way to act as `{{sc:systemUser}}`. Seeds run through it too.
- **No tenant:** every read and write of a tenant entity throws `MissingTenantError`. Never catch it to retry without a tenant.

## 8. Cross-tenant reads

```ts
// in a report loader
const rows = await runCrossTenant('monthly volume report', async () => (await customerProfiles()).find({ order: { createdAt: 'DESC' }, take: REPORT_PAGE_SIZE }));
```

- Allowed for a role in `CROSS_TENANT_ROLES` (claim `{{sc:rolesClaim}}`; default {{sc:crossTenantRoles}}) and inside `runAsSystem`. Anyone else gets `CrossTenantDeniedError`: answer it like a missing row (`NOT_FOUND`, `notFound()`). A session, an `x-user-id` header or a context user that happens to be `{{sc:systemUser}}` does not count.
- It logs `event=cross_tenant` with `userId`, `tenantId` and the reason, a short human-readable sentence.
- Read only: inside, there is no tenant, so every write throws `MissingTenantError`. Return DTOs.
- Do not add a second bypass: no raw SQL, no flag that skips the condition, no second repository without it.

## 9. Tests

`customer-profile.persistence.int.spec.ts.md` (saved as `customer-profile.persistence.int.spec.ts`) runs with the project's `vitest.int.config.ts` against the test database of `DATABASE_URL` (Postgres in Docker; stack testing rule), with the app's own DataSource options: the real migrations and both subscribers. Write the same tests for every new tenant entity:

- the four audit fields on insert, on `update`, on a `save` of a loaded row and on `softDelete`, and `{{sc:systemUser}}` inside `runAsSystem`;
- tenant B cannot read, count, find by id, update, delete, soft delete or save over tenant A's row, also inside a transaction through `withManager`, and the row is unchanged afterwards;
- no tenant: reads and writes throw `MissingTenantError`;
- a cross-tenant role reads every tenant and cannot write; another role is denied; `runAsSystem` reads; a context user or consumer header named `{{sc:systemUser}}` is denied.

`CROSS_TENANT_ROLES` is set in `vi.hoisted` at the top of the spec: `src/env.ts` is validated when it is first imported.

## Do not

- Do not create a second base class when `{{sc:baseEntity}}` exists in the codebase or a shared library.
- Do not set `createdAt`, `createdBy`, `updatedAt`, `updatedBy` or `{{sc:tenantColumn}}` in code, schemas or SQL inserts.
- Do not read the tenant from a search param, a route param, a header, a cookie or the body.
- Do not use `Repository<T>` or `EntityManager` for a tenant entity; open a transaction with `getDataSource()` and reach the tenant entity inside it through `withManager`. Do not write a `where` on `{{sc:tenantColumn}}` by hand.
- Do not return an entity from an action, a route handler or a loader, and do not pass one to a Client Component.
- Do not create a DataSource per request, and do not run migrations or `synchronize` at boot.
