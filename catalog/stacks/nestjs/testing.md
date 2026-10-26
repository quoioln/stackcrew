---
id: stack-nestjs-testing
title: NestJS testing
---
# NestJS testing

Jest with `ts-jest` and `@nestjs/testing`; Postgres in Testcontainers for integration tests; supertest for e2e. Extends the core testing rule. Testcontainers and supertest are new dependencies: ask the user before adding them.

## Essentials

- Test files are `*.spec.ts`: unit and integration tests next to the source, e2e tests in `test/` as `*.e2e.spec.ts`.
- Use the narrowest test that proves the behavior: a plain unit test for logic, `Test.createTestingModule` with fakes for a provider's wiring, Postgres for persistence, supertest e2e for HTTP behavior (status, body, problem details, guards).
- Persistence runs against a real Postgres (`@testcontainers/postgresql`, `postgres:16-alpine`) with the real migrations and both subscribers. SQLite or an in-memory fake does not stand in for Postgres.
- Every tenant entity has the audit and tenant tests from `core-persistence` (section "Entity base, audit and tenant isolation").
- Never call a real third party from a test. Fake it with a local HTTP stub server (`node:http`) so the real `HttpService`, timeouts and `OutboundHttpLogger` run.
- e2e tests build the app exactly like `main.ts`: `createNestApplication({ rawBody: true })`, `setupApp(app)`, then `init()`. Tokens come from a local test issuer with its own JWKS; never disable or mock the guard.
- Mock only true boundaries (`jest.fn()` fakes of a port or client). Never mock the class under test, a DTO or TypeORM itself.
- Cover at least three negative or edge cases per happy path, and every branch of changed logic.
- Keep tests deterministic: no sleeps on fixed timers, no order dependence, no network outside the container and local stubs. Close apps, containers and servers in `afterAll`.
- Assertions name the behavior: `it('returns 404 for a profile of another tenant')`, not `it('works')`.

## Jest configuration

- Point Jest at the project's code only: `roots: ['<rootDir>/src', '<rootDir>/test']`, or `rootDir: 'src'` as the Nest CLI generates. The stackcrew skill folders (`.claude/skills/`, `.agents/skills/`) hold example `*.spec.ts` files that import paths of a real project and fail where they are. With `rootDir: '.'` and no `roots`, add `testPathIgnorePatterns: ['/node_modules/', '/\\.claude/', '/\\.agents/']`.
- `ts-jest` uses the project's `tsconfig.json` (strict, `emitDecoratorMetadata`, `experimentalDecorators`).

## Unit tests

```ts
const module = await Test.createTestingModule({
  providers: [CustomerProfilesService, { provide: CustomerProfileRepository, useValue: { findOneBy: jest.fn(), update: jest.fn() } }],
}).compile();
const service = module.get(CustomerProfilesService);
```

- Fakes implement only what the test needs; type them with `jest.Mocked<Pick<Repository, 'findOneBy'>>` rather than `any` (SC-TYPE also applies to tests).
- Run code that reads the request context inside `runWithRequestContext({ requestId: 'test', userId: 'alice', tenantId: 'tenant-a', roles: [] }, ...)`.

## Entity base, audit and tenant isolation

Skill `stackcrew-nest-typeorm-entity` ships `customer-profile.persistence.spec.ts`; copy it for every tenant entity. It starts one container per file in `beforeAll`, runs the migrations, and calls the repository inside `runWithRequestContext` (a signed-in user) or `runAsSystem` (a job). Required cases:

- `createdAt`, `createdBy`, `updatedAt`, `updatedBy` on insert, `update`, `save` of a loaded row and `softDelete`; `{{sc:systemUser}}` inside `runAsSystem`;
- tenant B cannot read, count, find by id, update, delete, soft delete or save over tenant A's row, and the row is unchanged;
- without a tenant every read and write throws `MissingTenantError`;
- a role in `CROSS_TENANT_ROLES` reads every tenant through `runCrossTenant` and cannot write; another role is denied; `runAsSystem` reads; a user or `x-user-id` named `{{sc:systemUser}}` is denied.

## e2e tests

A local issuer signs tokens with Node's crypto and serves its JWKS, so `JwtStrategy`, `jwks-rsa`, the guard and the request context all run for real:

