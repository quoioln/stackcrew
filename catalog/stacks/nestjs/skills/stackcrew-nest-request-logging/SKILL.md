---
name: stackcrew-nest-request-logging
description: Use when setting up or changing HTTP request and response logging in a NestJS service: the shared body masker and its LOG_* settings, the request context (AsyncLocalStorage) with runAsSystem and runCrossTenant, the inbound logging middleware, the RFC 7807 exception filter, the HttpService logger for outbound calls, message consumer lines, and their tests.
kind: task
---
# Masked request and response logging (NestJS 10)

Implements `core-logging` ("Request and response logging", "Body masker") and the request context that `core-persistence` reads: one line per HTTP call, inbound and outbound, with both bodies after one shared masker. Write the SC-PREFLIGHT note first: which of the files below, a request-id or context middleware, an exception filter and an axios interceptor that logs already exist.

## 1. Find the shared pieces before writing any

Search the codebase and the shared libraries ({{sc:sharedLibraries}}) for `maskBody`, `AsyncLocalStorage`, `runWithRequestContext`, an `@Catch()` filter and `axiosRef.interceptors`. Extend what exists; replace a logger that writes bodies without masking. Create the missing pieces once, from the files next to this skill. Each `<file>.md` holds one source file: its first line says where the file goes, and the code block is the file's content.

| File | What it does |
|---|---|
| `env.ts.md` | `LOG_MASK_FIELDS`, `LOG_MAX_BODY_BYTES`, `LOG_BODIES`, `LOG_LEVEL`, `CROSS_TENANT_ROLES`, the JWKS settings; `validateEnv` for `ConfigModule`, lazy `loggingEnv()` and `tenancyEnv()` for code outside the injector. |
| `body-masker.ts.md` | The masker: `maskBody`, `maskValue`, `serializeMasked`, `loadMaskOptions`, `loadLogBodies`, `bodyPlaceholder`, `placeholderFor`, `jsonByteLength`, `maskCapturedBody` and `CAPTURE_LIMIT_BYTES` (2 MiB). |
| `request-context.ts.md` | `RequestContext`, `runWithRequestContext`, `runAsSystem`, `runCrossTenant`, `requireTenantId`, `currentActor`, `contextFromMessageHeaders`, the two errors. |
| `request-context.interceptor.ts.md` | Global interceptor: the handler runs inside the request's context. |
| `log-fields.ts.md` | Event and field names, `levelFor(status)`, and `writeCallLine`, the line writer that never throws. |
| `http-logging.middleware.ts.md`, `route-template.guard.ts.md` | One `http_in` line per request, written when the response finishes; the first global guard records the route template for it. |
| `problem-details.ts.md`, `all-exceptions.filter.ts.md` | RFC 7807 responses with constant details; `ProblemError` for domain errors. |
| `outbound-http-logger.ts.md` | `OutboundHttpLogger`: one `http_out` line per call on a module's `HttpService`. |
| `logging.setup.ts.md`, `common.module.ts.md` | `pinoHttpOptions`, `setupApp(app)`, and the module that registers it all. |
| `body-masker.spec.ts.md`, `log-fields.spec.ts.md`, `request-context.spec.ts.md`, `env.spec.ts.md`, `outbound-http-logger.spec.ts.md` | The masker contract, the line writer, the identity rules, the env parsing and the outbound line (section 9). |

`common.module.ts` imports the authentication pieces from the stack rule (`src/common/auth/`). The TypeORM base classes that read the context are in `stackcrew-nest-typeorm-entity`.

## 2. Dependencies (ask the user before adding any)

