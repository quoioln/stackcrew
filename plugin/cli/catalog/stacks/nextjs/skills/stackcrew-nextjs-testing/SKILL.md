---
name: stackcrew-nextjs-testing
description: Use when writing or fixing tests for a Next.js app: Vitest unit tests for schemas, mappers, loaders, server actions and route handlers with only the true boundaries mocked, Testing Library for client components, persistence and action tests on Postgres, Playwright end-to-end tests for pages and forms with signed-in users, and the required audit, tenant and logging tests.
kind: testing
---
# Write tests (Next.js 16)

The stack rule `stack-nextjs-testing` is in force: the Vitest configs (`vitest.config.ts`, `vitest.int.config.ts`), `.env.test`, `*.spec.ts(x)` next to the source, `e2e/` for Playwright, and the naming rules. This skill is the tester's procedure on top of it. Pick the narrowest test that proves the behavior, and list the cases before writing any.

## 1. Before you write

- List the cases: the happy path, at least three negative or edge cases for each, and every branch of the changed logic. Name each test after its behavior and condition.
- Find what exists: specs next to the code under test, `e2e/sessions.ts`, `e2e/auth.setup.ts`, fixture builders, a provider stub. Reuse them; do not add a second harness.
- Testing Library, jsdom and Playwright may be missing: ask the user before adding them (`@testing-library/react`, `jsdom`, `@playwright/test`).

## 2. Choose the test type

| Subject | Test | How |
|---|---|---|
| A zod schema, a mapper, a pure function, the masker | unit | plain Vitest, `node` environment |
| A server action, a shared `*.service.ts` function, a loader in `data.ts` | unit | Vitest; mock only the session, `next/headers`, `next/cache` and the repository |
| A route handler | unit | Vitest; call the exported function with `new NextRequest(...)` |
| A client component (a form, a table) | component | Testing Library, `// @vitest-environment jsdom`; mock the action module |
| An entity, its migration, the subscribers, a repository method, a unique rule | integration | `vitest.int.config.ts`, Postgres in Docker, the real migrations |
| An action end to end on the database (concurrency, constraints) | integration | the wrapped action on Postgres, session mocked |
| An async Server Component page: loading, empty, error states; a form round trip | E2E | Playwright against `next start`, signed-in users |
| An outbound provider client | unit | a local `node:http` stub, `httpClient.fetch` for real |

## 3. Unit tests (Vitest)

- Mock only the true boundaries, at the top of the file: `vi.mock('next/headers', () => ({ headers: vi.fn() }))` and `vi.mock('<path to src>/auth', () => ({ auth: vi.fn() }))` for the caller, `vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))` because `revalidatePath` and `revalidateTag` need Next.js's request store, and the feature's repository module (`kycRegistrations: vi.fn()`) returning a fake with the methods the code uses, typed `vi.fn<KycRegistrationRepository['create']>()`.
- Never mock the action, the wrapper, the shared function, the schema, the mapper, the masker or the request context: they are what the test proves. Call `redirect()` and `notFound()` for real.
- Sign a user in by the mocked `auth()` (`{ user: { id, tenantId, roles } }`) and the headers (`x-request-id`); `null` is no session.
- Assert the typed result of every branch: `ok` with exactly the DTO keys, `VALIDATION` with field errors, `UNAUTHENTICATED`, `FORBIDDEN` (before any repository call), `NOT_FOUND`, `CONFLICT`; and the arguments the repository got (the applicant from the session, `take`/`skip`, the order).
- Assert the log line through `vi.spyOn(logger, level)`: exactly one `http_in` line per call, its status and `error`, and the PII masked (`"idNumber":"***"`). A route handler's line is written after its bodies are read: `await vi.waitFor(...)`.
- Code that reads the context outside a wrapper runs inside `runWithRequestContext({ requestId: 'test', userId: 'alice', tenantId: 'tenant-a', roles: [] }, ...)`.
- Clear mocks in `beforeEach` (`vi.clearAllMocks()`) so call counts never leak between tests.
- Examples: `actions.spec.ts` (`stackcrew-next-server-action`), `data.spec.ts` (`stackcrew-next-feature-page`), `route.spec.ts` (`stackcrew-next-route-handler`), the wrapper specs of `stackcrew-next-request-logging`.

## 4. Client components (Testing Library)

