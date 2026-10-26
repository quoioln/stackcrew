---
name: stackcrew-nestjs-testing
description: Use when writing or fixing tests for a NestJS service: Jest unit tests with @nestjs/testing, persistence tests on Postgres in Testcontainers, supertest e2e tests through the real guard and exception filter, local fakes for third-party providers and the message broker, and the required audit, tenant, identity and logging tests.
kind: testing
---
# Write tests (NestJS 10)

The stack rule `stack-nestjs-testing` is in force: Jest with `ts-jest`, the Jest roots, the e2e harness (`TestIssuer`, `CapturingLogger`, `createTestApp`) and the naming rules. This skill is the tester's procedure on top of it. Pick the narrowest test that proves the behavior, and list the cases before writing any.

## 1. Before you write

- List the cases: the happy path, at least three negative or edge cases for each, and every branch of the changed logic. Name each test after its behavior and condition.
- Find what exists: `test/support/`, the specs next to the code under test, fixture builders, a provider stub. Reuse them; do not add a second harness.
- Testcontainers (`@testcontainers/postgresql`, `@testcontainers/rabbitmq`) and supertest are new dependencies: ask the user before adding them.

## 2. Choose the test type

| Subject | Test | How |
|---|---|---|
| Pure logic: a mapper, the codec, the masker, a policy | unit | plain Jest, no Nest |
| A service and its ports | unit | `Test.createTestingModule` with fakes of the ports |
| An entity, its migration, the subscribers, a repository method | integration | Postgres in Testcontainers, the real migrations |
| An endpoint: status, body, problem details, guards, validation | e2e | `createTestApp` and supertest, real token issuer |
| A provider client | integration | a local `node:http` stub, the real `HttpService` |
| A message consumer | e2e | RabbitMQ and Postgres in Testcontainers |

## 3. Unit tests

- `Test.createTestingModule({ providers: [Service, { provide: Port, useValue: fake }] })`. Type fakes as `jest.Mocked<Pick<Port, 'method'>>`; never `any` (SC-TYPE also applies to tests).
- Fake only true boundaries: a repository, a provider port, a publisher. Never mock the class under test, a DTO or TypeORM itself.
- Code that reads the request context runs inside `runWithRequestContext({ requestId: 'test', userId: 'alice', tenantId: 'tenant-a', roles: [] }, ...)`.
- Assert results and the calls that matter (arguments of the repository call, the page math), not every call.
- Example: `customer-profiles.service.spec.ts` in `stackcrew-nest-rest-endpoint`.

## 4. Persistence: the required audit and tenant tests

Every tenant entity has the tests of `customer-profile.persistence.spec.ts` (`stackcrew-nest-typeorm-entity`), on Postgres with the real migration and both subscribers:

- `createdAt`, `createdBy`, `updatedAt`, `updatedBy` on insert, `update`, `save` of a loaded row and `softDelete`; `{{sc:systemUser}}` inside `runAsSystem`;
- tenant B cannot read, count, find by id, update, delete, soft delete or save over tenant A's row, and the row is unchanged afterwards;
- without a tenant, every read and write throws `MissingTenantError`;
- a role in `CROSS_TENANT_ROLES` reads every tenant through `runCrossTenant` and cannot write; another role is denied; `runAsSystem` reads; a token user or `x-user-id` named `{{sc:systemUser}}` is denied;
- inside a transaction, `withManager(manager)` keeps the tenant condition, and a rollback undoes the write.

After `runMigrations()`, `dataSource.driver.createSchemaBuilder().log()` returns no queries: the migration matches the entities.

## 5. e2e over HTTP

- Build the app with `createTestApp(logger)` after `DATABASE_URL` is set and the `TestIssuer` started; tokens carry `sub`, `{{sc:tenantClaim}}` and `{{sc:rolesClaim}}`. Never disable or mock the guard.
- `AppModule` validates every env section at import. Give the sections a spec does not exercise safe values in a Jest `setupFiles` module (`process.env.X ??= ...`: local addresses that refuse connections, dummy keys, never a real endpoint); the spec that needs one sets it in `beforeAll` (the consumer e2e sets `RABBITMQ_URL` to its container).
- Use supertest on `app.getHttpServer()`: `request(server).post(path).set('authorization', bearer).send(body).expect(201)`.
- Assert the exact response keys (`Object.keys(body).sort()`): no `{{sc:tenantColumn}}`, audit field or `deletedAt` reaches a client.
- Assert problem details for every error path: `type`, `title`, `status`, `detail` and `errors`, never an exception message. Cover 400 (body, query, path), 401 without a token, 403 from a role guard, 404 for another tenant's id.
- Logging: exactly one `http_in` line per request, with PII and secrets masked in `reqBody` and `resBody`. The line is written after the client has the response: wait for it.

## 6. Third-party providers: local fakes only

- Start a `node:http` server on port 0, point the provider base URL at it, and script one reply per request: success, 4xx, 5xx, 429, a slow reply past the client timeout, a body that is not JSON, a missing field.
- Assert the typed result or typed error, the number of requests that reached the stub (a 4xx is not retried; a 5xx is retried up to the limit), the same idempotency key on each attempt, and one `http_out` line per attempt with masked bodies.
- Shorten timeouts and backoff through config and the policy token (`overrideProvider`), never by changing production defaults. Example: `acme-kyc.client.spec.ts` in `stackcrew-nest-outbound-client`.
- Code that calls a provider port gets a fake port. Never call the real provider, even a sandbox, in the default test run.

## 7. Message consumers

With the rabbitmq add-on, follow `kyc-completed.consumer.e2e.spec.ts` in `stackcrew-nest-rabbitmq-consumer`: RabbitMQ and Postgres in Testcontainers, the real consumer.

- Publish raw bytes with the headers you need (`x-request-id`, `x-tenant-id`, `x-user-id`), as any producer could.
- Cover: applied once in the header's tenant as the header's user; a duplicate applied once; a poison message, a tombstone and a schema violation parked after one delivery; `x-user-id: {{sc:systemUser}}` cannot cross tenants; no tenant header is parked; a transient failure retried, then parked after the attempt cap.
- One `message_in` line per delivery with the payload masked.
- Poll with a deadline for outcome lines or rows; never sleep a fixed time.

## 8. Logging tests

- A body with `password`, `email` or a card number appears as `"***"` in the line and unchanged for the client or the handler.
- Placeholders for a binary or XML body, a body over the cap and an empty body (no field), as in the `core-logging` table.
- The request context in the line: `requestId`, `userId`, `tenantId`; none from another request under concurrency.

## 9. Before you finish

- Run the tests and report the real result: the command and the pass and fail counts. Run the whole suite, not only the new file, and `tsc --noEmit`.
- Every test closes what it opened (`app.close()`, containers, stub servers) in `afterAll`, and does not depend on order or time of day.
- Each assertion checks behavior; a test whose only check is `toBeDefined()` proves nothing.

## Do not

- Do not call a real provider, broker or database outside Testcontainers and local stubs.
- Do not use SQLite or an in-memory fake in place of Postgres, or an embedded fake in place of RabbitMQ.
- Do not mock the guard, the `ValidationPipe`, `AllExceptionsFilter` or the request context in e2e tests.
- Do not import `AppModule` at the top of an e2e file: its env validation runs on import.
- Do not claim the tests pass without running them.
