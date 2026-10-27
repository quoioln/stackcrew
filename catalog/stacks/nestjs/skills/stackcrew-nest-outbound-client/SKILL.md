---
name: stackcrew-nest-outbound-client
description: Use when adding or changing a call from a NestJS service to a third-party provider or another service over HTTP, such as an eKYC, payment or bank API: the port and adapter, typed provider DTOs and an ACL mapper, HttpService with a timeout, retry, circuit breaker and bulkhead, typed provider errors, masked http_out logging, and tests against a local provider fake.
kind: task
---
# Call a third-party provider (NestJS 10)

Follow these steps in order. Write the SC-PREFLIGHT note first: the port, the adapters, `src/common/providers/` (errors and policy), the module's `HttpModule` registration, `OutboundHttpLogger`, the env section and the mappers that already exist and that you will reuse. If the port exists you add an adapter; you never create a second port, policy or error family.

The example verifies an identity with a provider called Acme. Request logging (`OutboundHttpLogger`, `outboundHttpLogging(target)`) and `ProblemError` come from `stackcrew-nest-request-logging`; set that up first.

## 1. Shape

- The application depends on a **port**: an abstract class in domain types (`KycProvider`), which is also the injection token. An **adapter** (`AcmeKycClient`) implements it with `HttpService`, an **ACL mapper** and typed **provider DTOs**. No provider type, field or code leaves the adapter's folder.
- With a second provider, add a second adapter and a small registry that picks one by a provider code (a `Map` built from the injected adapters). A growing `if` or `switch` on provider names is the wrong shape. Do not build the registry for one provider.

## 2. Dependencies (ask the user before adding any)

- `cockatiel` 3.x (MIT, no dependencies) for the retry with backoff and jitter, the circuit breaker and the bulkhead that `core-backend-api` requires. It is TypeScript-first, and its policies compose (`wrap`) around any async call, including `firstValueFrom(this.http.post(...))`. Stay on 3.x: version 4 is ESM-only and needs Node 22, so a CommonJS Nest 10 build on Node 18 or 20, and Jest's CommonJS runtime, cannot load it.
- If the user declines it: keep the timeout, and retry transient failures with RxJS `retry({ count, delay })` on the `HttpService` observable (RxJS already ships with Nest). There is then no circuit breaker and no bulkhead; record that gap in the SC-PREFLIGHT note.
- `@nestjs/axios` and `axios` are already in place for `OutboundHttpLogger`; `axios` must be `^1.16.0` (section 6). Never add `axios-retry` or a second HTTP client.

## 3. Files

Each `<file>.md` next to this skill holds one source file: its first line says where the file goes, and the code block is the file's content.

| File | What it does |
|---|---|
| `provider.errors.ts.md` | `ProviderUnavailableError` (503), `ProviderRejectedError` (502), `ProviderProtocolError` (502): `ProblemError`s with constant details. |
| `provider-policy.types.ts.md` | `ProviderPolicyOptions` and `ProviderCall`. |
| `provider-call.policy.ts.md` | `providerCallPolicy(options)`: breaker, retry, bulkhead (cockatiel). |
| `kyc-verification.ts.md` | Domain types: `VerifyIdentityCommand`, `VerifyIdentityResult`, `KycDecision`. |
| `kyc-provider.port.ts.md` | The port, `KycProvider`. |
| `kyc.constants.ts.md` | The log target, the policy token and its defaults. |
| `acme-kyc.dto.ts.md` | Provider DTOs: the request type and the validated response class. |
| `acme-kyc.mapper.ts.md` | The ACL mapper: command to provider request, reply to domain result. |
| `acme-kyc.client.ts.md` | The adapter: one `HttpService` call per attempt, typed errors. |
| `kyc.module.ts.md` | `HttpModule.registerAsync`, `OutboundHttpLogger`, the policy and the port binding. |
| `acme-kyc.client.spec.ts.md` | Tests against a local `node:http` provider stub. |
| `kyc-verification.entity.ts.md`, `create-kyc-verification.migration.ts.md`, `kyc-verification.repository.ts.md`, `kyc-verification.errors.ts.md` | The operation row whose id is the idempotency key, on `TenantScopedRepository`. |
| `kyc-verification.service.ts.md`, `kyc-verification.module.ts.md` | Section 9: insert and commit the operation, call, persist the result. |
| `kyc-verification.service.spec.ts.md` | On Postgres: a business retry reuses the stored key; dedupe, FAILED, overlapping runs, no transaction during the call. |

