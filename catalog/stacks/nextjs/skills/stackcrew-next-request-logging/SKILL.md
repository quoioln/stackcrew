---
name: stackcrew-next-request-logging
description: Use when setting up or changing request and response logging in a Next.js app: the shared body masker and its LOG_* settings in the env schema, the request context (AsyncLocalStorage) with getRequestContext, runAsSystem and runCrossTenant, withActionLogging for server actions, withRouteLogging for route handlers, httpClient.fetch for outbound calls, onRequestError in instrumentation.ts, the pino logger, and their tests.
kind: task
---
# Masked request and response logging (Next.js 16)

Implements `core-logging` ("Request and response logging", "Body masker") and the request context that `core-persistence` reads: one line per server action call, route handler call and outbound call, with both bodies after one shared masker. Write the SC-PREFLIGHT note first: which of the files below, a logger, an `auth.ts`, an env schema, a fetch wrapper and an `instrumentation.ts` already exist.

## 1. Find the shared pieces before writing any

Search the codebase and the shared libraries ({{sc:sharedLibraries}}) for `maskBody`, `AsyncLocalStorage`, `runWithRequestContext`, `createEnv`, `pino(` and a wrapper around `fetch`. Extend what exists; replace a logger that writes bodies without masking. Create the missing pieces once, from the files next to this skill. Each `<file>.md` holds one source file: its first line says where the file goes, and the code block is the file's content.

| File | What it does |
|---|---|
| `env.ts.md` | `src/env.ts` (`@t3-oss/env-nextjs`): `LOG_MASK_FIELDS`, `LOG_MAX_BODY_BYTES`, `LOG_BODIES`, `LOG_LEVEL`, `CROSS_TENANT_ROLES`; `loggingEnv()`, `tenancyEnv()`; errors that name the variable, never its value. |
| `body-masker.ts.md` | The masker, the same code as in the NestJS stack: `maskBody`, `maskValue`, `serializeMasked`, `loadMaskOptions`, `loadLogBodies`, `bodyPlaceholder`, `placeholderFor`, `jsonByteLength`, `maskCapturedBody`, `CAPTURE_LIMIT_BYTES` (2 MiB). |
| `log-fields.ts.md` | Event and field names, `levelFor(status)`, and `writeCallLine`, the line writer that never throws. |
| `logger.ts.md` | The pino logger; its mixin adds the context ids to every line. |
| `request-context.ts.md` | `RequestContext`, `runWithRequestContext`, `runAsSystem`, `runCrossTenant`, `requireTenantId`, `currentActor`, `contextFromMessageHeaders`, the two errors. No Next.js import. |
| `session-context.ts.md` | `getRequestContext()`, `runInRequestContext(fn)`, `contextOfRequest` (from `auth()` and `x-request-id`), `toAuthUser(session)`. |
| `action-result.ts.md` | `ActionResult<T>`, `ActionErrorCode`, `ok()`, `fail()`, `ACTION_ERROR_STATUS`. |
| `next-control-flow.ts.md` | `nextControlFlow(error)`: recognizes `redirect()`, `notFound()` and the other Next.js throws, with their status. |
| `web-body.ts.md` | Reads a body copy up to the capture cap; size placeholders for the bodies it does not read. |
| `with-action-logging.ts.md`, `with-route-logging.ts.md` | The two inbound wrappers: the context, one `http_in` line, the outcome unchanged. |
| `http-client.ts.md` | `httpClient.fetch(target, input, init)`: one `http_out` line per call. |
| `instrumentation.ts.md`, `unhandled-error.ts.md` | `onRequestError`: one `unhandled_error` line for what escapes. |
| `body-masker.spec.ts.md`, `log-fields.spec.ts.md`, `request-context.spec.ts.md`, `env.spec.ts.md`, `with-action-logging.spec.ts.md`, `with-route-logging.spec.ts.md`, `http-client.spec.ts.md` | The tests (section 9). |

`session-context.ts` imports `auth` from `src/auth.ts` (stack rule, Authentication). The TypeORM base classes that read the context are in `stackcrew-next-typeorm-entity`.

## 2. Dependencies (ask the user before adding any)

