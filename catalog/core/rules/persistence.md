---
id: core-persistence
title: Entity base, audit and tenant isolation
categories: [backend, fullstack]
---
# Entity base, audit and tenant isolation

Applies to every stack that persists data. The stack rules and skills hold the mechanics for the framework; this rule holds what must be true everywhere.

## Essentials

- Every persisted entity extends `{{sc:baseEntity}}`. A tenant-scoped entity extends `{{sc:baseTenantEntity}}`, which extends `{{sc:baseEntity}}` and adds the column `{{sc:tenantColumn}}`.
- Search {{sc:sharedLibraries}} and the codebase for an existing base class first. Create the base classes once, in the shared location, only when none exists. The base holds the four audit fields and no `id`: the id strategy is the project's choice.
- The framework fills `createdAt`, `createdBy`, `updatedAt`, `updatedBy`. Code never sets them by hand, and request DTOs never carry them. Times are UTC (`timestamptz`).
- `createdBy` and `updatedBy` hold the JWT `sub`. With no user (job, consumer, migration) they hold `{{sc:systemUser}}`.
- The tenant comes from the JWT claim `{{sc:tenantClaim}}`, never from a request parameter or body.
- Every query on a tenant entity is filtered by the framework mechanism (a tenant-scoped repository or the ORM's tenant filter), never by a hand-written `where` on `{{sc:tenantColumn}}`. Never use a raw repository or raw SQL on a tenant entity.
- A tenant entity touched with no tenant in context fails closed: throw where the framework allows it, otherwise return no rows. Never return unfiltered rows.
- Cross-tenant access goes through one explicit call, `runCrossTenant(reason, work)`. It runs only for roles {{sc:crossTenantRoles}} (read from the claim `{{sc:rolesClaim}}`) or for the `{{sc:systemUser}}` identity, otherwise it throws. Every use logs who and why.
- Every stack's tests include an "audit fields filled" test and a "tenant A cannot read tenant B" test.

## Where the context comes from

- **Request:** the authentication layer puts user, tenant and roles in the request context once. Persistence code reads that context and never decodes a token itself.
- **Message consumer:** messages carry the headers `x-tenant-id`, `x-user-id` and `x-request-id`. Producers always send them. The consumer sets the context from them before it handles the message.
- **Job and migration:** run as `{{sc:systemUser}}`. Work that touches a tenant entity sets the tenant explicitly for each unit of work.
- **Public endpoint:** does not read or write tenant entities, unless the project defines how to resolve a tenant. By default there is none.
- **Server-rendered code (full-stack):** read user and tenant through the one shared context helper, never from a header or a cookie directly.

## Audit

- The audit fields live only in the base class. A child entity does not redeclare them.
- A write path that bypasses the framework hook (raw SQL, bulk operations that skip entity events) must set the audit fields explicitly, and a test must prove it. Prefer a path the framework audits.
- Do not add change history here. The four fields are the whole requirement.

## Tenant isolation

- Tenant filtering is in place before a new tenant entity ships. A test pins that tenant A cannot read tenant B, and that a missing tenant does not return rows.
- Writes assign the current tenant automatically. A caller cannot choose another tenant's id.
- `runCrossTenant` is the only way to switch the filter off. Its reason is a short, human-readable string, and it is logged with the user and tenant. Do not add a second bypass.