## 4. Configuration

Add a section to `src/config/env.ts` (and `IsNotEmpty` to its class-validator import), then add `parseEnvSection(KycProviderEnv, raw)` to `validateEnv`, `KycProviderEnv` to the `Env` type, and its variables to the `raw` of the `validateEnv` test in `env.spec.ts`:

```ts
// src/config/env.ts (add)
export class KycProviderEnv {
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  KYC_PROVIDER_BASE_URL!: string;

  /** The bound on one attempt, from connect to the last byte of the reply (section 7). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  KYC_PROVIDER_TIMEOUT_MS = 5000;

  @IsString()
  @IsNotEmpty()
  KYC_PROVIDER_API_KEY!: string;
}
```

- The base URL is `https` outside local development; credentials come from the environment or a vault, never from code, a test fixture shared with production, or a log line.
- The module builds its own `HttpService` with `HttpModule.registerAsync`: `baseURL`, `timeout`, `maxRedirects: 0`, `maxContentLength` and `maxBodyLength` (axios defaults to no limit) and the API key header. Each module that imports `HttpModule` has its own axios instance, so `...outboundHttpLogging(target)` goes in that module's providers, once.
- The resilience numbers are constants per provider (`KYC_PROVIDER_POLICY_DEFAULTS`) behind an injection token, so a test can shorten the delays with `overrideProvider`.

## 5. Port, DTOs and the ACL mapper

- The port and the domain types use domain words only (`decision`, `score`), never the provider's (`resultCode`, `matchScore`).
- Provider DTOs live next to the adapter. The reply is a class-validator class, parsed at the edge: `plainToInstance` then `validateSync`. A body that is not JSON, misses a field or has an unknown result code is a `ProviderProtocolError`, never a partial result, a `null` or an `any`.
- Provider codes are an `as const` object, mapped with a `ReadonlyMap`; never compare provider strings inline.
- The mapper is the only code that knows both vocabularies. Keep it free of I/O so it is easy to test.

## 6. The adapter

- Call with `await firstValueFrom(this.http.post<unknown>(PATH, body, { headers, signal: AbortSignal.timeout(attemptTimeoutMs) }))`. The path is a constant relative to `baseURL`; never build a URL from a request value.
- Bound each attempt as a whole with `AbortSignal.timeout(KYC_PROVIDER_TIMEOUT_MS)`. In axios 1.x the `timeout` option stops counting once the response headers arrive; after that only the socket idle timeout applies, so a reply that trickles in byte by byte would hold the call indefinitely.
- Classify each failed attempt once:
  - no reply (timeout `ECONNABORTED`, the attempt bound `ERR_CANCELED`, connection refused or reset), a 2xx whose body broke mid-read (axios 1.16.0 and later attach the 2xx `response` to that error; older versions give no status, and the reply would be refused as a protocol error), 5xx, 429, 409 (the idempotency key is still in use: a concurrent run or a retry that overtook the first attempt, whose result the provider replays once done) and 401 or 403 (our credential or its permissions, a configuration fault, not this request): `ProviderUnavailableError`, retried and counted by the circuit breaker;
  - a reply over `maxContentLength` (`ERR_BAD_RESPONSE` without a status): `ProviderProtocolError`;
  - any other status (400, 404, 422, another 4xx, a 3xx), or a request over `maxBodyLength`: `ProviderRejectedError`, a refusal of this request that the same key would get again;
  - the mapper's `ProviderProtocolError` passes through.
- Send an idempotency key (`Idempotency-Key`) on every call that changes something. The service generates it once per business operation, stored before the call: for example, it inserts the verification row first and uses its id. Every attempt, and every later retry of the same operation, sends that stored key. It is never the inbound `x-request-id` and never a client's raw `Idempotency-Key` header, since either can repeat across different operations or change between retries of one. A separate `traceRef` carries the request id for correlation only.
- Retry only idempotent calls, or calls the provider deduplicates by that key. A charge without a provider idempotency key is not retried.
- Token-based providers: cache the token until shortly before it expires; never fetch one per call, and never log it. Drop the cached token on a 401 before the retry, so the retry authenticates again instead of replaying a token the provider no longer accepts.
- The adapter logs no body and no command (a document number or a selfie). Log ids and outcomes only: `this.logger.warn({ event: 'provider_failed', provider, requestId, error: error.name }, 'provider_failed')`.
- Observability: a 401 or 403 now reaches callers as "unavailable" (503) like a 5xx, so a credential or permission fault does not announce itself; alert on `http_out` lines with `status` 401 or 403 for the provider's `target`, and treat one as a configuration incident, not as provider downtime.

