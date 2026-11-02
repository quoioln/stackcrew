# stackcrew — Common API response envelope (Spring Boot, NestJS, Next.js) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace RFC 7807 problem+json, bare DTO success bodies and the Next.js `ActionResult` with one success/error envelope across all three stacks. Error numbers have the form `SSCCNNN` and keep the number of the service the error came from. A per-request `supportCode` is added. Ship as `0.3.0`.

**Architecture:**
- This plan is almost entirely catalog content: markdown rules, `SKILL.md` files, and `<file>.<ext>.md` siblings under `catalog/`.
- Every stack gets the same pieces:
  - a contract module (types, the error table, detail codes, the `errorNumber` formatter);
  - one shared layer that wraps success values and turns exceptions into error envelopes (Spring advice/handlers, a Nest interceptor/filter, Next wrappers);
  - correlation IDs from the existing logging filter or middleware;
  - an "internal service" mode for outbound clients.
- Logic is proven in throwaway scratch projects, never in the repo.
- Engine code (`src/`) is touched only by the version bump.

**Tech Stack:**
- Repo: Node.js ≥ 18.3 ESM, zero dependencies, `node:test`.
- Content targets:
  - Spring Boot 3.x (Spring MVC 6, Spring Security 6, springdoc);
  - NestJS 10 with `@nestjs/swagger`, class-validator, Jest;
  - Next.js 16 App Router, React 19, zod 3, react-hook-form, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-api-response-envelope-design.md`. It wins over the two older specs. `§` below means that spec. The user's source document is `docs/api-response-structure.md` (v2.1); Task 12 rewrites it to v3.0.

**Branch:** `feat/api-response-envelope`, from `main` `f6a01f3`. The spec commit is `f493f06`. Baseline: `npm test` → **465 pass** (≈100 s).

**Tóm tắt (VI):**
- Mỗi stack có ba phần chính:
  - module contract (type, bảng mã lỗi, mã detail, hàm format `errorNumber`);
  - tầng bọc chung (Spring: advice + security handler; NestJS: interceptor + filter; Next.js: wrapper);
  - ID tương quan sinh trong filter/middleware logging sẵn có.
- Thêm chế độ "service nội bộ" cho outbound client, để chuyển nguyên `errorNumber` gốc.
- Mỗi stack được chứng minh bằng một project tạm.
- Cuối cùng: test so khớp bảng mã lỗi giữa 3 stack, tài liệu v3.0, phiên bản 0.3.0.

---

## Rulings against or beyond the spec (decided while planning; the SDD controller does not re-argue them)

| # | Ruling | Why |
|---|---|---|
| P3-R1 | Task boundaries follow the import graph. Each stack's error/result swap is done in the stack's **infra task** together with a **compatibility re-export**: NestJS `ProblemError` = deprecated alias of `ApiError`; Next.js `action-result.ts` re-exports nothing new and is deleted only in Task 9. The feature task of the same stack removes the alias. No test asserts on an alias. | NestJS `ProblemError` is extended by rest-endpoint and outbound-client siblings. Next.js `action-result.ts` is imported by route-handler, server-action and feature-page siblings. A one-task rename would break unrelated needle tests. |
| P3-R2 | `requestId` is UUID-only **for HTTP entry**, through a new function `requestIdOrNew(value)` (TS) / `LogFields.requestIdOrNew(String)` (Java). Message headers keep `safeRequestIdOrNew`, unchanged. | Spec §7 is about HTTP. The Kafka/RabbitMQ tests (`catalog-spring.test.js:491,501`) and other producers send non-UUID IDs. Changing message parsing gains nothing. |
| P3-R3 | `supportCode` is generated with `crypto.randomInt(0, 26)` (TS) / `SecureRandom.nextInt(26)` (Java), six times, mapped to `A`–`Z`. Every context gets one: HTTP, `runAsSystem`, message consumers. It is never read from a header. | Unbiased generation. Logs from jobs and consumers become searchable the same way. |
| P3-R4 | A handler result of `undefined`, `void` or `null` becomes `data: null`, and the key is always present. TS: `data: value === undefined ? null : value`. Java: the success type serializes `data` with `@JsonInclude(ALWAYS)`. | `JSON.stringify` drops `undefined`, and a global `NON_NULL` drops `null` (spec §3.1, tài liệu gốc §7). |
| P3-R5 | Spring `void` handlers are settled by a scratch matrix (Task 3, Step 1) with two decided outcomes. **(A)** If `ResponseBodyAdvice` runs for a `void` handler without `@ResponseStatus`, the advice wraps `null`. **(B)** If it does not, register `VoidEnvelopeReturnValueHandler`, a `HandlerMethodReturnValueHandler` placed before `RequestResponseBodyMethodProcessor`. It handles `void`/`Void` returns of `@RestController` methods without `@RawResponse` and writes the success envelope. **In both outcomes**, ArchUnit rule `SC-ENVELOPE` fails a `@RestController` method that returns `String`, a `void` method annotated `@ResponseStatus` (Spring returns early with no body), or any `@ResponseStatus(NO_CONTENT)`. | The reviewer flagged the void path. `ServletInvocableHandlerMethod` returns early when a response status is set, so no advice can run there. |
| P3-R6 | Next.js unknown API paths are answered by a catch-all `src/app/api/[...slug]/route.ts`. It exports GET, POST, PUT, PATCH, DELETE and OPTIONS, and each returns `ENDPOINT_NOT_FOUND` (404). A **known** path with an unexported method gets Next's own 405 with no body. That is the one documented exception, stated in the route-handler `SKILL.md`. | Next.js answers both cases itself. The catch-all covers what can be covered; a 405 needs a router change Next does not offer. |
| P3-R7 | Next.js route wrapper: `apiRoute(handler, { status?: 200 \| 201 })` builds a `RouteHandler` for `withRouteLogging`. A handler returns data (wrapped) or a `Response` instance (passed through unwrapped: streams, files, SSE). `apiRoute` catches `ApiError`/`UpstreamApiError` → error envelope, and Next control flow → rethrow. Any other throw → `INTERNAL_ERROR` envelope (500) plus `logUnhandledError`-style ERROR line with the stack. It sets `x-request-id` and `x-support-code` on every response it builds. | Spec §5.3 names no signature. Raw responses must still be possible. A caught error no longer reaches `onRequestError`, so the stack must be logged here. |
| P3-R8 | Next.js `withActionLogging` returns `ApiResponse<T>`: `ApiError` → failure envelope; an unexpected throw → `INTERNAL_ERROR` envelope plus an ERROR line with the stack (the `onRequestError` path no longer sees it); control flow → rethrow. The `http_in` line's status comes from `definition.status` (500 for unexpected). | Spec §5.3. |
| P3-R9 | `page.tsx` catches `ApiError` **into a variable** and calls `redirect()`/`notFound()` **after** the `try` block, never inside it. | The existing Next rule: `redirect()`/`notFound()` throw and must stay outside `try`. |
| P3-R10 | Paging is the same in all three stacks: `DEFAULT_PAGE_SIZE = 20`, `MAX_PAGE_SIZE = 100`, `MAX_PAGE = 1000`. `page` is valid in `0 ≤ page < MAX_PAGE`; outside that → `VALIDATION_FAILED`. `size < 1` → `VALIDATION_FAILED`; `size > MAX_PAGE_SIZE` → capped, and the capped value is returned. Spring gains a validated `PageQuery` record instead of a raw `Pageable`, because Spring silently clamps a negative page. | Spec §3.5. Spring has no `MAX_PAGE` today. |
| P3-R11 | **Query-string validation is `VALIDATION_FAILED`** with details in every stack. `INVALID_PARAMETER` is only for a **path** parameter of the wrong type: Spring `MethodArgumentTypeMismatchException` on a `@PathVariable`, Nest `ParseUUIDPipe`/`ParseIntPipe`. | It removes the VALIDATION/INVALID_PARAMETER overlap the reviewer saw, and matches spec §3.5 (bad `page` → `VALIDATION_FAILED`). |
| P3-R12 | The internal TS/Java property for the summary text is **`summary`**: `ErrorDefinition.summary` and `ErrorCode.summary()`. It serializes as the JSON key `message`. Error-handling code never reads `.message` from anything. | It keeps the existing guard test (`!/\.message\b/` on the NestJS filter files, `catalog-nest.test.js:283`) meaningful: no exception message can leak. |
| P3-R13 | Spring `rest-endpoint` and `integration-provider` are `SKILL.md`-only today. New Java goes into `<Class>.java.md` siblings with the `Goes to \`src/main/java\`, package \`{{sc:basePackage}}.common.api\`, as \`X.java\`.` header. `SKILL.md` stays ≤ 350 lines. | It keeps the line cap and the existing sibling-format test. |
| P3-R14 | CORS is configured in no template, so no config is invented. The `security`/stack rule lines that mention CORS get one clause: "and expose `x-request-id` and `x-support-code` (`Access-Control-Expose-Headers`)". | Spec §7. Config the catalog doesn't own stays a rule. |
| P3-R15 | Fixtures (`fixtures/*-minimal`) contain no API or error code and stay unchanged. Task 12 only re-runs the e2e tests. If a test lists rendered skill files, the new siblings are added to its expected file set. | The reviewer confirmed it. Spec §8 lists fixtures only conditionally. |
| P3-R16 | An upstream timeout (spec §4.3 "B không phản hồi") → `GATEWAY_TIMEOUT`. Connection refused or reset, or B answered 5xx without an envelope → `DEPENDENCY_UNAVAILABLE`. B answered 2xx/4xx with a body that is not an envelope → `BAD_GATEWAY`. B's 401/403, envelope or not → `DEPENDENCY_UNAVAILABLE`. B's envelope 4xx (not 401/403) → `UpstreamApiError` with B's status. B's envelope 5xx → `UpstreamApiError` with status **502**. | Spec §4.3 names group 80 without choosing among its three rows. |