- `pino` 9 for the logger, listed in `serverExternalPackages` (stack rule). Later 16.x releases keep it unbundled by default, but Next.js 16.0 bundles it, test files of its `thread-stream` worker included, and `next build` fails.
- `@t3-oss/env-nextjs` with `zod` 3 for `src/env.ts`; `next-auth` v5 for `auth()`; `server-only` for the server modules.
- `@opentelemetry/api` for `traceId` and `spanId` (`activeTraceFields`); it comes with the OpenTelemetry SDK. Without OpenTelemetry in the project, ask before adding it, or leave `activeTraceFields` out.
- Local text output: pipe the server through the `pino-pretty` CLI (a dev dependency): `next dev | pino-pretty`. Do not configure a pino transport: it runs in a worker thread that the Next.js server bundle does not carry.

## 3. Configuration

```bash
LOG_MASK_FIELDS=            # PII keys, comma-separated; unset or empty = DEFAULT_PII_FIELDS. Secrets are always masked.
LOG_MAX_BODY_BYTES=16384    # cap after masking
LOG_BODIES=true             # false drops reqBody and resBody, keeps the line
LOG_LEVEL=info
CROSS_TENANT_ROLES={{sc:crossTenantRolesCsv}}   # conventions.crossTenantRoles; empty = only runAsSystem jobs read across tenants
```

- `src/env.ts` validates when it is first imported, so `next build`, `next start` and every test fail on a bad value, naming only the variable. Merge the variables into the project's schema if it has one; never read `process.env` anywhere else (SC-ENV).
- `emptyStringAsUndefined` stays off: `CROSS_TENANT_ROLES=` must mean "no role", never the default list (`env.spec.ts` pins it).
- A configured `LOG_MASK_FIELDS` replaces the default PII list. Changing it never unmasks a secret key.

## 4. Wiring

Why wrappers: `proxy.ts` runs before the route and never sees the response body, and Next.js has no hook around a server action. So every server action and every route handler is wrapped, and the wrapper also sets the request context. No tool can check that an action is wrapped: the rule, this skill and review do.

```ts
// in a 'use server' file: the export name, wrapped
export const archiveCustomerProfile = withActionLogging('archiveCustomerProfile', async (id: unknown): Promise<ActionResult<{ id: string }>> => {
  const caller = await getRequestContext();
  if (caller.userId === undefined) {
    return fail(ActionErrorCode.UNAUTHENTICATED);
  }
  return typeof id === 'string' ? ok({ id }) : fail(ActionErrorCode.VALIDATION);
});
```

```ts
// in src/app/api/v1/customer-profiles/[id]/route.ts: the path template of the file, wrapped
export const GET = withRouteLogging('/api/v1/customer-profiles/[id]', async (_req: NextRequest, ctx: RouteContext<'/api/v1/customer-profiles/[id]'>) => {
  const { id } = await ctx.params;
  return NextResponse.json({ id });
});
```

- The action name is the export name; the route is the file's path template, never the requested path. Both are constants, so the log stays low-cardinality.
- Server Components are not wrapped: they are rendered, not called, and they log no body. Their data loaders run inside `runInRequestContext(fn)`, which builds the same context from `auth()` once per render. Errors escaping a render reach `onRequestError`.
- `src/instrumentation.ts` exports `onRequestError`. Next.js also builds that file for the Edge runtime; only the literal `process.env.NEXT_RUNTIME === 'nodejs'` check in it lets the build drop the Node-only logger from the Edge bundle (a helper function in `src/env.ts` does not). That one line carries the two waivers (`eslint-disable-next-line` and `stackcrew-allow: SC-ENV`): it is bootstrap code, read before any module.
- A wrapped route handler reads `auth()` and the request headers, so Next.js never prerenders it: every wrapped GET is dynamic (`ƒ` in the build output). A GET that must stay static is not wrapped and touches no user or tenant data.
- `RouteContext<'/path'>` is a type Next.js generates: run `next typegen` (or `next build`) before `tsc` in CI.
- Health and metrics route handlers are not wrapped.

## 5. The masker contract

`body-masker.ts` implements the `core-logging` table; do not write a second masker or mask by hand. It is the masker of the NestJS stack line for line, so one table holds for both.