```ts
// test/support/test-issuer.ts
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const ONE_HOUR_S = 3600;
const KID = 'test-key';
const ISSUER = 'https://issuer.test/';
const AUDIENCE = 'customer-api';

const base64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

export class TestIssuer {
  private readonly keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private readonly server: Server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [{ ...this.keys.publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }] }));
  });

  /** Starts the JWKS server and points the app's env at it. Call before the testing module is compiled. */
  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    Object.assign(process.env, { JWKS_URI: `http://127.0.0.1:${port}/jwks`, JWT_ISSUER: ISSUER, JWT_AUDIENCE: AUDIENCE });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /** A signed RS256 token; pass claims such as { sub, '{{sc:tenantClaim}}': 'tenant-a', '{{sc:rolesClaim}}': ['user'] }. */
  token(claims: Record<string, unknown>): string {
    const now = Math.floor(Date.now() / 1000);
    const head = `${base64url({ alg: 'RS256', typ: 'JWT', kid: KID })}.${base64url({ iss: ISSUER, aud: AUDIENCE, iat: now, exp: now + ONE_HOUR_S, ...claims })}`;
    return `${head}.${sign('RSA-SHA256', Buffer.from(head), this.keys.privateKey).toString('base64url')}`;
  }
}
```

```ts
// test/support/test-app.ts
import { type LoggerService } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { setupApp } from '../../src/common/logging/logging.setup';

export type LogRecord = { level: string; fields: Record<string, unknown> };

/** Keeps every structured log call; tests assert on the http_in, http_out and cross_tenant lines. */
export class CapturingLogger implements LoggerService {
  readonly records: LogRecord[] = [];
  log(message: unknown): void { this.keep('info', message); }
  warn(message: unknown): void { this.keep('warn', message); }
  error(message: unknown): void { this.keep('error', message); }
  debug(): void {}
  verbose(): void {}

  /** Lines of one event, waiting briefly: the http_in line is written after the client has the response. */
  async lines(event: string, count: number): Promise<Record<string, unknown>[]> {
    for (let attempt = 0; attempt < 50 && this.of(event).length < count; attempt++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    return this.of(event);
  }

  private of(event: string): Record<string, unknown>[] {
    return this.records.map((r) => r.fields).filter((f) => f.event === event);
  }

  private keep(level: string, message: unknown): void {
    if (typeof message === 'object' && message !== null) this.records.push({ level, fields: { ...message } });
  }
}

/** Set DATABASE_URL and start the issuer first: AppModule validates the environment when it is imported. */
export async function createTestApp(logger: CapturingLogger): Promise<NestExpressApplication> {
  const { AppModule } = await import('../../src/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  setupApp(app);
  app.useLogger(logger); // after setupApp, so the test sees every line
  await app.init();
  return app;
}
```

- `ConfigModule.forRoot({ validate })` runs when `AppModule` is imported, so `createTestApp` imports it only after `beforeAll` has set `DATABASE_URL` (from the Testcontainers database) and started the issuer. Never import `AppModule` at the top of an e2e file. The migrations run in `beforeAll` (`app.get(DataSource).runMigrations()`).
- One app per test file, created in `beforeAll` and closed in `afterAll` (`app.close()`, then the container and the issuer).
- Assert the problem details of every error path (`status`, `title`, `detail`, `errors`), never the exception message.
- Request bodies used by several tests live in constants or fixture files.

## Third-party fakes

- Start a `node:http` server on port 0 in `beforeAll`, point the provider's base URL config at it, and script its answers per test: success, 4xx, 5xx, a slow answer past the client `timeout`, and a malformed body.
- Assert the typed result or typed error of the client, how many requests reached the stub (a 4xx is not retried), and the one `http_out` line per attempt.
- Provider payloads in the stub mirror the provider's documented shapes, including its error bodies.

## Naming and structure

- `describe` names the unit; `it` states the behavior and the condition.
- Arrange-Act-Assert, one reason to fail per test. Shared setup goes in `beforeAll`/`beforeEach` and small builders, not in inheritance chains.
- Values that several tests share are constants; magic numbers and URLs are allowed inside test files (the guard and the ESLint config skip `*.spec.ts` and `test/`).