---

## Global Constraints

- **Plan 1 and Plan 2 constraints still apply** (`docs/superpowers/plans/2026-10-26-stackcrew-plan-2-nest-next.md` "Global Constraints"):
  - zero dependencies; `node:test` + `node:assert/strict`; LF; content in English, README in Vietnamese;
  - budgets: always-on ≤ 6,000 B; AGENTS.md block ≤ 16,000 B; Antigravity rule ≤ 24,000 B; Cursor `.mdc` ≤ 500 lines; **≤ 15 Essentials bullets**; description ≤ 500 chars;
  - no banned orchestration phrases; `{{sc:name}}` placeholders only;
  - `SKILL.md` ≤ 350 lines; siblings are `<file>.<ext>.md` with one "Goes to" line and one code block;
  - no file named `*.test.*` / `test-*` / under `test/` inside `catalog/`; example tests use `*.spec.ts` / `*Test.java`;
  - guard rule ids match `SC-[A-Z]+`;
  - no internal names or secrets.
- **Every task ends with:** `node bin/stackcrew.js plugin`, then the full `npm test` (all pass), then one commit whose message ends `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Verify before writing** (Context7 or official docs), and say which source was used in the task report:
  - Spring MVC 6 `ResponseBodyAdvice`, `HandlerMethodReturnValueHandler`, `@RestControllerAdvice` exception ordering, `HandlerMethodValidationException`;
  - Spring Security 6 `AuthenticationEntryPoint`, `AccessDeniedHandler`, method-security `AuthorizationDeniedException`;
  - springdoc `OperationCustomizer`;
  - NestJS 10 interceptors (`StreamableFile`, `@Res()`, `@Sse()`), exception filters, `@nestjs/swagger` `ApiExtraModels`/`getSchemaPath`;
  - class-validator constraint names;
  - Next.js 16 route handlers, server actions, catch-all segments, `unstable_rethrow`;
  - zod 3 issue codes.
- **Scratch projects** live in the session scratchpad as `p3-spring`, `p3-nest` and `p3-next`, never in the repo. Each content task's report lists the commands run and their results. Docker, JDK 21, Maven 3.9, Node 22 and yarn are available.
- **New dependencies:** none. Content may only use libraries the catalog already uses.
- **Version:** `0.3.0` in `package.json`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugin/cli/package.json` (regenerated), plus whatever `test/release.test.js` checks (Task 12).

---

## Review Focus

1. **A handler that returns nothing** (Spring `void` delete, Nest `async remove(): Promise<void>`, Next action returning `undefined`).
   - Expect: `200` and a body whose `data` key exists and is `null`.
   - Owned by Task 3 (scratch matrix row + test `spring envelope: void handler yields data null and SC-ENVELOPE bans the early-return shapes`), Task 5 (test `nest envelope: undefined becomes data null`), Task 8 (test `next envelope: undefined becomes data null in actions and routes`).
2. **An error raised before the controller.** Examples: Spring Security 401/403, a 413 from the body parser, an unknown route, malformed JSON.
   - Expect: an error envelope with a non-empty `supportCode` matching `^[A-Z]{6}$` and a UUID `requestId`, and the `x-support-code` and `x-request-id` headers equal to the body values.
   - Owned by Task 2 (correlation in the filter), Task 3 (scratch rows + test `spring security handlers and the advice answer the envelope with the filter's ids`), Task 5 (test `nest filter answers body-parser and unknown-route errors with the envelope and headers`), Task 9 (test `next catch-all answers ENDPOINT_NOT_FOUND`).
3. **Upstream B answers something other than a 4xx envelope.** Cases: an HTML 502 from a proxy, an empty body, a 401, a timeout.
   - Expect: A's own group-80 error per P3-R16, never a pass-through.
   - A 4xx envelope from B passes through unchanged with B's status; a 5xx envelope from B passes through with 502.
   - Owned by Tasks 4, 7 and 11, each with test `<stack> internal client: upstream classification table`.
4. **Several constraints on nested and array fields.** Example: `address.city` blank and too long; `items[1].sku` with the wrong format.
   - Expect: one detail per (field, constraint), the paths `address.city` and `items[1].sku`, and the same `code` values in all three stacks.
   - Owned by Task 3, Task 5 and Task 8 (each mapping table + spec file), and Task 12 (test `cross-stack: detail code mapping tables agree`).
5. **Responses that must not be wrapped.** Spring: `Resource`, `StreamingResponseBody`, `SseEmitter`, actuator, springdoc. Nest: `StreamableFile`, `@Sse()`, `@Res()`, health. Next: a returned `Response`.
   - Expect: passed through byte-for-byte. A Spring `@RestController` method returning `String` fails `SC-ENVELOPE`.
   - Owned by Task 3 (scratch rows + ArchUnit test), Task 5 (test `nest transform interceptor skips streams, SSE, @Res and @RawResponse`), Task 8 (test `next apiRoute passes a Response through`).

---

## Cross-stack contract (used verbatim by Tasks 2–12)

### Envelope

Success keys, in this order: `success`, `timestamp`, `supportCode`, `requestId`, `data`.
Error keys, in this order: `success`, `message`, `timestamp`, `supportCode`, `requestId`, `error`.
`error` = `{ errorNumber, errorCode, details }`, and each detail = `{ field, code, message }`.

- `timestamp`: an ISO-8601 UTC **string** with milliseconds (`2026-11-02T02:52:00.000Z`). TS: `new Date().toISOString()`. Java: `Instant.now().truncatedTo(ChronoUnit.MILLIS)` (Jackson ISO output). Server actions must return plain JSON, so never a `Date`.
- `errorNumber`: a string matching `^\d{7}$`, equal to `serviceNumber + pad2(category) + pad3(seq)`. An `UpstreamApiError` carries B's string unchanged.
- `field`: a dotted path (`address.city`) with array indexes in brackets (`items[1].sku`). `null` when the detail is about no single field.

### Type and function names

| Concept | TypeScript (NestJS and Next.js, same names) | Java (Spring) |
|---|---|---|
| Success / failure / union | `ApiSuccess<T>`, `ApiFailure`, `ApiResponse<T>` | `sealed interface ApiResponse<T> permits SuccessResponse, ErrorResponse`; `record SuccessResponse<T>`, `record ErrorResponse` |
| Error payload / detail | `ErrorPayload`, `ErrorDetail` | `record ErrorPayload`, `record ErrorDetail` |
| Page | `PageData<T> = { items, pagination }`, `Pagination`, `toPageData(items, page, size, totalElements)` | `record PageData<T>`, `record Pagination`, `PageData.of(List<T>, int page, int size, long totalElements)` |
| Error definition | `ErrorDefinition = { category; seq; code; status; summary }`, `CommonError` (const object of the table below) | `interface ErrorCode { int category(); int seq(); String code(); HttpStatus status(); String summary(); }`, `enum CommonErrorCode implements ErrorCode` |
| Detail codes | `DetailCode` const object | `enum DetailCode` |
| Formatter | `formatErrorNumber(serviceNumber: string, def: ErrorDefinition): string` | `ErrorNumbers.format(String serviceNumber, ErrorCode code)` |
| Thrown errors | `ApiError(definition, details = [])`, `UpstreamApiError(status, payload: ErrorPayload, summary: string)` | `ApiException(ErrorCode, List<ErrorDetail>)`, `UpstreamApiException(HttpStatus, ErrorPayload, String summary)` |
| Opt-out | `@RawResponse()` (Nest decorator) / return a `Response` (Next) | `@RawResponse` (method/class annotation) |
| Correlation | `RequestContext.supportCode: string`; `newSupportCode(): string`; `requestIdOrNew(value: unknown): string` | MDC `supportCode`; `LogFields.newSupportCode()`, `LogFields.requestIdOrNew(String)`; request attributes `LogFields.REQUEST_ID_ATTRIBUTE`, `LogFields.SUPPORT_CODE_ATTRIBUTE` |
| Service number | env `SERVICE_NUMBER` (`^\d{2}$`, required, boot fails) | `app.service-number` → `@Validated record ServiceNumberProperties(@Pattern(regexp = "\\d{2}") @NotNull String serviceNumber)` |

