# Cross-stack decisions settled during execution (binding for Tasks 7–10)

From Task 6 (Spring), so Nest and Next behave the same:

Masker details (in addition to the plan's Masker contract):
- CT = media type without parameters, lowercased, CR/LF removed; `unknown` when missing.
- Empty or null body → no `reqBody`/`resBody` field at all.
- Repeated form key → last value wins; a key with no `=` gets value `""`.
- Digits are NOT a word boundary (`address2` is not masked; `homeAddress` is).
- Base64 N uses the payload length as is (including any CR/LF), per the contract formula.
- Request bodies over the framework's body-cache cap, or never read by the handler → `<CT N bytes>` with N from `Content-Length`.

Cross-tenant roles at runtime:
- Spring reads `app.tenancy.cross-tenant-roles` (record `TenancyProperties`), defaulting to the conventions list.
- Node (Nest, Next) reads env `CROSS_TENANT_ROLES` (comma-separated), defaulting to the conventions list rendered into the env schema/config default.

Tenant safety:
- Spring found that before Hibernate 6.6 load-by-id ignored `@TenantId`; guarded with a `@PostLoad` check. TypeScript: `TenantScopedRepository` must apply the tenant condition to every read, count, update, delete and soft delete, including by-id lookups. Tenant-entity writes go only through `TenantScopedRepository` (no explicit-condition escape hatch); a by-id lookup of another tenant's row behaves as not found.
- Native/raw SQL on tenant tables is banned.

Context for jobs and consumers: Spring uses `TenantContext.runAs(tenantId, userId, work)`; TypeScript uses `runWithRequestContext(ctx, fn)` with the same meaning.

System identity (from the Task 6 review):
- `runCrossTenant` accepts the system identity ONLY when the context was created by the job/consumer runner (Spring `TenantContext.runAs`; TypeScript `runWithRequestContext` called from a job/consumer entry point with a `system: true` marker on the context), never because a request token's `sub` equals `systemUser`. TypeScript: add `system?: boolean` to `RequestContext`; auth code never sets it.

Request logging (from the Task 6 review):
- The inbound log line must be written for every request, including those rejected by authentication (401/403) — register the logging step before authentication and read userId/tenantId when the line is written.
- Context (MDC / AsyncLocalStorage) is cleared on every exit path, including when writing the response throws; absent values are removed, never left from a previous request.
- Streaming responses and file downloads are not buffered; they log a placeholder.
- An outbound call whose response read fails still logs one `http_out` line (status/error, no body).

System identity (amended after the Task 6 re-review — supersedes the "system: true marker" note above where they differ):
- Only a dedicated job entry point grants the system identity: Spring `TenantContext.runAsSystem(tenantId, work)`; TypeScript `runAsSystem<T>(tenantId: string | undefined, fn: () => Promise<T>): Promise<T>`, which sets `RequestContext.system = true`.
- `runAs(tenant, userId)` / `runWithRequestContext(ctx, fn)` never grant it, whatever the userId string; `RequestContext.system` is set only by `runAsSystem`.
- Consumers build their context from `x-tenant-id` / `x-user-id` / `x-request-id` (values sanitized like the HTTP request id) and never become system from a header.

Request logging coverage:
- The inbound logging step runs before CORS/CSRF filters, so CORS rejections are logged; SSE requests are logged (bodies not buffered).
- Only maskable types (`application/json`, `*+json`, `application/x-www-form-urlencoded`) are buffered for masking, on non-streaming requests; everything else passes straight through with headers intact (Content-Length preserved) and logs a placeholder.

Request bodies (parity note from Task 6 re-review): cache/buffer only maskable request bodies (JSON, *+json, form); other request bodies log a placeholder with Content-Length and are never buffered just for logging.
Supersedes plan-context "Cross-stack names" TypeScript line "or userId equals systemUser": cross-tenant passes only for roles in CROSS_TENANT_ROLES or inside runAsSystem.

Skill sibling code files (ruling R-T7-c): ship as `<file>.md` — first line "Goes to `<path>`." then exactly one fenced code block; never a file matching the stack's globs (.ts/.tsx for Next). The validator enforces it.
Template variable `crossTenantRolesCsv`: roles joined with "," (no spaces/backticks), empty list → "" — use it for the Node `CROSS_TENANT_ROLES` default.
Nest names (R-T7-e): inbound line written by `httpLoggingMiddleware` registered in `setupApp`; `CommonModule`; outbound `OutboundHttpLogger`.

Masker contract amendment (Task 7 review, all stacks):
- Nesting depth > 64 (objects/arrays) → the whole body becomes the `<CT N bytes>` placeholder. The walk is depth-capped or iterative; never unbounded recursion.
- Logging never throws: if masking or writing fails, the one line is still written with a placeholder body, and the request/outbound call/message result is never changed by logging.
Log fields: `traceId`/`spanId` (camelCase) come from the active OpenTelemetry span when present (Node: in the pino mixin/context fields; Spring: Micrometer MDC).
Transactions: tenant entities inside a transaction go through `TenantScopedRepository.withManager(manager)`; never `manager.getRepository(Entity)` directly.
[SUPERSEDED by the JSON round-trip decision below] Masker sizing: placeholder size computation is bounded — visited set for cycles and a node/size cap (stop past maxBodyBytes); a cyclic or shared-reference value yields the placeholder and returns. Depth is checked for every object (including toJSON results, which add no level).
[PARTLY SUPERSEDED: N+ now means only "size unknown" (serialization threw)] Placeholder `<CT {maxBodyBytes}+ bytes>` = size unknown or over the cap (used only when masking failed, e.g. cyclic values). Function-valued properties are dropped from masked output (JSON.stringify omits them anyway) so a copied toJSON can never re-emit unmasked data.
Masking already-parsed values (TS): normalize by a guarded JSON round-trip first (exactly what JSON.stringify would write: toJSON applied once, functions dropped, plain arrays/objects only), then mask the plain data with the depth cap; any throw → placeholder. Never mask a live object graph directly.

Outbound idempotency (Task 8 review): the provider idempotency key is generated server-side once per business operation and stored before the call (e.g. the verification record id); field name `idempotencyKey`; never the inbound `x-request-id` or a raw client `Idempotency-Key`. Correlation goes in a separate trace reference.
Message payloads: `message_in` captures at most 2 MiB like http_in/http_out; over the cap → `<CT N bytes>`.
Broker channels: every channel/connection wrapper has an error listener that logs a structured line (no raw error message with vhost/queue names); a consumer whose setup failed reports not-ready (health) or exits on purpose with a named log line — never a silent crash or a healthy-but-idle consumer.

Provider status classification (Task 8 round 4 ruling): 5xx, 429, 409 (idempotency key in use), 401 and 403 (credential/config) → unavailable/retryable (operation stays PENDING; counts toward the breaker); 400/404/422 → refusal (terminal FAILED). A cached provider token is dropped on 401 before the retry. Side writes for a completed operation happen only when the guarded status update affected exactly 1 row (checked inside the same transaction). Spring parity is deferred to the final review.

Outcome side-write seam (Task 8): side writes for an operation's outcome go through an explicitly bound effects provider (default no-op bound in the feature module; never @Optional/undefined), called inside the status transaction only on a 1-row guarded update; effects are DB writes only (no remote calls under the row lock); a `failed` effect may be superseded by a later `completed`; effects read the outcome from the provider result, not the pre-call snapshot; an effect that throws rolls back the status write.
