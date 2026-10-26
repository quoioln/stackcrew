---
name: stackcrew-nest-rest-endpoint
description: Use when adding or changing a REST endpoint in a NestJS service, such as a customer profile API: the controller, request and query DTOs with class-validator, response DTOs with @Expose and @ApiProperty and their mapper, a service on TenantScopedRepository, pagination, RFC 7807 errors, and the unit and e2e tests.
kind: task
---
# Add a REST endpoint (NestJS 10)

Follow these steps in order. Write the SC-PREFLIGHT note first: the feature module, controller, service, DTOs, mapper and error classes that already exist and that you will reuse; whether the entity is tenant-scoped (then its `TenantScopedRepository` subclass exists or comes from `stackcrew-nest-typeorm-entity`); and the existing page DTO and path constants. Extend what exists; never add a second mapper, error format or page shape.

The example is a customer profile API: create, read by id, list a page. The request context, the logging middleware and `AllExceptionsFilter` come from `stackcrew-nest-request-logging`; the entity, its repository and its migration from `stackcrew-nest-typeorm-entity`. Set those up first.

## 1. Files

Each `<file>.md` next to this skill holds one source file: its first line says where the file goes, and the code block is the file's content.

| File | What it does |
|---|---|
| `create-customer-profile.request.ts.md` | Request DTO: class-validator rules; the client cannot send the status, the tenant or an audit field. |
| `list-customer-profiles.query.ts.md` | Query DTO: `page`, `size` (capped), a filter, and an allowlisted sort key and direction. |
| `customer-profile.response.ts.md` | Response DTO: `@Expose()` and `@ApiProperty()` on every field. |
| `customer-profile-page.response.ts.md` | One page: `items`, `page`, `size`, `total`. |
| `customer-profile.mapper.ts.md` | Entity to response DTO, and rows to a page, with `plainToInstance`. |
| `customer-profile.errors.ts.md` | `CustomerProfileNotFound`, a `ProblemError` with a constant detail. |
| `customer-profiles.service.ts.md` | The rules, on `CustomerProfileRepository`; returns DTOs. |
| `customer-profiles.controller.ts.md` | Thin controller: one service call per handler. |
| `customer-profiles.module.ts.md` | The feature module; it exports only the service. |
| `customer-profiles.service.spec.ts.md` | Unit tests with a fake repository. |
| `customer-profiles.e2e.spec.ts.md` | e2e tests over HTTP: Postgres, the real guard, the real filter. |

Add the module to `AppModule` `imports`. Shared types of the feature go in `dto/`, `interfaces/` or `*.types.ts`, never in the service file (SC-TYPEFILE).

## 2. Request and query DTOs