- Keys split into words on camelCase, `_`, `-` and spaces; a key is masked when any contiguous run of its words is in the list. `newPassword`, `ACCESS_TOKEN`, `customerEmail`, `national_id` are masked; `shipping`, `spanId`, `pinned`, `typeName`, `address2` are not. Values of masked keys become `"***"`, objects and arrays included.
- A string over 1024 characters that is base64 (or a `data:` URI) becomes `<base64 N bytes>`. After masking the body is serialized compactly; above `LOG_MAX_BODY_BYTES` it keeps the first bytes (cut on a character) and appends `...[truncated T bytes]`.
- JSON (`application/json`, `*+json`) and form bodies are parsed and masked. `multipart/*`, `application/octet-stream`, `image/*`, `application/pdf` log `<binary CT N bytes>`; anything else (XML, SOAP, text, unparseable JSON, no content type) logs `<CT N bytes>`. An empty body logs no field.
- A body nested deeper than 64 objects or arrays logs `<CT N bytes>`. An already-parsed value (action arguments and results) is first normalized by a guarded JSON round-trip, so the masker sees exactly what `JSON.stringify` writes and never walks a live object graph; when `JSON.stringify` throws, the size is unknown and the field is `<CT N+ bytes>` with N = `LOG_MAX_BODY_BYTES`.
- Logging never throws. Every line goes through `writeCallLine`, which falls back to the line without bodies and turns a logger failure into a process warning. A call never fails, or changes its result, because of its log line.

## 6. Inbound: one line per call

The line: `event=http_in`, `method`, `route`, `status`, `durationMs`, `reqBody`, `resBody`, `requestId`, `userId`, `tenantId`, `traceId` and `spanId` (from the active OpenTelemetry span), and `error`. INFO for 2xx/3xx, WARN for 4xx, ERROR for 5xx.

**Server actions** (`withActionLogging`): `method` POST, `route` `action:<name>`. `reqBody` is the arguments, masked: one argument as it is, several as an array (the `(previousState, formData)` of `useActionState` included); a `FormData` becomes its fields, a file its size. `resBody` is the result. The HTTP response of an action is always 200, so `status` is the status the outcome stands for:

| Outcome | status | error | level |
|---|---|---|---|
| `{ ok: true, data }` | 200 | none | INFO |
| `fail(VALIDATION)`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` | 400, 401, 403, 404, 409 (`ACTION_ERROR_STATUS`) | the code | WARN |
| `redirect()`, `permanentRedirect()` | the digest's status (307, 308) | `NEXT_REDIRECT` | INFO |
| `notFound()`, `forbidden()`, `unauthorized()` | 404, 403, 401 | `NEXT_HTTP_ERROR_FALLBACK` | WARN |
| anything thrown | 500 | the error class | ERROR |

**Route handlers** (`withRouteLogging`): the request's method and the response's status. The response is returned at once, never held back: a JSON or form body (request or response) is read from a `clone()` while Next.js streams the original, up to 2 MiB, and the line is written when that copy is read. Streams, SSE, downloads and every other type are never copied; they log their `Content-Length` as `<CT N bytes>`, or nothing. A JSON body past 2 MiB logs `<CT N+ bytes>` and its copy is cancelled. A thrown error is a 500 line; `redirect()` and `notFound()` are logged at their status.

**Both:**

- `redirect()`, `notFound()` and the other Next.js control-flow throws are recognized by the thrown error's own `digest`, as Next.js recognizes them, and rethrown unchanged: never a 500, never swallowed, and `onRequestError` does not fire for them. A dynamic-rendering bailout while `next build` prerenders a GET handler writes no line: it is not a request. An ordinary error that carries a `notFound()` or `redirect()` error in its `cause` is a 500 for Next.js, and its line says 500.
- Every error is rethrown unchanged after its line, so Next.js renders `error.tsx` or answers 500 as before.
- The context is set with `storage.run`, so it ends with the call: concurrent requests never see each other's user, and nothing is left for the next one.
- `userId` and `tenantId` are written even when undefined, so the pino mixin cannot fill them from another context.
- Actions, components and route handlers never log bodies.

### The request context

- `getRequestContext()` is the one way server code reads who is calling: inside a wrapper, the wrapper's context; in a Server Component, the context of its request, built from `auth()` and `x-request-id` once per render (React `cache`). Never read the session cookie, a header or `auth()` for the user anywhere else.
- `x-request-id` is kept only when it is short and plain; otherwise a new UUID is used.
- `runWithRequestContext` never grants the system identity or cross-tenant reads, whatever the context object says, and refuses to replace the context of another user.
- `runAsSystem(tenantId, fn)` is the system job entry: the only way to act as `{{sc:systemUser}}` and to call `runCrossTenant` without a role. Call it from scheduled jobs, scripts and data migrations only, never from an action, a route handler or a Server Component. A session or `x-user-id` user equal to `{{sc:systemUser}}` stays an ordinary user.
- Next.js evaluates server modules once per layer (Server Components and actions, route handlers): each layer has its own copy of the context store, and a request stays in one layer.

### Errors

- `onRequestError` writes one `unhandled_error` line: the error class, its digest (the id the error page shows), `route` (the route file path), `routeType`, `method`, `requestId` and the stack frames. Never the message: it can quote input. It is written in addition to the wrapper's `http_in` line.
- Next.js itself also prints an uncaught error with its message to stderr (`⨯ RangeError: ...`): never put input, a token or PII in an error message.
- Expected refusals are typed results (`ActionResult`), not exceptions. A `CrossTenantDeniedError` becomes `NOT_FOUND` or `notFound()`, like a missing row.

## 7. Outbound: `httpClient.fetch`

```ts
// in a provider client
const response = await httpClient.fetch('kyc-provider', `${env.KYC_PROVIDER_BASE_URL}/verify`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(env.KYC_PROVIDER_TIMEOUT_MS),
});
```

- The line: `event=http_out`, `target`, `method`, `url` (scheme, host, port and path: no query string, no user info), `status`, `durationMs`, `reqBody`, `resBody`, the context ids, and `error` (the network code, such as `ECONNREFUSED`, or `TimeoutError`) when no response came. A call that failed without a response still gives one line, and the error is rethrown.
- A string body is masked as its declared content type, `URLSearchParams` as a form, a `Blob` logs its size; streams and `FormData` are not read. JSON and form replies are read from a `clone()` up to 2 MiB; every other reply logs its `Content-Length`. A reply that breaks mid-body still gives one line, with its status and `error`.
- Without a `signal`, the call is bounded by `DEFAULT_TIMEOUT_MS`. Base URLs and timeouts come from `env`. Retries, the circuit breaker and the provider pattern are not part of this skill.
- Never call `fetch` directly for another service.

## 8. Message consumers

Producers send `x-request-id`, `x-tenant-id` and `x-user-id`. A consumer builds its context with `contextFromMessageHeaders(headers)` (unsafe values count as absent), runs the handler inside `runWithRequestContext`, and writes one `message_in` line through `writeCallLine(logger, build, fallback, 'info')` with the payload in `reqBody` from `maskCapturedBody(payload, contentType, loadMaskOptions())` (over 2 MiB: `<CT N bytes>`, unparsed). It never becomes the system identity from a header.

## 9. Tests

- `body-masker.spec.ts` is the masker contract: every row of the `core-logging` table, the configured list, the character-boundary cut, form parsing, placeholders, the depth cap and the JSON round-trip. It needs no Next.js.
- `log-fields.spec.ts` pins `writeCallLine`: a failing build writes the fallback, and a failing fallback or logger becomes a process warning, never an exception.
- `request-context.spec.ts` pins the identity rules: a cross-tenant role reads (read only), other roles are denied, only `runAsSystem` is the system identity, unsafe header values are dropped, concurrent contexts stay apart.
- `env.spec.ts` pins the defaults, the number conversion, `CROSS_TENANT_ROLES=` staying empty, and errors that name the variable only.
- `with-action-logging.spec.ts` mocks only `next/headers` and `auth()`: one line per call with the masked arguments and result, typed refusals at their status, `redirect()` and `notFound()` (called for real) rethrown at their status, a thrown error as a 500 without its message, `FormData` arguments, concurrent users apart, no context left behind, a failing `auth()` and a failing logger.
- `with-route-logging.spec.ts` calls wrapped handlers with `new NextRequest(...)`: both bodies masked, the route template, errors and `notFound()`, an SSE response returned at once and never read, size-only bodies.
- `http-client.spec.ts` runs against a local `node:http` stub: masked bodies and a URL without its query string, a refused connection, a reply that breaks mid-body, size-only replies.
- Run them with `vitest run` (stack testing rule: `server-only` aliased, `.env.test` loaded). After changing a wrapper, check one real call under `next start`: one line per action and route call on stdout.

## Do not

- Do not log a body anywhere else: no `logger.info(dto)`, no body in an error message, no second masker.
- Do not log headers other than `content-type`, `content-length` and `user-agent`; never `Authorization` or cookies.
- Do not leave a server action or route handler unwrapped, and do not wrap one twice. A wrapped action that calls another wrapped action writes two lines (one per wrapper): share the logic as a plain function and wrap only the exports.
- Do not catch `redirect()` or `notFound()` without rethrowing them (`unstable_rethrow`).
- Do not set the request context with `AsyncLocalStorage.enterWith`: only `storage.run` scopes it.
- Do not log from `proxy.ts` as a substitute for the wrappers: it never sees the response.