- First line `// @vitest-environment jsdom`; `cleanup()` in `afterEach` (Vitest has no globals for Testing Library's automatic cleanup).
- Find elements as a user does: `getByLabelText`, `getByRole('button', { name })`, `findByRole('alert')`; never by class or test id when a role or label exists. Text comes from the feature's catalog, so tests read it from there.
- Mock the action module (`vi.mock('../actions', () => ({ registerKyc: vi.fn() }))`) and cover each result: schema errors without calling the action, pending (button disabled; resolve a promise you hold), success, server field errors, the refusal text, and constant text when the action throws.
- Assert with plain matchers (`textContent`, `getAttribute('aria-invalid')`, `disabled`); add `@testing-library/jest-dom` only if the project has it.

## 5. Integration (Postgres)

- `vitest run -c vitest.int.config.ts`, `*.int.spec.ts`, against the test database of `.env.test` (Postgres in Docker). Never SQLite or an in-memory fake.
- Every tenant entity has the audit and tenant tests of `customer-profile.persistence.int.spec.ts` (`stackcrew-next-typeorm-entity`): the four audit fields, `{{sc:systemUser}}` inside `runAsSystem`, tenant B cannot read or change tenant A's rows (also through `withManager`), no tenant throws `MissingTenantError`, cross-tenant reads only for `CROSS_TENANT_ROLES` and `runAsSystem`.
- A rule the database enforces (a unique constraint, a concurrent submit) is proven here, with the real action: `kyc-registration.int.spec.ts` runs two submits at once and expects exactly one to pass.
- Read rows for assertions through the repository inside `runAsSystem(undefined, () => runCrossTenant(reason, ...))`, never raw SQL on a tenant table. Clear the tables the spec writes in `beforeEach`.

## 6. End to end (Playwright)

- `playwright.config.ts` (sibling) starts `next start` on a production build with the test environment (`.env.test`, the test database with its migrations) and runs a `setup` project first.
- Sign-in: `e2e/auth.setup.ts` (sibling) signs each E2E user's session the way next-auth does after a login (`encode` from `next-auth/jwt` with the test `AUTH_SECRET`) and saves the `storageState`; the app's own `auth()` decodes it on every request, and the setup checks `/api/auth/session` first. Tests pick a user with `test.use({ storageState: sessionFile('reviewer') })`. When the identity provider has a test realm the team can script, a setup that logs in through its page is the alternative. Never stub `auth()` or the middleware in an E2E run, and never use a real secret.
- `e2e/sessions.ts` (sibling) gives every run its own users and second tenant (`E2E_RUN_ID`), so tests need no cleanup and never depend on order. Seed through the app's own UI or API (the form, a route), never with raw SQL on tenant tables.
- Cover, for a page: the data of the caller's tenant, another tenant's empty state, a refusal for another role, the redirect to sign in without a session. For a form: the browser-side schema errors, then a valid submit to its success state.
- Loading and error states of an async Server Component show only in a real run: hold or stop the test database (or a delay in a test-only build) to see `loading.tsx`, `error.tsx` and its "Try again".
- Use web-first assertions (`await expect(locator).toBeVisible()`); never `waitForTimeout`. Next.js renders a route announcer with `role="alert"` on every page: filter alerts by their text (`getByRole('alert').filter({ hasText })`).

## 7. Logging tests

- A body with `password`, `fullName`, `idNumber` or a card number appears as `"***"` in the line and unchanged for the action, the handler or the client.
- One `http_in` line per action or route call, also for a refusal (its status: 400, 401, 403, 404, 409) and a thrown error (500 with the class, never the message).
- Placeholders for a binary or XML body and a body over the cap, as in the `core-logging` table (`body-masker.spec.ts`).

## 8. Before you finish

- Run, and report the real result (the command and the pass and fail counts): `vitest run`, `vitest run -c vitest.int.config.ts`, `next typegen` then `tsc --noEmit` (`PageProps` and `RouteContext` are generated types), ESLint, and `playwright test` after `next build`. Run the whole suite, not only the new file.
- Every test closes what it opened (`dataSource.destroy()`, stub servers, browser contexts) and does not depend on order or the time of day.
- Each assertion checks behavior; a test whose only check is `toBeDefined()` proves nothing.

## Do not

- Never call a real provider, identity provider or shared database from a test: local stubs, the test database and the E2E sessions only.
- Do not mock the code under test, the logging wrappers, the masker, zod or TypeORM; do not stub `auth()` in Playwright.
- Do not render an async Server Component in Vitest; test its loader there and the page in Playwright.
- Do not clean or seed tenant tables with raw SQL.
- Do not claim the tests pass without running them.
