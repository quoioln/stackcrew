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
- `@nestjs/axios` and `axios` are already in place for `OutboundHttpLogger`. Never add `axios-retry` or a second HTTP client.

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

## 4. Configuration

Add a section to `src/config/env.ts`, then add `parseEnvSection(KycProviderEnv, raw)` to `validateEnv`, `KycProviderEnv` to the `Env` type, and its variables to the `raw` of the `validateEnv` test in `env.spec.ts`:

```ts
// src/config/env.ts (add)
export class KycProviderEnv {
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  KYC_PROVIDER_BASE_URL!: string;

  /** Per attempt; with retries, the caller waits up to (maxRetries + 1) timeouts plus the backoff. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  KYC_PROVIDER_TIMEOUT_MS = 5000;

  @IsString()
  KYC_PROVIDER_API_KEY!: string;
}
```

- The base URL is `https` outside local development; credentials come from the environment or a vault, never from code, a test fixture shared with production, or a log line.
- The module builds its own `HttpService` with `HttpModule.registerAsync`: `baseURL`, `timeout`, `maxRedirects: 0` and the API key header. Each module that imports `HttpModule` has its own axios instance, so `...outboundHttpLogging(target)` goes in that module's providers, once.
- The resilience numbers are constants per provider (`KYC_PROVIDER_POLICY_DEFAULTS`) behind an injection token, so a test can shorten the delays with `overrideProvider`.

## 5. Port, DTOs and the ACL mapper

- The port and the domain types use domain words only (`decision`, `score`), never the provider's (`resultCode`, `matchScore`).
- Provider DTOs live next to the adapter. The reply is a class-validator class, parsed at the edge: `plainToInstance` then `validateSync`. A body that is not JSON, misses a field or has an unknown result code is a `ProviderProtocolError`, never a partial result, a `null` or an `any`.
- Provider codes are an `as const` object, mapped with a `ReadonlyMap`; never compare provider strings inline.
- The mapper is the only code that knows both vocabularies. Keep it free of I/O so it is easy to test.

## 6. The adapter

- Call with `await firstValueFrom(this.http.post<unknown>(PATH, body, { headers }))`. The path is a constant relative to `baseURL`; never build a URL from a request value.
- Classify each failed attempt once: no response (timeout `ECONNABORTED`, connection refused or reset), 5xx and 429 are `ProviderUnavailableError`; any other status is `ProviderRejectedError`; the mapper's `ProviderProtocolError` passes through.
- Send an idempotency key (`Idempotency-Key`, from the business request id) on every call that changes something, the same key on every attempt. Retry only idempotent calls, or calls the provider deduplicates by that key. A charge without a provider idempotency key is not retried.
- Token-based providers: cache the token until shortly before it expires; never fetch one per call, and never log it.
- The adapter logs no body and no command (a document number or a selfie). Log ids and outcomes only: `this.logger.warn({ event: 'provider_failed', provider, requestId, error: error.name }, 'provider_failed')`.

## 7. Resilience

`providerCallPolicy(options)` wraps one logical call, outermost first:

1. **Circuit breaker:** after `breakAfter` consecutive failed calls it fails fast for `halfOpenAfterMs`, then lets one trial call through. One call, its retries included, counts once.
2. **Retry:** up to `maxRetries` more attempts with exponential backoff and jitter, for `ProviderUnavailableError` only. A rejection or an invalid reply is never retried and never opens the circuit.
3. **Bulkhead:** at most `maxConcurrent` attempts in flight and `maxQueued` waiting; beyond that the call fails fast.

- The timeout is the `HttpService` `timeout`, per attempt. Keep the worst case, `(maxRetries + 1) * timeout` plus backoff, well inside the caller's own deadline (an HTTP request or a message's processing time).
- An open circuit or a full bulkhead becomes `ProviderUnavailableError`, so the API answers 503 with a constant detail.
- Create the policy once per client (in its constructor): a policy created per call never opens its circuit.

## 8. Logging

- `OutboundHttpLogger` on the module's `HttpService` writes one `http_out` line per attempt: `target`, `method`, `url` without the query string, `status`, `durationMs`, `error` (the axios code) and both bodies after the shared masker. A retried call gives one line per attempt; a timeout gives a line with `error` and no `status`.
- PII and secret keys become `"***"`, base64 images over 1 KB become `<base64 N bytes>`, XML or text replies and bodies over 2 MiB log only their size.
- Nothing else logs a provider body: no `logger.log(response.data)`, no body in an exception message.

## 9. Calling the provider from a service

- Never call a provider inside a database transaction: call first, then persist the result in a transaction (or write an outbox row and call from a job).
- A provider failure reaches the API as the `ProviderError` the adapter threw (502 or 503 problem details). Catch it only to take a different business path, never to swallow it into `null`.
- Provider callbacks (webhooks) are REST endpoints (`stackcrew-nest-rest-endpoint`): verify the signature in constant time, store the event with an insert-or-ignore on the provider's event id, answer 200 at once, and process the stored row afterwards.

## 10. Tests

- **The adapter, against a local provider fake:** `acme-kyc.client.spec.ts` starts a `node:http` server on port 0, points `KYC_PROVIDER_BASE_URL` at it and scripts one reply per request. The real `HttpService`, timeout, policy, mapper and `OutboundHttpLogger` run. Cover: success mapped to the domain result; 5xx and 429 retried with the same idempotency key; retries exhausted; a timeout retried; a 4xx not retried; a reply that is not JSON, misses a field or has an unknown code; the circuit opening. Assert the stub's hit count and one `http_out` line per attempt with masked bodies.
- **Code that calls the port:** a unit test binds a fake, `{ provide: KycProvider, useValue: { verify: jest.fn() } }`, and covers each typed error the port can throw.
- Never call the real provider from a test, not even a sandbox, in the default test run. More in `stackcrew-nestjs-testing`.

## Do not

- Do not use `fetch`, a bare axios instance or `axios-retry`; use the module's `HttpService` with `OutboundHttpLogger`.
- Do not let a provider DTO, `any` or a raw `response.data` reach a service, a controller or the domain.
- Do not hardcode base URLs, credentials, timeouts or provider codes; use config and constants.
- Do not retry a 4xx, an invalid reply or a non-idempotent call without an idempotency key, and do not retry in a loop around the policy.
- Do not return provider messages or codes to API clients, and do not log a provider body yourself.
- Do not call a provider inside a transaction.