- One class per request, with class-validator decorators on every field, in `dto/`. The global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) rejects unknown fields with 400 and builds the class instance.
- Never accept `{{sc:tenantColumn}}`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt` or a server-owned state from a client. The tenant comes from the token; the subscribers write the rest.
- Lengths come from the entity's constants (`REFERENCE_LENGTH`), so the DTO and the column agree.
- Query values are strings. The pipe has no implicit conversion, so a number needs `@Type(() => Number)` before `@IsInt()`; without it `?size=10` fails validation. A missing value keeps the field's default.
- Nested objects need `@ValidateNested()` and `@Type(() => Child)`; arrays `@IsArray()` and `each: true`.
- Import a DTO used in a controller signature as a value, not with `import type`: the `ValidationPipe` reads the class from the decorator metadata, and a type-only import turns validation off for that parameter.
- Validation messages name the rule, never the value: do not put `$value` in a message.

## 3. Response DTOs and the mapper

- The response DTO has `@Expose()` and `@ApiProperty()` on every field and nothing else: no `static from`, no logic. It is the API contract, separate from the entity and from the request DTO.
- The mapper builds it: `plainToInstance(CustomerProfileResponse, entity, { excludeExtraneousValues: true })` copies only the `@Expose()` fields, so `{{sc:tenantColumn}}`, the audit fields, `deletedAt` and any column added later never reach a client. Reuse an existing mapper; one mapping per entity and API shape.
- `ClassSerializerInterceptor` with `@Exclude()` is not a substitute: one forgotten `@Exclude()` leaks a field.
- A date field is a `Date` in the DTO; JSON writes it as an ISO 8601 UTC string.

## 4. Service

- Inject the entity's `TenantScopedRepository` subclass (`CustomerProfileRepository`), never `Repository<T>`, `EntityManager` or a QueryBuilder for a tenant entity. Every read and write then carries the caller's tenant, and a lookup by id of another tenant's row returns `null`, which becomes 404: a caller cannot tell "another tenant's" from "missing".
- The service returns response DTOs (through the mapper). Entities never leave it.
- Throw domain errors (`ProblemError` subclasses with a status and a constant detail), not `HttpException` with free text.
- Several writes that must succeed together run in `dataSource.transaction(...)` with `withManager(manager)` (`stackcrew-nest-typeorm-entity`). Never call another service over HTTP inside a transaction.
- Services log events with ids (`this.logger.log({ event, profileId }, event)`), never a DTO, an entity or a body. Bodies are logged once, masked, by the `http_in` line.

## 5. Controller

- Each handler maps HTTP to one service call and returns its DTO: the return type is `Promise<XResponse>`, never an entity. No repository, no business rule, no `@Res()` unless streaming.
- Versioned paths (`v1/...`) and parameter names are constants. Validate path ids with `ParseUUIDPipe` (or the pipe that matches the id type).
- `@ApiOkResponse({ type })` and `@ApiCreatedResponse({ type })` name the response DTO for Swagger.
- `POST` answers 201; a delete or an action without a body answers 204 (`@HttpCode(HttpStatus.NO_CONTENT)`).
- Public routes are marked `@Public()` and touch no tenant entity. Authorization by role reads `AuthUser.roles` in a guard on the route; object-level checks (ownership) go through the repository, never only the role.

## 6. Pagination

- Every list takes `page` and `size` with a default and a maximum (`MAX_PAGE`, `MAX_PAGE_SIZE`), and returns a page DTO with `items` and `total`. Never return an unbounded list.
- Sort only by an allowlist of keys mapped to columns in code, never a column name from the request, and add the id as the last sort key so the order is stable and pages never overlap.
- `find` with `skip`/`take` plus `count` with the same `where`, both through the tenant repository. For deep pages on large tables use keyset pagination (`where: { createdAt: LessThan(cursor) }`) instead of a large `skip`.

## 7. Errors (RFC 7807)

`AllExceptionsFilter` answers every error with `application/problem+json`: `type`, `title`, `status` and a constant `detail`, never an exception message.

- Validation errors: 400 with `errors: [{ field, messages }]`.
- A `ProblemError` subclass: its status and detail (`CustomerProfileNotFound`: 404).
- A missing or invalid token: 401. A guard refusal: 403. A bad UUID from `ParseUUIDPipe`: 400. `CrossTenantDeniedError`: 404.
- Choose the status by meaning: 404 missing, 409 a conflict such as a duplicate reference (with a unique index), 422 a business rule the request breaks, 502/503 a provider failure (`stackcrew-nest-outbound-client`).
- Never return `{ error: string }`, a stack trace or a provider message.

## 8. Idempotency and safety

- A non-idempotent `POST` that creates a resource or moves money takes an `Idempotency-Key` header (a constant name). Store the key with the result in the same transaction as the write (a unique key per tenant), and answer a repeat with the stored result instead of writing twice.
- Rate limits and body size limits apply at the edge; keep the body parser limit small for JSON APIs.
- Never log or return a secret; the masked `http_in` line is the only place a body is logged.

## 9. Tests

`stackcrew-nestjs-testing` has the full picture; for an endpoint write both:

- **Unit** (`customer-profiles.service.spec.ts`): `Test.createTestingModule` with the service and a fake repository typed `jest.Mocked<Pick<CustomerProfileRepository, ...>>`. Cover the DTO keys (no tenant or audit field), not found, paging math and the order, the sort allowlist and the create defaults.
- **e2e** (`test/customer-profiles.e2e.spec.ts`): the harness from `stack-nestjs-testing` (`createTestApp`, `TestIssuer`, `CapturingLogger`) with Postgres in Testcontainers and supertest. supertest and Testcontainers are new dependencies: ask the user before adding them. Cover:
  - 201 with exactly the response DTO keys;
  - 200 for the owner tenant, 404 problem details for another tenant;
  - a page of the caller's tenant only, with `total`, and the next page;
  - 400 with field errors for a missing field, an unknown field such as `{{sc:tenantColumn}}`, a page or page size over its cap, a sort key outside the allowlist, a non-numeric size and a bad UUID;
  - 401 without a token;
  - one `http_in` line per call with the PII masked in `reqBody` and `resBody`.

## Do not

- Do not return an entity, a repository result or a `Promise<Entity>` from a controller, and do not reuse one DTO for request and response.
- Do not accept the tenant, audit fields or a server-owned state from a request, a path or a header.
- Do not validate with `if` chains in a controller; use class-validator on the DTO.
- Do not query a tenant entity without its `TenantScopedRepository`, and do not write a `where` on `{{sc:tenantColumn}}` by hand.
- Do not hardcode paths, header names or status strings in handlers; use constants.
- Do not add a second error format; throw a `ProblemError` subclass.
- Do not log a DTO, an entity or a body in a controller or a service.