- `nestjs-pino` **4.x** with `pino` and `pino-http`: the logger. Nest's built-in JSON logger needs Nest 11, and `nestjs-pino` 5 needs Nest 11 too.
- `@nestjs/axios` 3.x and `axios` `^1.16.0` for outbound calls. From 1.16.0, axios attaches the 2xx `response` to the error of a reply whose body breaks mid-read, which `stackcrew-nest-outbound-client` retries as a transport failure. Older 1.x versions report that error without a status, so the reply would be refused as a protocol error and not retried.
- `jwks-rsa` for the JWKS keys (stack rule, Authentication).
- `@opentelemetry/api` for `traceId` and `spanId` (`activeTraceFields`); it comes with the OpenTelemetry SDK. Without OpenTelemetry in the project, ask before adding it, or leave `activeTraceFields` out.
- Local text output: `pino-pretty` as a dev dependency with `transport: { target: 'pino-pretty' }` in `pinoHttpOptions`, only when a local flag is set. JSON everywhere else.

## 3. Configuration

```bash
LOG_MASK_FIELDS=            # PII keys, comma-separated; unset or empty = DEFAULT_PII_FIELDS. Secrets are always masked.
LOG_MAX_BODY_BYTES=16384    # cap after masking
LOG_BODIES=true             # false drops reqBody and resBody, keeps the line
CROSS_TENANT_ROLES={{sc:crossTenantRolesCsv}}   # conventions.crossTenantRoles; empty = only runAsSystem jobs read across tenants
```

- `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` fails the boot on a bad value and names only the variable, never its value.
- `loggingEnv()` and `tenancyEnv()` read `process.env` on first use, after `ConfigModule` has loaded `.env`. Never call them at import time.
- A configured `LOG_MASK_FIELDS` replaces the default PII list. Changing it never unmasks a secret key.

## 4. Wiring

`AppModule` imports `CommonModule` (`common.module.ts`): config, `LoggerModule.forRootAsync` with `pinoHttpOptions`, `RouteTemplateGuard` and then the JWT guard (global guards run in the order listed), `RequestContextInterceptor`, `AllExceptionsFilter` and the `ValidationPipe`, all as `APP_*` providers so e2e tests get them too.

```ts
// src/main.ts
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { setupApp } from './common/logging/logging.setup';
import type { ServerEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  setupApp(app); // before enableCors() and listen(): the logging middleware runs first
  app.enableShutdownHooks();
  await app.listen(app.get(ConfigService<ServerEnv, true>).get('PORT', { infer: true }));
}
void bootstrap();
```

- `rawBody: true` keeps the bytes of JSON and form request bodies, which Nest's two body parsers read anyway. Nothing else is buffered for logging.
- `setupApp` registers the middleware with `app.use()`. Before `init()` that puts it ahead of the body parsers that `init()` adds, so a malformed JSON body still gets its line. Call `app.enableCors()` after `setupApp`. If the app uses `compression`, register it before `setupApp` so the line sees the uncompressed body.
- `pinoHttpOptions` turns pino-http's own request lines off (`autoLogging: false`; they would be a second line), keeps the request object and its headers off every line (`quietReqLogger`), and adds `requestId`, `userId`, `tenantId`, `traceId` and `spanId` from the request context and the active OpenTelemetry span to every line (`mixin`).

## 5. The masker contract

`body-masker.ts` implements the `core-logging` table; do not write a second masker or mask by hand.

