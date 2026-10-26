---
id: addon-typeorm
title: TypeORM
---
# TypeORM

Applies when the profile lists the `typeorm` add-on (TypeORM 0.3 with NestJS or Next.js). Extends `core-persistence` and `core-backend-api`.

## Essentials

- Entities extend the project base entity (`{{sc:baseEntity}}`, or `{{sc:baseTenantEntity}}` for tenant tables). Never extend TypeORM's own `BaseEntity` (Active Record), and never import it.
- Audit fields are filled by one `AuditSubscriber`, which reads the user from the request context (`{{sc:systemUser}}` when there is none). Code never sets `createdBy` or `updatedBy`.
- Tenant entities are read and written only through `TenantScopedRepository`. Never inject a raw `Repository`, `EntityManager` or QueryBuilder for a tenant entity.
- Write with `save`, `insert`, `update` or a QueryBuilder `insert()`/`update()`: TypeORM 0.3.31 calls the subscriber on each. `upsert` (its update branch), `softDelete`, `restore` and raw SQL do not set the audit fields: avoid them on audited entities, or set the fields in the same statement and prove it with a test. `.callListeners(false)` on a QueryBuilder skips subscribers: never use it on audited entities.
- Every write path an entity uses has an "audit fields filled" test. This pins the behavior across TypeORM upgrades.
- `synchronize: false` everywhere except local development. Schema changes go through migrations only; never edit an applied migration.
- Transactions use `DataSource.transaction(...)` or a `QueryRunner` (connect, start, commit or rollback, release in `finally`). Inside, reach a tenant entity only through its repository's `withManager(manager)`; never `manager.getRepository(Entity)`, `manager.update` or `manager.delete`, which carry no tenant condition. Other entities use the transaction's manager.
- Avoid N+1: load relations with `relations` or an intentional join, never inside a loop. Select only the columns a list needs.
- Every list query is paginated (`take`/`skip` or keyset) with a hard maximum page size and a stable `order`.
- Entities never leave the service layer: map to a response DTO (or a plain type) before returning.
- Set a query timeout and size the pool. Keep SQL and parameter logging off in production.

## Audit subscriber

- Register it with `@EventSubscriber()` (or push it onto `dataSource.subscribers`). A subscriber class that is only listed in the `subscribers` option, without the decorator, is silently never called.
- Fill `createdBy` and `updatedBy` in `beforeInsert`, and `updatedBy` in `beforeUpdate`. On `update()` and QueryBuilder updates, `event.entity` holds only the values being set, without the primary key, and assigning a field on it adds that column to the statement.
- The subscriber reads the context through the shared helper. It does not inject the request.
- `createdAt` and `updatedAt` use `@CreateDateColumn` and `@UpdateDateColumn` with `timestamptz`.
- Inside a subscriber, use `event.manager` or `event.queryRunner` for any database call.

## Tenant repository

- `TenantScopedRepository<T extends {{sc:baseTenantEntity}}>` adds the `{{sc:tenantColumn}}` condition to every read, count, update, delete and soft delete, and assigns the tenant on every write, taking the tenant from the request context. Without that condition on updates and deletes, tenant A could modify tenant B's row.
- A feature that needs a bulk or QueryBuilder write on a tenant entity does not build it in a service: add the method to `TenantScopedRepository`, where the tenant condition is applied in one place.
- Soft delete through `TenantScopedRepository.softDelete`, which sets the delete date column with a tenant-filtered `update`, so the subscriber fills `updatedBy`. TypeORM's own `softDelete` skips the subscriber.
- A missing tenant throws. Never fall back to an unfiltered query.
- Cross-tenant reads use `runCrossTenant(reason, work)` and nothing else.

## Next.js

- Create one `DataSource` per process and keep it on `globalThis` so hot reload does not open a new pool on every edit.
- Keep TypeORM out of the client bundle: `import 'server-only'` in data modules, and list `typeorm` in `serverExternalPackages` (`pg` is already on Next's default list).
