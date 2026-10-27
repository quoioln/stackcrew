---
id: stack-nextjs-testing
title: Next.js testing
---
# Next.js testing

Vitest for unit and integration tests, Testing Library for client components, Playwright for end-to-end tests. Extends the core testing rule; the tester's procedure, with the Playwright config and sign-in setup, is the skill `stackcrew-nextjs-testing`. Use the tools the project already has; a missing one is a new dependency: ask the user before adding it.

## Essentials

- Test files are `*.spec.ts` and `*.spec.tsx` next to the source; integration tests are `*.int.spec.ts`; Playwright tests live in `e2e/` as `*.spec.ts`.
- Use the narrowest test that proves the behavior: Vitest for zod schemas, mappers, pure functions and server actions (with fake repositories), Testing Library for client components, Vitest with Postgres for persistence, Playwright for pages.
- An async Server Component cannot be rendered by Vitest or Testing Library: test what it calls (loaders, mappers) in Vitest and the page in Playwright.
- Unit specs run in the `node` environment; a component spec opts into `jsdom` on its first line. Server code is imported as it is: the Vitest config maps `'server-only'` to its empty module.
- Persistence runs against a real Postgres (the project's `vitest.int.config.ts`, the test database in Docker) with the real migrations and both subscribers. SQLite or an in-memory fake does not stand in for Postgres.
- Every tenant entity has the audit and tenant tests from `core-persistence` (section "Entity base, audit and tenant isolation").
- Never call a real third party from a test. Fake it with a local HTTP stub server (`node:http`) so `httpClient.fetch` and its `http_out` line run for real.
- Mock only true boundaries: `auth()`, `next/headers` and `next/cache` in a unit test, a repository, a provider. Never mock the action under test, the masker, zod or TypeORM; call `redirect()` and `notFound()` for real.
- Cover at least three negative or edge cases per happy path, and every branch of changed logic.
- Keep tests deterministic: no sleeps on fixed timers (wait with `vi.waitFor`), no order dependence, no network outside the database and local stubs.

## Vitest configuration

```ts
// vitest.config.ts
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fromRoot('./src'),
      // 'server-only' throws outside a React Server Components bundle; tests import server code as it is
      'server-only': fromRoot('./node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    exclude: ['src/**/*.int.spec.ts', 'node_modules/**'],
    env: loadEnv('test', process.cwd(), ''), // .env.test: src/env.ts validates every variable when it is imported
  },
});
```

```ts
// vitest.int.config.ts
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** `vitest run -c vitest.int.config.ts`: the *.int.spec.ts files against the test database of .env.test. */
export default defineConfig({
  resolve: { alias: { '@': fromRoot('./src'), 'server-only': fromRoot('./node_modules/server-only/empty.js') } },
  test: {
    environment: 'node',
    include: ['src/**/*.int.spec.ts'],
    env: loadEnv('test', process.cwd(), ''), // DATABASE_URL of a database used only by tests (Postgres in Docker)
    fileParallelism: false, // the files share one database
    testTimeout: 30_000,
  },
});
```

`.env.test` is committed and holds test values only, for every variable `src/env.ts` requires; `.env.test.local` (ignored by Git) overrides it on a machine:

```dotenv
# .env.test
AUTH_SECRET=test-only-secret-0123456789abcdef0123
DATABASE_URL=postgres://postgres@127.0.0.1:5432/app_test
AUTH_ISSUER=http://127.0.0.1:9/issuer
AUTH_CLIENT_ID=test-client
AUTH_CLIENT_SECRET=test-only-not-a-secret
CROSS_TENANT_ROLES=report_admin
```

- `DATABASE_URL` points at a database that only tests use (a throwaway local Postgres in Docker started with `POSTGRES_HOST_AUTH_METHOD=trust`, so the URL carries no password: `docker compose up -d db`, then create `app_test`). A test that clears tables must never run against a shared or production database. Unit specs never connect to it.
- `tsc --noEmit` in CI runs after `next typegen`: route handlers use `RouteContext<'...'>`, a type Next.js generates into `.next/types`.
- `tsconfig.json` has `"experimentalDecorators": true`, which Vitest's TypeScript transform reads for the entity decorators. It emits no decorator metadata: every column names its type (skill `stackcrew-next-typeorm-entity`).

## Server actions and route handlers

- Call the wrapped action directly in Vitest with `vi.mock('next/headers')`, `vi.mock('<path to src>/auth')` and `vi.mock('next/cache')` (`revalidatePath` needs the request store of Next.js); the action, its schema, the wrapper and the masker run for real. Assert the typed result of every branch (`ok`, `VALIDATION` with field errors, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`) and the one `http_in` line.
- A route handler is a function: call it with a `new NextRequest(...)` and `{ params: Promise.resolve({ id }) }`, then assert the response and the line.
- Server actions that write go to a fake repository in unit tests (`vi.fn()` on the methods the action uses, typed with `Pick<CustomerProfileRepository, 'save' | 'create'>`) and to Postgres in an integration test.
- Run code that reads the context inside `runWithRequestContext({ requestId: 'test', userId: 'alice', tenantId: 'tenant-a', roles: [] }, ...)`.

## Entity base, audit and tenant isolation

Skill `stackcrew-next-typeorm-entity` ships `customer-profile.persistence.int.spec.ts.md`; save it as `customer-profile.persistence.int.spec.ts` and copy it for every tenant entity. It opens the app's DataSource options on the test database, runs the migrations, and calls the repository inside `runWithRequestContext` (a signed-in user) or `runAsSystem` (a job). Required cases:

- `createdAt`, `createdBy`, `updatedAt`, `updatedBy` on insert, `update`, `save` of a loaded row and `softDelete`; `{{sc:systemUser}}` inside `runAsSystem`;
- tenant B cannot read, count, find by id, update, delete, soft delete or save over tenant A's row, and the row is unchanged;
- without a tenant every read and write throws `MissingTenantError`;
- a role in `CROSS_TENANT_ROLES` reads every tenant through `runCrossTenant` and cannot write; another role is denied; `runAsSystem` reads; a user or `x-user-id` named `{{sc:systemUser}}` is denied.

`src/env.ts` is validated when it is first imported, so a spec that needs a value other than the one in `.env.test` sets it in `vi.hoisted(() => { process.env.CROSS_TENANT_ROLES = 'report_admin'; })`, which runs before the imports.

## Client components

A component spec starts with `// @vitest-environment jsdom`, renders with `@testing-library/react` and finds elements by role and label, as a user would. Pass the action as a prop or `vi.mock` its module; assert what the user sees for each result (field errors, the refusal message, the disabled button while pending).

## End-to-end (Playwright)

`playwright.config.ts`, `e2e/auth.setup.ts` and `e2e/sessions.ts` ship with the skill `stackcrew-nextjs-testing`; the feature skills ship an E2E spec each.

- Playwright covers the async Server Components: loading, empty and error states, and a full form round trip. Sign in once in a setup project and reuse its `storageState`; never stub `auth()` in an E2E run.
- Seed through the app's own UI or API (a form, a route handler), never with raw SQL on tenant tables. Server modules cannot be imported into Playwright (`server-only` throws there). Give every run its own users and second tenant (`E2E_RUN_ID`) instead of cleaning up.

## Naming and structure

- `describe` names the unit; `it` states the behavior and the condition: `it('answers NOT_FOUND for a profile of another tenant')`, not `it('works')`.
- Arrange-Act-Assert, one reason to fail per test. Values that several tests share are constants; magic numbers and URLs are allowed inside test files (the guard and the ESLint config skip `*.spec.ts`).