## 7. Resilience

`providerCallPolicy(options)` wraps one logical call, outermost first:

1. **Circuit breaker:** after `breakAfter` consecutive failed calls it fails fast for `halfOpenAfterMs`, then lets one trial call through. One call, its retries included, counts once.
2. **Retry:** up to `maxRetries` more attempts with exponential backoff and jitter, for `ProviderUnavailableError` only. A rejection or an invalid reply is never retried and never opens the circuit.
3. **Bulkhead:** at most `maxConcurrent` attempts in flight and `maxQueued` waiting; beyond that the call fails fast.

- Each attempt is bounded by `AbortSignal.timeout(KYC_PROVIDER_TIMEOUT_MS)` (section 6). One call can therefore take up to `maxRetries + 1` attempts of at most that bound each, plus the backoff between them (at most `maxDelayMs` each), plus any wait for a bulkhead slot. Keep that sum well inside the caller's own deadline: an HTTP request, or a message's processing time.
- An open circuit or a full bulkhead becomes `ProviderUnavailableError`, so the API answers 503 with a constant detail.
- Create the policy once per client (in its constructor): a policy created per call never opens its circuit.

## 8. Logging

- `OutboundHttpLogger` on the module's `HttpService` writes one `http_out` line per attempt: `target`, `method`, `url` without the query string, `status`, `durationMs`, `error` (the axios code) and both bodies after the shared masker. A retried call gives one line per attempt; a timeout gives a line with `error` (`ECONNABORTED`, or `ERR_CANCELED` for the attempt bound) and no `status`.
- PII and secret keys become `"***"`, base64 images over 1 KB become `<base64 N bytes>`, XML or text replies and bodies over 2 MiB log only their size.
- Nothing else logs a provider body: no `logger.log(response.data)`, no body in an exception message.

## 9. Calling the provider from a service

A call that changes something runs as a stored operation, in this order (`kyc-verification.service.ts.md`):

1. **Insert the operation row and commit.** Its id is the provider's idempotency key and exists before any call (`start(profileId)`). A profile has at most one PENDING operation per tenant: a partial unique index (`kyc_verification_pending_key`, `WHERE "status" = 'PENDING'`) and one `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING id` in `startPending` give a repeated or concurrent start the same operation and key. The caller keeps the id: in a job row, a message, or the API response.
2. **Call the provider outside any transaction** with the key reloaded from the row (`run(id, evidence)`). A transaction held open across a remote call keeps locks and a pooled connection for the length of the call.
3. **Persist the result in a transaction,** with any other write it causes: the profile status, or an outbox row. Those side writes are a `KycOutcomeEffects` bound to `KYC_OUTCOME_EFFECTS` in the feature's module (`completed(manager, verification, result)`, `failed(manager, verification)`); the service calls them inside the transaction that wrote the status, after it checked that the status update affected exactly one row. The run that lost a race (its update changed no row) commits nothing else: no outbox event for a result the row did not take.