### Headers and log fields

- Response headers: `x-request-id` and `x-support-code`, on every response the shared layer builds or the filter/middleware passes.
- New `http_in` field: `supportCode`.
- New `http_out` fields for internal-service calls: `upstreamErrorNumber`, `upstreamSupportCode`, `upstreamRequestId`.
- `traceId`/`spanId` stay in logs and never appear in a body.

### Error table (`category`, `seq`, `code`, `status`, `summary`), exact, all three stacks

| category | seq | code | status | summary |
|---|---|---|---:|---|
| 10 | 1 | `VALIDATION_FAILED` | 400 | Request validation failed |
| 11 | 1 | `MALFORMED_REQUEST` | 400 | The request body is malformed |
| 11 | 2 | `METHOD_NOT_ALLOWED` | 405 | The HTTP method is not supported |
| 11 | 3 | `UNSUPPORTED_MEDIA_TYPE` | 415 | The content type is not supported |
| 11 | 4 | `INVALID_PARAMETER` | 400 | A query or path parameter is invalid |
| 11 | 5 | `PAYLOAD_TOO_LARGE` | 413 | The request body is too large |
| 11 | 6 | `ENDPOINT_NOT_FOUND` | 404 | The endpoint does not exist |
| 20 | 1 | `UNAUTHENTICATED` | 401 | Authentication is required |
| 21 | 1 | `ACCESS_DENIED` | 403 | You are not allowed to do this |
| 30 | 1 | `RESOURCE_NOT_FOUND` | 404 | The resource does not exist |
| 40 | 1 | `BUSINESS_CONFLICT` | 409 | The request conflicts with the current state |
| 41 | 1 | `BUSINESS_RULE_VIOLATION` | 422 | The request violates a business rule |
| 50 | 1 | `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| 80 | 1 | `DEPENDENCY_UNAVAILABLE` | 503 | A required service is unavailable |
| 80 | 2 | `BAD_GATEWAY` | 502 | An upstream service returned an invalid response |
| 80 | 3 | `GATEWAY_TIMEOUT` | 504 | An upstream service did not respond in time |
| 90 | 1 | `INTERNAL_ERROR` | 500 | An unexpected error occurred |

Domain errors use `seq` 100–999. A domain error that reuses a common `code` keeps that code's `summary`; a new `code` defines its own.

### Framework exception → error code

| Source | Spring | NestJS | Next.js |
|---|---|---|---|
| Body/query DTO validation | `MethodArgumentNotValidException`, `BindException`, `HandlerMethodValidationException`, `ConstraintViolationException` → `VALIDATION_FAILED` + details | `RequestValidationError` (ValidationPipe `exceptionFactory`) → `VALIDATION_FAILED` + details | `validationError(zodError)` → `VALIDATION_FAILED` + details |
| Unreadable body | `HttpMessageNotReadableException` → `MALFORMED_REQUEST` | body-parser 400 → `MALFORMED_REQUEST` | `readJsonBody` bad JSON → `MALFORMED_REQUEST` |
| Wrong media type | `HttpMediaTypeNotSupportedException` → `UNSUPPORTED_MEDIA_TYPE` | body-parser 415 / `HttpException` 415 → `UNSUPPORTED_MEDIA_TYPE` | `readJsonBody` wrong content type → `UNSUPPORTED_MEDIA_TYPE` |
| Too large | `MaxUploadSizeExceededException` → `PAYLOAD_TOO_LARGE` | body-parser 413 → `PAYLOAD_TOO_LARGE` | (none) |
| Path param type | `MethodArgumentTypeMismatchException` on a `@PathVariable`, `MissingPathVariableException` → `INVALID_PARAMETER` | `HttpException` 400 (Parse*Pipe) → `INVALID_PARAMETER` | (none) |
| Method | `HttpRequestMethodNotSupportedException` → `METHOD_NOT_ALLOWED` | `HttpException` 405 → `METHOD_NOT_ALLOWED` | P3-R6 exception |
| Unknown route | `NoResourceFoundException`, `NoHandlerFoundException` → `ENDPOINT_NOT_FOUND` | `HttpException` 404 → `ENDPOINT_NOT_FOUND` (features never throw `NotFoundException`) | catch-all route → `ENDPOINT_NOT_FOUND` |
| Not signed in | `AuthenticationEntryPoint` → `UNAUTHENTICATED` | `HttpException` 401 → `UNAUTHENTICATED` | `requireCaller` → `UNAUTHENTICATED` |
| Forbidden | `AccessDeniedHandler` **and** an advice handler for `AccessDeniedException`/`AuthorizationDeniedException` (method security throws inside MVC) → `ACCESS_DENIED` | `HttpException` 403 → `ACCESS_DENIED` | `requireCaller` → `ACCESS_DENIED` |
| Other tenant's row | `CrossTenantDeniedException` → `RESOURCE_NOT_FOUND` | `CrossTenantDeniedError` → `RESOURCE_NOT_FOUND` | `CrossTenantDeniedError` → `RESOURCE_NOT_FOUND` |
| Other framework statuses | — | `HttpException` 409 → `BUSINESS_CONFLICT`, 422 → `BUSINESS_RULE_VIOLATION`, 429 → `RATE_LIMIT_EXCEEDED`, any other 4xx → `INVALID_PARAMETER`, 5xx → `INTERNAL_ERROR` | — |
| Third-party provider | `ProviderUnavailableException` → `DEPENDENCY_UNAVAILABLE`; `ProviderProtocolException` and an unmapped `ProviderRejectedException` → `BAD_GATEWAY` | the same with the `*Error` classes | — |
| Everything else | `INTERNAL_ERROR`, logged at ERROR with the stack | same | same (P3-R7, P3-R8) |

### Validator → `details[].code`

Codes: `REQUIRED`, `INVALID_FORMAT`, `INVALID_TYPE`, `TOO_SHORT`, `TOO_LONG`, `OUT_OF_RANGE`, `INVALID_VALUE`, `ALREADY_EXISTS`. Anything not listed → `INVALID_VALUE`.

| Code | Bean Validation | class-validator | zod 3 |
|---|---|---|---|
| `REQUIRED` | `NotNull`, `NotBlank`, `NotEmpty` | `isDefined`, `isNotEmpty` | `invalid_type` with `received === 'undefined'` |
| `INVALID_FORMAT` | `Email`, `Pattern` | `isEmail`, `matches`, `isUuid`, `isUUID`, `isUrl`, `isISO8601`, `isDateString` | `invalid_string` |
| `INVALID_TYPE` | type mismatch on binding | `isString`, `isInt`, `isNumber`, `isBoolean`, `isArray`, `isObject` | `invalid_type` (other `received`) |
| `TOO_SHORT` | `Size` when the value is shorter than `min` | `minLength`, `arrayMinSize` | `too_small` with `type` `string` or `array` |
| `TOO_LONG` | `Size` when the value is longer than `max` | `maxLength`, `arrayMaxSize` | `too_big` with `type` `string` or `array` |
| `OUT_OF_RANGE` | `Min`, `Max`, `DecimalMin`, `DecimalMax`, `Positive`, `PositiveOrZero`, `Negative`, `NegativeOrZero`, `Past`, `Future`, `PastOrPresent`, `FutureOrPresent` | `min`, `max`, `isPositive`, `isNegative` | `too_small` / `too_big` with `type` `number`, `bigint` or `date` |
| `INVALID_VALUE` | anything else | `isEnum`, `isIn`, `whitelistValidation`, anything else | `invalid_enum_value`, anything else |

`details[].message` is the validator's rule text, which never contains the submitted value. One detail per (field, constraint).

### Paging

`page` and `size` query params, 0-based. P3-R10 bounds. `totalPages = totalElements === 0 ? 0 : ceil(totalElements / size)`, `hasNext = page + 1 < totalPages`, `hasPrevious = page > 0`. Next.js URLs shown to users stay 1-based: `apiPage = urlPage - 1`, converted in `page.tsx` only.

---

## Test hits that change, assigned to exactly one task

| Test (file:line) | Current needle | Task |
|---|---|---|
| `catalog-nest.test.js:161` | `'RFC 7807'` in nest rules | 6 |
| `catalog-nest.test.js:283-284` | filter/problem-details have no `.message`; `'application/problem+json'` | 5 (keep the `.message` check, now on `all-exceptions.filter.ts` + `api-response.ts` + `api-error.ts`; replace the problem+json needle) |
| `catalog-nest.test.js:580-606` | `RFC 7807` title/needle; `extends ProblemError` in `customer-profile.errors.ts` | 6 |
| `catalog-nest.test.js:639` | `extends ProblemError` in provider errors | 7 |
| `catalog-nest.test.js:783` | `{ page: 1001 }` in e2e spec | 6 (becomes `{ page: 1000 }`, the first invalid 0-based page) |
| `catalog-next.test.js:329` | `ActionResult` / `ActionErrorCode` exports | 8 |
| `catalog-next.test.js:572-573` | `ActionErrorCode.*`, `parsed.error.flatten().fieldErrors` in service | 9 |
| `catalog-next.test.js:610, 630` | `ActionErrorCode.FORBIDDEN` in data.ts; `pageQuerySchema`/`PageDto` in pagination | 10 |
| `catalog-next.test.js:639-659` | RFC 7807 route handler test (`problemForRefusal`, `about:blank`, `ACTION_ERROR_STATUS`, status literals) | 9 |
| `catalog-next.test.js:711-715` | `requireCaller(` before input parse | 9 (kept; `requireCaller` now throws instead of returning `{ ok }`) |
| `catalog-spring.test.js:491, 501` | `safeRequestIdOrNew` in Kafka consumer | unchanged (P3-R2) |

Anything else that turns red was missed by this table: fix it in the task that turned it red and add the row in the task report.

---

### Task 1: Core rules carry the envelope contract

**Files:**
- Modify: `catalog/core/rules/backend-api.md` (the Essentials bullet "Return errors as RFC 7807…")
- Modify: `catalog/core/rules/error-handling.md` (Essentials "one consistent error response shape (problem+json)"; Detail "stable machine-readable code…")
- Modify: `catalog/core/rules/security.md` (the CORS line, P3-R14)
- Test: `test/catalog-cross-stack.test.js`

**Interfaces:**
- Produces: the rule wording that the stack rules (Tasks 3, 6, 9) point back to: "the common envelope (`success`, `data` | `error`), `errorNumber` `SSCCNNN`, `supportCode`". No code.

- [ ] **Step 1: Write the failing test** `core rules define the common envelope, not problem+json`:
  - the rendered `core-backend-api` and `core-error-handling` contain none of `RFC 7807`, `problem+json`;
  - together they contain each of `success`, `data`, `error`, `errorNumber`, `errorCode`, `supportCode`, `requestId`, `SSCCNNN`, `200`, `204`;
  - Essentials of each file ≤ 15 bullets;
  - `security.md` contains `x-support-code`.
- [ ] **Step 2: Run** `node --test test/catalog-cross-stack.test.js` → FAIL on the RFC 7807 assertion.
- [ ] **Step 3: Rewrite the bullets.**
  - Errors: one envelope for 4xx and 5xx; `message` is a constant summary per `errorCode`; `error.errorNumber` `SSCCNNN` names the origin service; `errorCode` is the frontend's translation key.
  - Success: `data` only, no `message`, `200`/`201`, never `204`.
  - Controllers return data or throw; a shared layer wraps.
  - Every response carries `supportCode` and `requestId`, and the same values in `x-support-code` and `x-request-id`.
  - Keep the "stable code + request id" Detail bullet, reworded to the new names.
- [ ] **Step 4: Run** `node --test test/catalog-cross-stack.test.js test/catalog.test.js` → PASS. Then run `node bin/stackcrew.js plugin` and the full `npm test` → all pass.
- [ ] **Step 5: Commit** `feat(core): rules define the common response envelope instead of problem+json`.

---

### Task 2: Spring correlation: `requestId` (UUID), `supportCode`, headers, request attributes

**Files:**
- Modify: `catalog/stacks/spring-boot/skills/stackcrew-spring-request-logging/LogFields.java.md`
- Modify: `catalog/stacks/spring-boot/skills/stackcrew-spring-request-logging/HttpLoggingFilter.java.md` (line ≈175, where the request id is chosen)
- Modify: `catalog/stacks/spring-boot/skills/stackcrew-spring-request-logging/SKILL.md` (line 81, "short and plain")
- Test: `test/catalog-spring.test.js`

**Interfaces:**
- Produces:
  - `LogFields.SUPPORT_CODE = "supportCode"` (MDC and log key);
  - `LogFields.SUPPORT_CODE_HEADER = "x-support-code"`;
  - `LogFields.REQUEST_ID_ATTRIBUTE`, `LogFields.SUPPORT_CODE_ATTRIBUTE` (public request-attribute names);
  - `static String requestIdOrNew(String incoming)`: a UUID when `incoming` parses as a UUID, else a new random UUID;
  - `static String newSupportCode()`: P3-R3.
  - `HttpLoggingFilter` sets both attributes and both MDC keys, writes both response headers **before** `chain.doFilter`, and adds `supportCode` to the `http_in` line.

- [ ] **Step 1: Write the failing test** `spring correlation: UUID request id, supportCode in MDC, attributes and headers before the chain`. Needles:
  - `LogFields.java`: `requestIdOrNew(`, `UUID.fromString(`, `newSupportCode()`, `nextInt(26)`, `SecureRandom`, `"x-support-code"`, `"supportCode"`;
  - `HttpLoggingFilter.java`: `LogFields.requestIdOrNew(request.getHeader(LogFields.REQUEST_ID_HEADER))`, `request.setAttribute(LogFields.SUPPORT_CODE_ATTRIBUTE`, `response.setHeader(LogFields.SUPPORT_CODE_HEADER`, `MDC.put(LogFields.SUPPORT_CODE`;
  - `MDC.remove(LogFields.SUPPORT_CODE)` inside a `finally`;
  - the index of `setHeader(LogFields.SUPPORT_CODE_HEADER` is smaller than the index of `chain.doFilter(` / `filterChain.doFilter(`;
  - `SKILL.md` contains `UUID` and not `short and plain`.
- [ ] **Step 2: Run** `node --test test/catalog-spring.test.js` → FAIL.
- [ ] **Step 3: Implement** in the two siblings and `SKILL.md`:
  - `safeRequestIdOrNew` stays for message headers (P3-R2);
  - `SKILL.md` gains a short "Correlation" paragraph: the attribute names, the headers set before the chain (so security rejections carry them), and `supportCode` never read from a request.
- [ ] **Step 4: Scratch-verify** in `p3-spring` (Boot 3.x, `spring-boot-starter-web` + `security` + `test`):
  - copy the two classes;
  - a `MockMvc` test proves that a 401 from the security chain carries both headers, with values matching `^[A-Z]{6}$` and a UUID;
  - a non-UUID `x-request-id` is replaced;
  - a UUID one is kept.
  
  Record the commands and results.
- [ ] **Step 5: Run** `node bin/stackcrew.js plugin` and `npm test` → all pass.
- [ ] **Step 6: Commit** `feat(spring): UUID request id, supportCode and correlation headers from HttpLoggingFilter`.

---

### Task 3: Spring envelope, error handling, security handlers, paging, ArchUnit

**Files** (each new file is a sibling in `catalog/stacks/spring-boot/skills/stackcrew-spring-rest-endpoint/` with header `Goes to \`src/main/java\`, package \`{{sc:basePackage}}.common.api\`, as \`X.java\``):
- Create:
  - `ApiResponse.java.md` (sealed interface + the `SuccessResponse`/`ErrorResponse` records + `ErrorPayload`, `ErrorDetail`);
  - `PageData.java.md` (+ `Pagination`), `PageQuery.java.md`;
  - `ErrorCode.java.md`, `CommonErrorCode.java.md`, `DetailCode.java.md`, `ErrorNumbers.java.md`;
  - `ApiException.java.md`, `UpstreamApiException.java.md`;
  - `RawResponse.java.md`, `ApiResponseAdvice.java.md`, `GlobalExceptionHandler.java.md`;
  - `ApiSecurityHandlers.java.md` (`AuthenticationEntryPoint` + `AccessDeniedHandler` writing `ErrorResponse` through the injected `ObjectMapper`);
  - `ServiceNumberProperties.java.md`, `ValidationDetails.java.md` (the Bean Validation → `DetailCode` table);
  - `EnvelopeOpenApiCustomizer.java.md` (springdoc `OperationCustomizer`: every `@RestController` operation's 2xx schema becomes `SuccessResponse` wrapping the return type, plus one global `ErrorResponse` for 4xx/5xx; spec §6; skipped for `@RawResponse`);
  - `VoidEnvelopeReturnValueHandler.java.md` only if Step 1 yields outcome B (P3-R5).
- Modify:
  - `catalog/stacks/spring-boot/skills/stackcrew-spring-rest-endpoint/SKILL.md` (§4 "Errors as ProblemDetail" → envelope; §5 pagination → `PageQuery`/`PageData`; create example keeps `ResponseEntity.created(location).body(dto)`);
  - `catalog/stacks/spring-boot/rules.md` (lines 18, 46-58: ProblemDetail rule and snippet; remove `spring.mvc.problemdetails.enabled`; line 127 CORS clause; add the `String`-return ban);
  - `catalog/stacks/spring-boot/testing.md` and `catalog/stacks/spring-boot/skills/stackcrew-spring-boot-testing/SKILL.md` (`ProblemDetail` mentions);
  - `catalog/stacks/spring-boot/skills/stackcrew-spring-jpa-entity/CrossTenantDeniedException.java.md` and its `SKILL.md` (the comment and mapping now say `RESOURCE_NOT_FOUND`);
  - `catalog/stacks/spring-boot/wire/StackcrewArchitectureTest.java` (new `@ArchTest` method `SC-ENVELOPE`).
- Test: `test/catalog-spring.test.js`, `test/wire-java.test.js`

**Interfaces:**
- Consumes (Task 2): `LogFields.REQUEST_ID_ATTRIBUTE`, `LogFields.SUPPORT_CODE_ATTRIBUTE`.
- Produces (Tasks 4 and 12 rely on these):
  - `ApiException(ErrorCode code)`, `ApiException(ErrorCode code, List<ErrorDetail> details)`;
  - `UpstreamApiException(HttpStatus status, ErrorPayload payload, String summary)`;
  - `ErrorNumbers.format(String serviceNumber, ErrorCode code)`;
  - `CommonErrorCode` rows exactly as in the contract table;
  - `DetailCode` values exactly as in the contract;
  - `ApiResponse.success(T data, String supportCode, String requestId)` and `ApiResponse.failure(String summary, ErrorPayload error, String supportCode, String requestId)` as the only factories (the record constructors are package-private).

- [ ] **Step 1: Scratch matrix first** (in `p3-spring`, before any content). Wire the advice and handler from the spec and record PASS/FAIL per row:

  | Controller method | Expected |
  |---|---|
  | returns DTO | 200 envelope |
  | `@ResponseStatus(CREATED)` returning DTO | 201 envelope |
  | `ResponseEntity.created(uri).body(dto)` | 201 envelope + `Location` |
  | `void` (no annotation) | 200, `data: null` (decides P3-R5 outcome A or B) |
  | `void` + `@ResponseStatus(OK)` | no body (confirms the SC-ENVELOPE ban) |
  | returns `String` | `ClassCastException` or a plain string (confirms the ban) |
  | returns `Resource` / `StreamingResponseBody` / `SseEmitter` | unwrapped |
  | `@RawResponse` | unwrapped |
  | `/actuator/health`, `/v3/api-docs` | unwrapped |
  | throws `ApiException(CommonErrorCode.BUSINESS_CONFLICT)` | 409 error envelope |
  | `@PreAuthorize` denied inside MVC | 403 `ACCESS_DENIED` (not 500) |
  | unauthenticated | 401 `UNAUTHENTICATED` from the entry point, with headers |
  | malformed JSON / wrong content type / unknown path / wrong method | 400 / 415 / 404 / 405 envelopes |
  | `@Valid` body with nested + list violations | `VALIDATION_FAILED`, details `address.city`, `items[1].sku`, codes per table |
  | `PageQuery` with `page=-1`, `page=1000`, `size=0`, `size=500` | 400, 400, 400, 200 with `size: 100` |
  | `app.service-number` missing or `7` | context fails to start |

- [ ] **Step 2: Write the failing tests**:
  - `spring envelope: sealed success/error types, the error table and the formatter`: needles `sealed interface ApiResponse`, `@JsonInclude(JsonInclude.Include.ALWAYS)` on `data`, every `CommonErrorCode` row as `VALIDATION_FAILED(10, 1, "VALIDATION_FAILED", HttpStatus.BAD_REQUEST, "Request validation failed")` (one assertion per table row), `String.format("%s%02d%03d"`, `@Pattern(regexp = "\\d{2}")`;
  - `spring envelope: void handler yields data null and SC-ENVELOPE bans the early-return shapes`;
  - `spring security handlers and the advice answer the envelope with the filter's ids`: needles `implements AuthenticationEntryPoint`, `implements AccessDeniedHandler`, `AuthorizationDeniedException`, `request.getAttribute(LogFields.SUPPORT_CODE_ATTRIBUTE)`;
  - `spring advice skips streams, resources, emitters and @RawResponse`: needles `instanceof Resource`, `StreamingResponseBody`, `ResponseBodyEmitter`, `RawResponse.class`, `basePackages = "{{sc:basePackage}}"`;
  - `spring rules and skills no longer mention ProblemDetail or problemdetails.enabled`: grep the whole `catalog/stacks/spring-boot` → no `ProblemDetail`, no `problemdetails`;
  - `spring paging: PageQuery bounds and PageData.of`: needles `@Min(0)`, `@Max(PageQuery.MAX_PAGE - 1)`, `@Min(1)`, `Math.min(size, MAX_PAGE_SIZE)`, `MAX_PAGE = 1000`, `hasPrevious`;
  - `spring OpenAPI shows the envelope`: needles `implements OperationCustomizer`, `SuccessResponse`, `ErrorResponse`, `RawResponse`;
  - in `test/wire-java.test.js`: `wire template declares SC-ENVELOPE as an @ArchTest method` (it names `String`, `ResponseStatus`, `NO_CONTENT`, `RawResponse`).
- [ ] **Step 3: Run** `node --test test/catalog-spring.test.js test/wire-java.test.js` → FAIL.
- [ ] **Step 4: Write the siblings, rules and ArchUnit rule** from the contract tables.
  - `GlobalExceptionHandler` follows the Spring column of "Framework exception → error code". Unknown → `INTERNAL_ERROR` with `log.error` and the stack.
  - `ValidationDetails` follows the Bean Validation column. `Size` is decided by comparing the rejected value's length to the `min`/`max` attributes.
  - `rest-endpoint/SKILL.md` gets a file table listing every new sibling, and stays ≤ 350 lines.
- [ ] **Step 5: Re-run the scratch matrix** with the exact sibling code (copied, `{{sc:basePackage}}` replaced) → every row as expected. Record the results in the task report.
- [ ] **Step 6: Run** `node bin/stackcrew.js plugin` and `npm test` → all pass (update the `test/e2e.test.js` expected file set if it lists skill siblings, P3-R15).
- [ ] **Step 7: Commit** `feat(spring): common response envelope, error table, security handlers, paging and SC-ENVELOPE`.

---

### Task 4: Spring internal-service client mode

**Files:**
- Create: `catalog/stacks/spring-boot/skills/stackcrew-spring-integration-provider/InternalServiceErrors.java.md` (package `{{sc:basePackage}}.common.api`)
- Modify: `catalog/stacks/spring-boot/skills/stackcrew-spring-integration-provider/SKILL.md` (new section "Calling another internal service"; the existing provider playbook stays for third parties)
- Modify: `catalog/stacks/spring-boot/rules.md` (one line under outbound calls pointing to the new section)
- Test: `test/catalog-spring.test.js`

**Interfaces:**
- Consumes (Task 3): `UpstreamApiException`, `ApiException`, `CommonErrorCode`, `ErrorPayload`.
- Produces:
  - `static <T> T InternalServiceErrors.unwrap(ResponseEntity<String> response, Class<T> dataType, ObjectMapper mapper)`: returns `data` on a success envelope; otherwise throws per P3-R16;
  - `static ApiException InternalServiceErrors.onTransportFailure(Throwable cause)`: maps a timeout to `GATEWAY_TIMEOUT` and anything else to `DEPENDENCY_UNAVAILABLE`.
  - The `RestClient` call keeps retry/breaker from the provider playbook and calls `unwrap` after retries are exhausted.

- [ ] **Step 1: Write the failing test** `spring internal client: upstream classification table`. Needles in the sibling:
  - `HttpStatus.UNAUTHORIZED`, `HttpStatus.FORBIDDEN` → `CommonErrorCode.DEPENDENCY_UNAVAILABLE`;
  - `is5xxServerError()` → `HttpStatus.BAD_GATEWAY` in `new UpstreamApiException(`;
  - `CommonErrorCode.BAD_GATEWAY` for a non-envelope body;
  - `SocketTimeoutException` → `GATEWAY_TIMEOUT`.
  
  In `SKILL.md`: `upstreamErrorNumber`, `upstreamSupportCode`, `upstreamRequestId`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the sibling and the section. The `http_out` line written by `LoggingClientInterceptor` gets the three `upstream*` fields when the body is an envelope.
- [ ] **Step 4: Scratch-verify** in `p3-spring` with WireMock. Rows:
  - success envelope → data;
  - 404 envelope `0530101` → `UpstreamApiException` with 404 and the same `errorNumber`;
  - 500 envelope → 502 with B's `errorNumber`;
  - 401 envelope → `DEPENDENCY_UNAVAILABLE`;
  - HTML 502 → `DEPENDENCY_UNAVAILABLE`;
  - 200 non-envelope → `BAD_GATEWAY`;
  - a delay over the read timeout → `GATEWAY_TIMEOUT`.
  
  Through `GlobalExceptionHandler`, the 404 row's response body carries `0530101` and A's own `supportCode`.
- [ ] **Step 5: Run** `node bin/stackcrew.js plugin` and `npm test` → all pass.
- [ ] **Step 6: Commit** `feat(spring): internal-service client keeps the origin errorNumber`.

---

### Task 5: NestJS infra: correlation, envelope, filter, transform interceptor, service number

**Files** (all in `catalog/stacks/nestjs/skills/stackcrew-nest-request-logging/`):
- Create:
  - `api-response.ts.md` (Goes to `src/common/api/api-response.ts`);
  - `error-codes.ts.md` (`src/common/api/error-codes.ts`: `ErrorDefinition`, `CommonError`, `DetailCode`, `formatErrorNumber`);
  - `api-error.ts.md` (`src/common/api/api-error.ts`: `ApiError`, `UpstreamApiError`, deprecated `ProblemError` alias per P3-R1);
  - `validation-details.ts.md` (`src/common/api/validation-details.ts`: class-validator → `ErrorDetail[]`);
  - `transform.interceptor.ts.md`, `raw-response.decorator.ts.md`, `api-envelope-response.decorator.ts.md` (Swagger);
  - `api-response.spec.ts.md` (covers the formatter, `undefined` → `null`, the validation mapping, the filter table).
- Delete: `problem-details.ts.md`
- Modify:
  - `all-exceptions.filter.ts.md` (builds `ApiFailure` with the NestJS column of the mapping table);
  - `common.module.ts.md` (adds `provide: APP_INTERCEPTOR, useClass: TransformInterceptor`; ValidationPipe `exceptionFactory: requestValidationError` stays);
  - `request-context.ts.md` (`supportCode` in `RequestContext`, `newSupportCode`, `requestIdOrNew`, `runAsSystem` and `contextFromMessageHeaders` generate a code);
  - `http-logging.middleware.ts.md` (`requestIdOrNew`, set both headers before `next()`, `supportCode` on the line);
  - `log-fields.ts.md` (`supportCode`, `upstream*` on `CallLogLine`);
  - `env.ts.md` + `env.spec.ts.md` (`SERVICE_NUMBER`, `@Matches(/^\d{2}$/)`, required);
  - `request-context.spec.ts.md`;
  - `SKILL.md` (file table, "Errors" section, line 97 "short and plain" → UUID).
- Test: `test/catalog-nest.test.js`

**Interfaces:**
- Produces (Tasks 6, 7 and 12 rely on these): the TS column of the names table, verbatim. Also:
  - `class ApiError extends Error { constructor(readonly definition: ErrorDefinition, readonly details: readonly ErrorDetail[] = []) }`;
  - `class UpstreamApiError extends Error { constructor(readonly status: number, readonly payload: ErrorPayload, readonly summary: string) }`;
  - `function toFailure(exception: unknown, serviceNumber: string): { status: number; body: Omit<ApiFailure, 'timestamp' | 'supportCode' | 'requestId'> }` (the filter adds the correlation fields from the request context);
  - `function successEnvelope<T>(data: T | undefined, ids: { supportCode: string; requestId: string }): ApiSuccess<T | null>`;
  - `RAW_RESPONSE_KEY` and `RawResponse(): CustomDecorator<string>` (`raw-response.decorator.ts`);
  - `ApiEnvelopeResponse(model: Type<unknown>, options?: { status?: 200 | 201; page?: boolean }): MethodDecorator` (`api-envelope-response.decorator.ts`, spec §6).

- [ ] **Step 1: Write the failing tests**:
  - `nest envelope: error table, formatter and DetailCode match the contract` (one needle per table row, e.g. `VALIDATION_FAILED: { category: 10, seq: 1, code: 'VALIDATION_FAILED', status: 400, summary: 'Request validation failed' }`; `padStart(2, '0')`, `padStart(3, '0')`);
  - `nest envelope: undefined becomes data null` (needle `data: data === undefined ? null : data`, or the equivalent the implementer chooses, plus the spec file covers it: `toEqual(expect.objectContaining({ data: null }))`);
  - `nest transform interceptor skips streams, SSE, @Res and @RawResponse` (needles `instanceof StreamableFile`, `RAW_RESPONSE_KEY`, `SSE_METADATA`, `ROUTE_ARGS_METADATA` or the Context7-verified way to detect `@Res()`);
  - `nest filter answers body-parser and unknown-route errors with the envelope and headers` (`x-support-code` header set in the middleware before `next()`; the filter covers 413, 415, 400 body-parser, `HttpException` 404 → `CommonError.ENDPOINT_NOT_FOUND`);
  - `nest correlation: UUID request id for HTTP, supportCode in every context` (`requestIdOrNew(req.header(REQUEST_ID_HEADER))`, `randomInt(0, 26)`, `supportCode: newSupportCode()` in `runAsSystem` and `contextFromMessageHeaders`);
  - **change** `catalog-nest.test.js:282-284`: the no-`.message` regex now runs over `all-exceptions.filter.ts` + `api-response.ts` + `api-error.ts`; the `'application/problem+json'` needle is replaced by `success: false` and `stackFrames(exception)`.
- [ ] **Step 2: Run** `node --test test/catalog-nest.test.js` → the new tests FAIL.
- [ ] **Step 3: Implement** the siblings.
  - The filter logs `INTERNAL_ERROR` with `stackFrames(exception)` as today.
  - `validation-details.ts` keeps the nested-path flattening of the old `flatten()` and emits one detail per constraint key, `code` from the class-validator column.
  - The interceptor wraps with `successEnvelope(value, ids)`.
- [ ] **Step 4: Scratch-verify** in `p3-nest` (Nest 10 + supertest). Rows:
  - DTO → 200 envelope;
  - POST → 201;
  - `async remove(): Promise<void>` → `data: null`;
  - `StreamableFile` and `@Sse()` unwrapped;
  - `@RawResponse()` unwrapped;
  - nested/array validation details;
  - malformed JSON 400, 413, 415, unknown route 404 envelopes with headers;
  - `ApiError` 409;
  - `SERVICE_NUMBER=7` fails boot.
- [ ] **Step 5: Run** `node bin/stackcrew.js plugin` and `npm test` → all pass (rest-endpoint and outbound still compile against the `ProblemError` alias; no test asserts on it).
- [ ] **Step 6: Commit** `feat(nest): common response envelope, filter, transform interceptor and supportCode`.

---

### Task 6: NestJS REST endpoint on the envelope

**Files** (in `catalog/stacks/nestjs/skills/stackcrew-nest-rest-endpoint/`):
- Modify:
  - `customer-profile.errors.ts.md` (`CustomerProfileNotFound extends ApiError` with `{ category: 30, seq: 101, code: 'RESOURCE_NOT_FOUND', status: 404, summary: 'The resource does not exist' }`);
  - `customer-profile-page.response.ts.md` (becomes `PageData<CustomerProfileResponse>` via `toPageData`);
  - `customer-profile.mapper.ts.md`, `list-customer-profiles.query.ts.md` (`page` default `0`, `@Min(0) @Max(MAX_PAGE - 1)`; `size` `@Min(1)` then capped);
  - `customer-profiles.controller.ts.md` (`@ApiEnvelopeResponse(...)`; return data only);
  - `customer-profiles.service.ts.md`, `customer-profiles.service.spec.ts.md`, `customer-profiles.e2e.spec.ts.md` (envelope bodies, `{ page: 1000 }` → 400, `size: 500` → `size: 100`);
  - `SKILL.md` (§ pagination, § errors, remove "RFC 7807").
- Modify: `catalog/stacks/nestjs/rules.md` (lines 18, 89, 205-208: problem+json → envelope; CORS clause), `catalog/stacks/nestjs/testing.md`, `catalog/stacks/nestjs/skills/stackcrew-nestjs-testing/SKILL.md`.
- Modify: `catalog/stacks/nestjs/skills/stackcrew-nest-request-logging/api-error.ts.md` (remove the `ProblemError` alias **only if** Task 7 is done; otherwise Task 7 removes it).
- Test: `test/catalog-nest.test.js`

**Interfaces:**
- Consumes (Task 5): `ApiError`, `CommonError`, `toPageData`, `PageData`, `ApiEnvelopeResponse`.
- Produces: nothing new.

- [ ] **Step 1: Update the failing tests.**
  - Change `catalog-nest.test.js:161` and `580-606`: `RFC 7807` → `ApiError`, `extends ProblemError` → `extends ApiError`; add needles `toPageData(`, `@ApiEnvelopeResponse(`, `@Min(0)`.
  - Change `:783`: `{ page: 1001 }` → `{ page: 1000 }`.
  - The e2e spec contains `success: true`, `pagination: expect.objectContaining({ page: 0, size: 2, totalElements: 3, totalPages: 2, hasNext: true, hasPrevious: false })`, `errorCode: 'RESOURCE_NOT_FOUND'`, and a `^\d{7}$` assertion on `errorNumber`.
  - New test `nest rules and skills no longer mention problem+json`: grep `catalog/stacks/nestjs` → no `problem+json`, no `RFC 7807`, no `ProblemError` outside `api-error.ts`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the sibling and rule changes.
- [ ] **Step 4: Scratch-verify** in `p3-nest`: the e2e spec runs green against Postgres (Testcontainers), using the exact sibling code.
- [ ] **Step 5: Run** `node bin/stackcrew.js plugin` and `npm test` → all pass.
- [ ] **Step 6: Commit** `feat(nest): REST endpoint skill on the envelope with 0-based PageData`.

---

### Task 7: NestJS outbound client: provider errors and internal-service mode

**Files** (in `catalog/stacks/nestjs/skills/stackcrew-nest-outbound-client/`):
- Modify:
  - `provider.errors.ts.md` (`ProviderError extends ApiError`; Unavailable → `CommonError.DEPENDENCY_UNAVAILABLE`; Rejected/Protocol → `CommonError.BAD_GATEWAY`);
  - `kyc-verification.errors.ts.md`;
  - `acme-kyc.client.spec.ts.md` where it asserts problem bodies;
  - `SKILL.md` (new section "Calling another internal service").
- Create: `internal-service.client.ts.md` (Goes to `src/common/http/internal-service.client.ts`) + `internal-service.client.spec.ts.md`.
- Modify: `catalog/stacks/nestjs/skills/stackcrew-nest-request-logging/api-error.ts.md` (remove the `ProblemError` alias if Task 6 did not).
- Test: `test/catalog-nest.test.js`

**Interfaces:**
- Consumes (Task 5): `ApiError`, `UpstreamApiError`, `CommonError`, `ErrorPayload`, `CallLogLine.upstream*`.
- Produces:
  - `function unwrapEnvelope<T>(status: number, body: unknown): T`: throws per P3-R16;
  - `function classifyTransportFailure(error: unknown): ApiError`: maps axios `ECONNABORTED`/`ETIMEDOUT` to `GATEWAY_TIMEOUT` and anything else to `DEPENDENCY_UNAVAILABLE`.

- [ ] **Step 1: Write the failing tests.**
  - Change `catalog-nest.test.js:639`: `extends ProblemError` → `extends ApiError`.
  - New `nest internal client: upstream classification table`: needles in the spec file, one `it(` per P3-R16 row: `'0530101'`, `502`, `DEPENDENCY_UNAVAILABLE`, `BAD_GATEWAY`, `GATEWAY_TIMEOUT`; the client logs `upstreamErrorNumber`.
  - New `nest ProblemError is gone`: no `ProblemError` anywhere in `catalog/stacks/nestjs`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Scratch-verify** in `p3-nest` with a local fake upstream (`nock` is not a catalog dependency, so use a second Nest app or `http.createServer`): all P3-R16 rows, and the 404 row reaches the client with `0530101`.
- [ ] **Step 5: Run** `node bin/stackcrew.js plugin` and `npm test` → all pass.
- [ ] **Step 6: Commit** `feat(nest): provider errors on ApiError and an internal-service client that keeps the origin errorNumber`.

---

### Task 8: Next.js infra: correlation, envelope, `ApiError`, wrappers

**Files** (in `catalog/stacks/nextjs/skills/stackcrew-next-request-logging/`):
- Create:
  - `api-response.ts.md` (Goes to `src/shared/api/api-response.ts`);
  - `error-codes.ts.md` (`src/shared/api/error-codes.ts`);
  - `api-error.ts.md` (`src/shared/api/api-error.ts`: `ApiError`, `UpstreamApiError`, `validationError(error: ZodError): ApiError`);
  - `api-route.ts.md` (`src/shared/api/api-route.ts`, P3-R7);
  - `api-response.spec.ts.md`.
  
  The same names as NestJS. The file bodies may differ only where a framework differs.
- Modify:
  - `with-action-logging.ts.md` + spec (P3-R8: returns `ApiResponse<T>`, the status from `definition.status`, the ERROR line with the stack for an unexpected throw);
  - `with-route-logging.ts.md` + spec (unchanged contract; it logs `supportCode`);
  - `request-context.ts.md`, `session-context.ts.md` (`supportCode`, `requestIdOrNew` for the request; message headers keep `safeRequestIdOrNew`);
  - `log-fields.ts.md`, `env.ts.md` + spec (`SERVICE_NUMBER: z.string().regex(/^\d{2}$/)`, server-only, required);
  - `SKILL.md` (file table; line 120 "short and plain" → UUID; the wrappers' contract).
- Keep for now: `action-result.ts.md` (deleted in Task 9, P3-R1).
- Test: `test/catalog-next.test.js`

**Interfaces:**
- Produces (Tasks 9–12 rely on these): the TS names table, plus:
  - `function apiRoute<C>(handler: (req: NextRequest, ctx: C) => Promise<unknown>, options?: { status?: 200 | 201 }): RouteHandler<C>`;
  - `withActionLogging<A extends unknown[], R>(name: string, action: (...args: A) => Promise<R>): (...args: A) => Promise<ApiResponse<R | null>>`;
  - `function validationError(error: ZodError): ApiError`: `issues` → details per the zod column, path `a.b[1].c`.

- [ ] **Step 1: Write the failing tests**:
  - `next envelope: error table, formatter and DetailCode match the contract` (same row needles as Task 5, on `error-codes.ts`);
  - `next envelope: undefined becomes data null in actions and routes`;
  - `next apiRoute passes a Response through, wraps data, honours status 201, maps ApiError, rethrows control flow, logs an unexpected throw with its stack and answers 500` (needles `instanceof Response`, `nextControlFlow(`, `unstable_rethrow` or the existing control-flow helper, `x-support-code`, `CommonError.INTERNAL_ERROR`);
  - `next action wrapper returns the envelope and logs unexpected throws itself`;
  - `next zod issues map to detail codes with bracketed array paths` (spec file has `'items[1].sku'`, `received: 'undefined'` → `'REQUIRED'`);
  - **change** `catalog-next.test.js:329`: the `ActionResult` needles become `export type ApiResponse<T>`, `export type ApiSuccess<T>`, `export type ApiFailure`.
- [ ] **Step 2: Run** `node --test test/catalog-next.test.js` → FAIL.
- [ ] **Step 3: Implement** the siblings.
- [ ] **Step 4: Scratch-verify** in `p3-next` (Next 16, Vitest + `next build && next start` smoke):
  - an action returning `undefined` → `data: null`;
  - an action throwing `ApiError` → failure envelope;
  - an action throwing `Error` → `INTERNAL_ERROR` plus one ERROR line with the stack;
  - `redirect()` inside an action still redirects;
  - `apiRoute` with 201;
  - a returned `Response` stream passes through;
  - `SERVICE_NUMBER=7` fails `next build` env validation.
- [ ] **Step 5: Run** `node bin/stackcrew.js plugin` and `npm test` → all pass.
- [ ] **Step 6: Commit** `feat(next): common response envelope, ApiError, apiRoute and the envelope-returning action wrapper`.

---

### Task 9: Next.js route handler and server action on the envelope

**Files:**
- Route handler skill (`catalog/stacks/nextjs/skills/stackcrew-next-route-handler/`):
  - Delete: `problem-details.ts.md`.
  - Modify: `route.ts.md` (`GET`/`POST` = `withRouteLogging(route, apiRoute(...))`, POST with `{ status: 201 }`), `route.spec.ts.md`, `read-json-body.ts.md` (returns the value or throws `ApiError` `MALFORMED_REQUEST`/`UNSUPPORTED_MEDIA_TYPE`), `require-caller.ts.md` (returns the caller or throws `UNAUTHENTICATED`/`ACCESS_DENIED`), `SKILL.md` (P3-R6 exception paragraph, CORS clause).
  - Create: `catch-all.route.ts.md` (Goes to `src/app/api/[...slug]/route.ts`).
- Server action skill (`catalog/stacks/nextjs/skills/stackcrew-next-server-action/`):
  - Modify: `kyc-registration.service.ts.md` (throws `ApiError`; conflict → domain definition `{ category: 40, seq: 101, code: 'KYC_ALREADY_SUBMITTED', status: 409, summary: 'A registration has already been submitted' }`), `actions.ts.md`, `actions.spec.ts.md`, `kyc-registration-form.tsx.md` + spec (`result.success`, `error.details` → `setError(field, …)`, text from `kyc-registration.messages.ts` keyed by `errorCode`/`DetailCode`), `kyc-registration.messages.ts.md`, `kyc-registration.int.spec.ts.md`, `kyc-registration.spec.ts.md`, `SKILL.md`.
- Delete: `catalog/stacks/nextjs/skills/stackcrew-next-request-logging/action-result.ts.md` and its row in that `SKILL.md`.
- Modify: `catalog/stacks/nextjs/rules.md` (line 13 typed result → envelope; lines 75-101 snippet; line 133 "Only unexpected failures throw" → spec §5.3 wording; line 140 `result.error.fieldErrors` → `error.details`).
- Test: `test/catalog-next.test.js`

**Interfaces:**
- Consumes (Task 8): `apiRoute`, `ApiError`, `validationError`, `CommonError`, `withActionLogging` → `ApiResponse`.
- Produces:
  - `requireCaller(role: string): Promise<RequestContext & { userId: string; tenantId: string }>`;
  - `readJsonBody(req: NextRequest): Promise<unknown>`.
  
  Task 10 imports both.

- [ ] **Step 1: Update the failing tests.**
  - Replace `catalog-next.test.js:639-659` with `next route handler skill: apiRoute inside withRouteLogging, zod input, the caller, the envelope`. Needles: `withRouteLogging('/api/v1/kyc-registrations', apiRoute(`, `{ status: 201 }`, `throw new ApiError(CommonError.UNAUTHENTICATED)`, `CommonError.MALFORMED_REQUEST`. Assert there is no `problem-details.ts` sibling.
  - Keep `:711-715` (caller before input).
  - Change `:572-573` to `throw new ApiError(CommonError.UNAUTHENTICATED)`, `CommonError.ACCESS_DENIED`, `validationError(parsed.error)`, `KYC_ALREADY_SUBMITTED`.
  - New `next catch-all answers ENDPOINT_NOT_FOUND` (sibling exports GET, POST, PUT, PATCH, DELETE and OPTIONS; `CommonError.ENDPOINT_NOT_FOUND`).
  - New `next has no ActionResult, problem+json or fieldErrors left`: grep `catalog/stacks/nextjs`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Scratch-verify** in `p3-next`:
  - POST without a session → 401 envelope with headers;
  - bad JSON → 400 `MALFORMED_REQUEST`;
  - a duplicate → 409 `KYC_ALREADY_SUBMITTED` with `errorNumber` ending `40101`;
  - `/api/nope` → 404 `ENDPOINT_NOT_FOUND`;
  - the form shows field errors from `details`;
  - the action's unexpected throw shows the constant text, not `error.tsx`.
- [ ] **Step 5: Run** `node bin/stackcrew.js plugin` and `npm test` → all pass.
- [ ] **Step 6: Commit** `feat(next): route handler and server action skills on the envelope; ActionResult removed`.

---

### Task 10: Next.js feature page and shared pagination

**Files** (in `catalog/stacks/nextjs/skills/stackcrew-next-feature-page/`):
- Modify:
  - `pagination.ts.md` (one shape: `PageData`/`Pagination`/`toPageData` re-exported from `src/shared/api/api-response.ts` or defined here and imported there; pick one and say which in the report; `pageQuerySchema` 0-based, size capped per P3-R10; `urlPageToApiPage(value: unknown): number` for the 1-based URL);
  - `data.ts.md` (returns `PageData<KycRegistrationRowDto>`, throws `ApiError`);
  - `data.spec.ts.md`;
  - `page.tsx.md` (P3-R9 catch-into-variable; `UNAUTHENTICATED` → `redirect`, `ACCESS_DENIED` → inline forbidden text, `RESOURCE_NOT_FOUND` → `notFound()`, otherwise rethrow);
  - `kyc-registrations-page.spec.ts.md`;
  - `SKILL.md`.
- Modify: `catalog/stacks/nextjs/skills/stackcrew-next-route-handler/route.ts.md` only if its `GET` import of the page type changes.
- Test: `test/catalog-next.test.js`

**Interfaces:**
- Consumes (Tasks 8, 9): `ApiError`, `CommonError`, `PageData`, `toPageData`.
- Produces: `urlPageToApiPage(value: unknown): number`.

- [ ] **Step 1: Update the failing tests.**
  - Change `catalog-next.test.js:610` and `:630`: `ActionErrorCode.FORBIDDEN` → `CommonError.ACCESS_DENIED`; `PageDto` → `PageData`; add needles `urlPageToApiPage(`, `totalElements`.
  - New `next page catches ApiError into a variable and calls redirect/notFound outside the try`: in `page.tsx` the index of `redirect(` and of `notFound(` is greater than the index of the closing of the `catch` block. Reuse the existing control-flow test helper if there is one.
  - The spec has `?page=1` → loader called with `page: 0`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Scratch-verify** in `p3-next`:
  - an anonymous visit redirects to sign-in;
  - a non-reviewer sees the inline forbidden text;
  - `?page=2` shows the second page;
  - past the last page shows the empty state.
- [ ] **Step 5: Run** `node bin/stackcrew.js plugin` and `npm test` → all pass.
- [ ] **Step 6: Commit** `feat(next): feature page on PageData with ApiError handling and 1-based URLs`.

---

### Task 11: Next.js `httpClient` internal-service mode

**Files:**
- Modify: `catalog/stacks/nextjs/skills/stackcrew-next-request-logging/http-client.ts.md` + `http-client.spec.ts.md` (new exported function), `SKILL.md` (section "Calling another internal service").
- Test: `test/catalog-next.test.js`

**Interfaces:**
- Consumes (Task 8): `UpstreamApiError`, `ApiError`, `CommonError`, `CallLogLine.upstream*`.
- Produces: `httpClient.internalJson<T>(url: string, init?: RequestInit): Promise<T>`, which uses `httpClient.fetch`, unwraps `data`, and throws per P3-R16 (a `TimeoutError` becomes `GATEWAY_TIMEOUT`).

- [ ] **Step 1: Write the failing test** `next internal client: upstream classification table`: one `it(` per P3-R16 row in the spec file, and the client writes `upstreamErrorNumber` on `http_out`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Scratch-verify** in `p3-next` against a local `http.createServer` fake: all P3-R16 rows.
- [ ] **Step 5: Run** `node bin/stackcrew.js plugin` and `npm test` → all pass.
- [ ] **Step 6: Commit** `feat(next): httpClient.internalJson keeps the origin errorNumber`.

---

### Task 12: Cross-stack agreement, user document v3.0, README, version 0.3.0

**Files:**
- Modify: `test/catalog-cross-stack.test.js`
- Modify: `docs/api-response-structure.md` (v3.0)
- Modify: `README.md` (any problem+json / RFC 7807 mention; one short paragraph on the envelope in Vietnamese)
- Modify: `package.json`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`0.3.0`), and whatever `test/release.test.js` pins
- Regenerate: `plugin/cli/**` via `node bin/stackcrew.js plugin`

**Interfaces:**
- Consumes: every sibling named in Tasks 3, 5 and 8.

- [ ] **Step 1: Write the failing tests** in `test/catalog-cross-stack.test.js`:
  - `cross-stack: the error table is identical in Spring, NestJS and Next.js`. Parse `(category, seq, code, status, summary)` rows out of `CommonErrorCode.java.md` (regex on `NAME(10, 1, "CODE", HttpStatus.X, "summary")`, mapping `HttpStatus` names to numbers) and out of both `error-codes.ts.md` (regex on `{ category: …, summary: '…' }`). The three row sets must be deep-equal, and must equal the contract table hard-coded in the test.
  - `cross-stack: detail code mapping tables agree`. The set of `DetailCode` values is identical in the three stacks. Each validator column in the plan's table appears in its sibling (`ValidationDetails.java.md`, `validation-details.ts.md`, `api-error.ts.md` for zod).
  - `cross-stack: no stack mentions problem+json, ProblemDetail, ActionResult or RFC 7807`: grep `catalog/`.
  - `cross-stack: correlation names agree`: `x-support-code`, `supportCode` and `SERVICE_NUMBER` / `app.service-number` each appear in the three stacks.
- [ ] **Step 2: Run** → FAIL only if a stack drifted. Fix the drifting sibling in this task.
- [ ] **Step 3: Rewrite `docs/api-response-structure.md` to v3.0** per spec §8:
  - platform line: Spring Boot, NestJS, Next.js;
  - no `message` on success;
  - `supportCode` instead of `traceId`;
  - no 204;
  - `errorNumber` `SSCCNNN` with the contract table;
  - §4.3 multi-service rules;
  - Java DTO section replaced by the sealed types;
  - checklist updated.
- [ ] **Step 4: Bump to `0.3.0`** in every file listed. Run `node bin/stackcrew.js plugin`.
- [ ] **Step 5: Run** the full `npm test`, the e2e tests included → all pass. Record the final count; it must be ≥ 465 + the tests added.
- [ ] **Step 6: Commit** `feat: cross-stack envelope agreement, response structure v3.0 and 0.3.0`.