- Keys split into words on camelCase, `_`, `-` and spaces; a key is masked when any contiguous run of its words is in the list. `newPassword`, `ACCESS_TOKEN`, `customerEmail`, `national_id` are masked; `shipping`, `spanId`, `pinned`, `typeName`, `address2` are not. Values of masked keys become `"***"`, objects and arrays included.
- A string over 1024 characters that is base64 (or a `data:` URI) becomes `<base64 N bytes>`.
- After masking the body is serialized compactly; above `LOG_MAX_BODY_BYTES` it keeps the first bytes (cut on a character) and appends `...[truncated T bytes]`.
- JSON (`application/json`, `*+json`) and form bodies are parsed and masked. `multipart/*`, `application/octet-stream`, `image/*`, `application/pdf` log `<binary CT N bytes>`; anything else (XML, SOAP, text, unparseable JSON, no content type) logs `<CT N bytes>`. CT is the media type without parameters, `unknown` when missing. An empty body logs no field.
- A body nested deeper than 64 objects or arrays logs `<CT N bytes>`: the walk stops at depth 64, so a crafted 10 KB body of brackets cannot exhaust the stack.
- `maskBody(raw, contentType, opts)` is for bytes and strings; `serializeMasked(value, opts, contentType)` for a body that is already parsed. Never call `maskValue` on a string you have not parsed as JSON.
- An already-parsed value is first normalized by a guarded JSON round-trip, so the masker sees exactly what `JSON.stringify` would write: `toJSON` applied once per value, functions dropped, Array subclasses, boxed primitives, Maps, Buffers and typed arrays reduced to plain arrays, objects and primitives. The masker never walks a live object graph, and the masked copy is plain data, so serializing it later runs no user code: no `toJSON`, getter, class or Array subclass of the original can reach the line. When `JSON.stringify` throws (a cycle, a BigInt, a getter or `toJSON` that throws, nesting that overflows the stack) the size is unknown and the body logs `<CT N+ bytes>` with N = `LOG_MAX_BODY_BYTES`; a value nested deeper than 64 logs `<CT N bytes>` with its exact size (`placeholderFor`). Normalizing costs one `JSON.stringify` of the value, the same the application pays to send or store it.
- Logging never throws. The masker returns a placeholder on any failure. Every line is written through `writeCallLine`, which falls back to the same line with size-only bodies and turns a logger failure into a process warning. A request, an outbound call or a message never fails, or changes its result, because of its log line.

## 6. Inbound: one line per request