- A retry or redelivery of the operation calls `run(id, …)` again. It reloads the stored key, so every attempt and every later retry sends the same key and the provider applies the request once. A completed operation returns its stored result without a call.
- States: PENDING, then COMPLETED, or FAILED when the provider refuses the request (`ProviderRejectedError`: 400, 404, 422, another 4xx that is not 401, 403, 409 or 429): the same key would be refused again, so `run` marks it FAILED and rethrows, and a later `run` throws `KycVerificationFailed` (409) without a call. Unavailable (including the provider's 409, 401 and 403) and an invalid reply leave it PENDING for a retry. A new check after COMPLETED or FAILED is a new operation with a new key.
- Two runs of one operation can overlap: a redelivery during a slow call, the orphan sweep, two requests that got the same pending operation. Every status write names the statuses it may replace and reads its affected count inside its transaction; a write that affects no row reloads the row and answers with its stored state, so every caller ends with the row's outcome. A provider success is authoritative: the COMPLETED update replaces `In([PENDING, FAILED])`, never a COMPLETED and never a status added later by accident; the FAILED update replaces PENDING only.
- A second start while an operation is PENDING reuses the old key, and the provider may replay the earlier result to it: start a new operation only after the previous one is terminal.
- The evidence (the document number, the selfie) is PII: never store it on the operation row, in a message or in a job payload. Keep it where the upload put it (object storage, encrypted, with a retention limit) and store only its reference with the job or message that runs the operation, or in an `evidenceRef` column; every run loads it by that reference.
- Orphaned PENDING rows (the process died between the steps) are picked up by a scheduled job: it lists PENDING rows created longer ago than the whole call budget with `runAsSystem(undefined, () => runCrossTenant(reason, …))`, which only reads, then runs each one in its own tenant with `runAsSystem(row.{{sc:tenantColumn}}, () => service.run(row.id, evidence))`, or flags it for review when its evidence is gone.
- Never generate the key at call time, and never create a new operation row for a retry; either would send a fresh key.
- Add `CreateKycVerification1730000000002` to `migrations` in `DatabaseModule` (rename the timestamp to follow the project's last migration), and import `KycVerificationModule` where the operation is used.
- A provider failure reaches the API as the `ProviderError` the adapter threw (502 or 503 problem details). Catch it only to take a different business path, never to swallow it into `null`.
- Provider callbacks (webhooks) are REST endpoints (`stackcrew-nest-rest-endpoint`): verify the signature in constant time, store the event with an insert-or-ignore on the provider's event id, answer 200 at once, and process the stored row afterwards.

## 10. Tests

- **The adapter, against a local provider fake:** `acme-kyc.client.spec.ts` starts a `node:http` server on port 0, points `KYC_PROVIDER_BASE_URL` at it and scripts one reply per request. The real `HttpService`, timeout, policy, mapper and `OutboundHttpLogger` run. Cover: success mapped to the domain result; 5xx and 429 retried with the same stored idempotency key, which is not the request id of the context; retries exhausted; a timeout retried; a reply that trickles past the bound after its headers cut and retried; a reply whose body breaks after a 200 retried; a reply over `maxContentLength` refused without a retry; 409, 401 and 403 retried with the same key; 400, 404 and 422 not retried; a reply that is not JSON, misses a field or has an unknown code; the circuit opening. Assert the stub's hit count and one `http_out` line per attempt with masked bodies.
- **Code that calls the port:** a test binds a fake, `{ provide: KycProvider, useValue: { verify: jest.fn() } }`, and covers each typed error the port can throw. `kyc-verification.service.spec.ts` runs the service on Postgres with that fake. A business retry after a failed call sends the stored id again as the key, with the request id only in `traceRef`; a completed operation makes no second call; concurrent starts of a new profile and a later start by another user return the pending operation (the conflict update audited with that user), and a start after completion a new one; a rejection ends it FAILED with no further call; two runs in flight at once (one answered 409 and one approved; a refusal and a success, where COMPLETED replaces FAILED; two replies, where the one stored first is the outcome of both; a refusal after a success) leave the row COMPLETED and every caller with that outcome, each row waiting for the held call to be registered and counting both calls; the side writes (a probe table in the test) exist only for the status write that won, never for the run that lost; no transaction is open during the provider call (`pg_stat_activity`, `idle in transaction`); another tenant gets not found.
- Never call the real provider from a test, not even a sandbox, in the default test run. More in `stackcrew-nestjs-testing`.

## Do not

- Do not use `fetch`, a bare axios instance or `axios-retry`; use the module's `HttpService` with `OutboundHttpLogger`.
- Do not let a provider DTO, `any` or a raw `response.data` reach a service, a controller or the domain.
- Do not hardcode base URLs, credentials, timeouts or provider codes; use config and constants.
- Do not retry a 400, 404 or 422 (a refusal of the request), an invalid reply or a non-idempotent call without an idempotency key, and do not retry in a loop around the policy. 5xx, 429, 409, 401 and 403 are retried by the policy, with the same key.
- Do not return provider messages or codes to API clients, and do not log a provider body yourself.
- Do not call a provider inside a transaction.