The line: `event=http_in`, `method`, `route` (the Express route template, such as `/v1/customer-profiles/:id`, recorded by `RouteTemplateGuard`; `UNMATCHED` when no handler matched), `status`, `durationMs`, `reqBody`, `resBody`, `requestId`, `userId`, `tenantId`, `traceId` and `spanId` (the server span of OpenTelemetry's HTTP instrumentation, when there is one), and `error` with the exception class when the filter handled one. When the client closes the connection first, the line has `status` 499 and `error` `ClientAbort`. INFO for 2xx/3xx, WARN for 4xx, ERROR for 5xx.

- Every request gets exactly one line, written when the response finishes or the connection closes: success, 401 for a missing or invalid token, 403 from a guard, 404 for an unknown route, 400 from the `ValidationPipe` or a malformed body, 413 for a body over the parser limit, 500. Only `SKIPPED_PATHS` (`/health`, `/metrics` and the paths below them) are skipped; `/health-records` is logged. They are matched against `req.path`, which includes a global prefix: with `app.setGlobalPrefix('api')` call `setupApp(app, ['/api/health', '/api/metrics'])`.
- `userId` and `tenantId` are read from the request when the line is written, so a 403 after authentication carries them and a 401 does not. They are set even when undefined, so the pino mixin cannot fill them from another context.
- The response is never held back. Every byte goes straight to the client. A JSON, `*+json` or form body that `res.json`/`res.send` writes in one piece (up to 2 MiB) is kept by reference and masked. Streams, `StreamableFile`, SSE and downloads are only counted and log `<CT N bytes>`.
- Request bodies: JSON and form bodies are masked from `req.rawBody` (up to 2 MiB). Other types, and bodies the parser rejected, log `<CT N bytes>` from `Content-Length`.
- A caller's `x-request-id` is kept only when it is short and plain (`safeRequestIdOrNew`); otherwise a new UUID is used.
- Controllers, services and guards never log bodies.

### The request context

- `httpLoggingMiddleware` binds `{ requestId }` to the request. `JwtStrategy.validate` (stack rule) binds the user, `{{sc:tenantClaim}}` and `{{sc:rolesClaim}}` with `bindAuthenticatedUser`. It does not use AsyncLocalStorage there, because callbacks inside passport and jwks-rsa can run in another request's async context.
- `RequestContextInterceptor` then runs the pipes, the handler and everything they await inside `runWithRequestContext`. Persistence, `runCrossTenant` and the log mixin read it with `currentContext()`; nothing reads the token again. It subscribes to the handler inside the context, so it works on every NestJS 10 release, including those before 10.0.4, which lack Nest's own async-context binding.
- `runWithRequestContext` never grants the system identity or cross-tenant reads, whatever the context object says, and refuses to replace the context of another user.
- `runAsSystem(tenantId, fn)` is the system job entry: the only way to act as `{{sc:systemUser}}` and to call `runCrossTenant` without a role. Call it from scheduled jobs and migrations only. A token `sub`, an `x-user-id` header or a `runWithRequestContext` user equal to `{{sc:systemUser}}` stays an ordinary user.

### Errors

`AllExceptionsFilter` answers every exception with `application/problem+json`: `type`, `title`, `status` and a constant `detail`, never `exception.message` (body-parser and JSON parse messages quote the input). Validation errors add `errors: [{ field, messages }]` from class-validator; never put `$value` in a validation message. A domain error extends `ProblemError` with its status and a constant detail. `CrossTenantDeniedError` becomes 404, like a missing row. Unexpected errors also log `unhandled_error` with the stack frames, not the message.

## 7. Outbound: one logger per HttpService

Each module that imports `HttpModule.register(...)` or `registerAsync(...)` has its own `HttpService` and axios instance. List `...outboundHttpLogging(target)` once in that module's providers. The provider module of `stackcrew-nest-outbound-client`:

```ts
// Default location: src/modules/kyc/kyc.module.ts
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { outboundHttpLogging } from '../../common/logging/outbound-http-logger';
import type { KycProviderEnv } from '../../config/env';
import { AcmeKycClient } from './acme/acme-kyc.client';
import { KycProvider } from './kyc-provider.port';
import { KYC_PROVIDER_POLICY, KYC_PROVIDER_POLICY_DEFAULTS, KYC_PROVIDER_TARGET } from './kyc.constants';

const API_KEY_HEADER = 'X-Api-Key';
/** Provider replies are small JSON; a larger one is refused before it is buffered. */
const MAX_RESPONSE_BYTES = 1_048_576; // 1 MiB
/** The request carries a base64 selfie. */
const MAX_REQUEST_BYTES = 10_485_760; // 10 MiB

/**
 * The KYC provider: its own HttpService (base URL, timeout and the API key from config, no redirects, body limits),
 * OutboundHttpLogger on that HttpService, the resilience settings, and the adapter bound to the KycProvider port.
 * Other modules import KycModule and inject KycProvider only.
 */
@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<KycProviderEnv, true>) => ({
        baseURL: config.get('KYC_PROVIDER_BASE_URL', { infer: true }),
        timeout: config.get('KYC_PROVIDER_TIMEOUT_MS', { infer: true }),
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_REQUEST_BYTES,
        headers: { [API_KEY_HEADER]: config.get('KYC_PROVIDER_API_KEY', { infer: true }) },
      }),
    }),
  ],
  providers: [
    { provide: KYC_PROVIDER_POLICY, useValue: KYC_PROVIDER_POLICY_DEFAULTS },
    { provide: KycProvider, useClass: AcmeKycClient },
    ...outboundHttpLogging(KYC_PROVIDER_TARGET),
  ],
  exports: [KycProvider],
})
export class KycModule {}
```

- The line: `event=http_out`, `target`, `method`, `url` (scheme, host, port and path: no query string, no user info), `status`, `durationMs`, `reqBody`, `resBody`, the context ids, and `error` (the axios error code) when the call failed. A call that failed without a response still gives one line, without `status` and `resBody`. A retried call gives one line per attempt.
- Bodies are read after axios has serialized the request and parsed the response. The response is chosen by its content type, so an XML or text reply logs only its size. `responseType: 'stream'` responses are never read.
- A request or response body over 2 MiB logs only `<CT N bytes>`, as on the inbound line: N is the `Content-Length`, or the size of the data axios returned (for parsed JSON without a `Content-Length`, the size of its JSON text). It is never masked or serialized again for the line.
- Base URLs come from config; set `timeout` on every client. The provider client itself, retries and the error mapping are in `stackcrew-nest-outbound-client`.

## 8. Message consumers

Producers send the headers `x-request-id`, `x-tenant-id` and `x-user-id`. A consumer builds its context from them with `contextFromMessageHeaders` (unsafe values count as absent), logs one `message_in` line with the payload through the same masker (`maskCapturedBody`: over 2 MiB, `<CT N bytes>` unparsed, as for HTTP bodies), and runs the handler inside `runWithRequestContext`. The context never becomes the system identity from a header. The RabbitMQ version is `stackcrew-nest-rabbitmq-consumer`; any broker follows this shape:

```ts
// a consumer method (any broker)
async onMessage(payload: Buffer | undefined, contentType: string | undefined, headers: Readonly<Record<string, unknown>> | undefined): Promise<void> {
  await runWithRequestContext(contextFromMessageHeaders(headers), async () => {
    const type = contentType ?? JSON_CONTENT_TYPE;
    writeCallLine(this.logger, // never throws: the message is handled whatever happens to its line
      () => ({ event: LogEvent.MESSAGE_IN, ...contextLogFields(), reqBody: this.logBodies ? maskCapturedBody(payload, type, this.maskOptions) : undefined }),
      () => ({
        event: LogEvent.MESSAGE_IN, // an empty payload logs no body, as maskBody does
        reqBody: this.logBodies && payload !== undefined && payload.length > 0 ? bodyPlaceholder(type, payload.length) : undefined,
      }),
      'log');
    await this.handler.handle(this.codec.read(payload)); // read() rejects a missing or invalid payload with a non-retryable error
  });
}
```

## 9. Tests

- `body-masker.spec.ts` is the masker contract: every row of the `core-logging` table, the configured list, the character-boundary cut, form parsing and placeholders. Keep it next to `body-masker.ts`; it needs no Nest.
- `log-fields.spec.ts` pins `writeCallLine`: a failing build writes the fallback line, and a failing fallback or logger becomes a process warning, never an exception.
- `request-context.spec.ts` pins the identity rules: a cross-tenant role reads (read only), other roles are denied, only `runAsSystem` is the system identity (a token or header user named `{{sc:systemUser}}` is denied), unsafe header values are dropped, and concurrent contexts stay apart.
- `env.spec.ts` pins that numeric variables are converted from the strings the environment holds, and that an error names the variable, never its value.
- `outbound-http-logger.spec.ts` pins the `http_out` line against a local `node:http` stub: masked bodies, a URL without its query string, and bodies over 2 MiB logged by size only, with and without `Content-Length`.
- e2e with supertest (ask first) through the harness in `stack-nestjs-testing` (`createTestApp`: `AppModule` imported after the env is set, `createNestApplication({ rawBody: true })`, `setupApp(app)`, a `CapturingLogger`, a local token issuer). Wait for the line: it is written after the client has the response. Cover:
  - a body with a password gives exactly one `http_in` line with `"***"` in `reqBody`, while the client gets the original body;
  - a missing or invalid token gives a 401 with one line and no `userId`; a guard 403, an unknown route, a validation error and a malformed JSON body each give one line;
  - concurrent requests of two users: each line carries its own `userId`, and an anonymous request carries none;
  - an SSE or file endpoint logs a size placeholder and reaches the client unbuffered;
  - an outbound call to a local stub server gives one `http_out` line with a URL without its query string.

## Do not

- Do not log a body anywhere else: no `logger.log(dto)`, no body in an exception message, no second masker.
- Do not log headers other than `content-type`, `content-length` and `user-agent`; never `Authorization` or cookies.
- Do not turn pino-http's `autoLogging` on: it adds a second line per request.
- Do not register `httpLoggingMiddleware` with `MiddlewareConsumer`: Nest middleware runs after the body parsers, so a malformed body would get no line.
- Do not set the request context with `AsyncLocalStorage.enterWith`, or inside passport or jwks-rsa callbacks: only `storage.run` scopes, as in `request-context.ts`.
- Do not add `OutboundHttpLogger` twice to one module, or to a module without its own `HttpModule`.
