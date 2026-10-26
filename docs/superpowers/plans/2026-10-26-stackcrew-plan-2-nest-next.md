# stackcrew — Plan 2: NestJS, Next.js and cross-stack rules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the TypeScript language, the NestJS and Next.js stacks, a TypeORM add-on, and two team-wide rules: entity base classes with audit and tenant scoping, and masked body logging. Retrofit Spring Boot to match. Ship as `0.2.0`.

**Architecture:**
- The engine gains three things:
  - per-project `conventions` in `stackcrew.json`, exposed as `{{sc:...}}` template variables;
  - guard rules whose globs come from `conventions` (`globsFrom`);
  - language-level lint files, plus ESLint wiring for Node projects (`sync --wire`).
- Everything else is catalog content: markdown/JSON under `catalog/`, with logic examples proven in throwaway scratch projects.

**Tech Stack:** Node.js ≥ 18.3 ESM, zero dependencies, `node:test`. The content targets:
- NestJS 10, TypeORM 0.3, Jest;
- Next.js 16 App Router, React 19, zod, Vitest, Playwright;
- Spring Boot 3.x;
- ESLint 8 (legacy) / ≥ 9 (flat), typescript-eslint 8.

**Spec:**
- `docs/superpowers/specs/2026-10-26-stackcrew-nest-next-design.md`, called "the delta". It wins on conflicts.
- On top of `docs/superpowers/specs/2026-10-24-stackcrew-design.md`, called "the base spec".
- Read both. `§` numbers below refer to the delta unless prefixed "base".

**Branch:** `feat/plan-2-nest-next`, from `main` `b914ad7` (0.1.1). Baseline: `npm test` → 299 pass.

**Tóm tắt (VI):** Plan này gồm ba phần.
- **Engine:**
  - mục `conventions` trong `stackcrew.json`;
  - guard lấy glob từ `conventions`;
  - lint file theo language;
  - `--wire` ESLint cho dự án Node.
- **Nội dung mới:** TypeScript, add-on TypeORM, NestJS, Next.js, hai rule chung (entity gốc + tenant, log body có che PII).
- **Sửa Spring Boot** cho khớp hai rule chung.

Mọi ví dụ có logic đều phải chạy thật trong project tạm.

---

## Rulings against the spec (decided while planning; the SDD controller does not re-argue them)

| # | Ruling | Why |
|---|---|---|
| P2-R1 | NestJS/Next.js `detect` uses **only** `packageDeps` (`files: []`, `contains: []`), not `files: ["package.json"]` (delta §6, §7). | `matches()` in `src/detect.js` returns true for a listed file when `contains` is empty, so `files: ["package.json"]` would match every Node repo. |
| P2-R2 | The renderer always emits **both** ESLint variants (`.stackcrew/lint/eslint.stackcrew.mjs` flat and `.stackcrew/lint/eslintrc.stackcrew.cjs` legacy). Only `sync --wire` looks at the detected ESLint major and picks one. | Rendering is pure (profile → ops) and cannot read `package.json`. |
| P2-R3 | Only JSON (`application/json`, `*+json`) and `application/x-www-form-urlencoded` bodies are masked structurally and logged. Everything else (XML/SOAP, `text/*`, missing content-type, unparseable JSON) logs a placeholder with content-type and size only. | A key-based masker cannot mask XML safely, and delta §2.3 says PII in logs is a failure. |
| P2-R4 | New convention `rolesClaim` (default `roles`): the JWT claim, or session field, that carries the user's roles for the cross-tenant check. | Delta §4.1 names `crossTenantRoles` but not where roles come from. Copied code would guess. |
| P2-R5 | Touching a tenant entity with no tenant in context **throws** where the framework allows it (TypeScript: always). On Spring with Hibernate `@TenantId`, the minimum is "returns no rows". Neither stack may ever return unfiltered rows. A test pins this. | Hibernate resolves the tenant per session; throwing from the resolver can break non-tenant work. |
| P2-R6 | Spring cross-tenant reads use `CurrentTenantIdentifierResolver.isRoot` when the Hibernate version has it (verify; expected Hibernate ≥ 6.4 = Boot ≥ 3.2). On older Boot, the skill documents the fallback the implementer verifies (a dedicated admin repository with native SQL), with the same reason log. | Team floor is Boot 3.x; the API differs across 3.x. |
| P2-R7 | Message headers carry context: `x-tenant-id`, `x-user-id`, `x-request-id`. | Delta §4.1 says "header" without names; three stacks must agree. |
| P2-R8 | Shared skills (`catalog/skills/**`, any kind) may use only `{{sc:cli}}` and `{{sc:version}}`. | The plugin build and the init interview read shared skills raw from the bundle, without a stack. |
| P2-R9 | Per stack, the infrastructure skills come first: request logging and the TypeORM entity, which the feature skills call. Feature skills follow. | The feature skills' examples call the names the infrastructure skills define. |

---

## Global Constraints

- **Plan 1 constraints still apply:** see `docs/superpowers/plans/2026-10-24-stackcrew-plan-1-core-spring-boot.md` "Global Constraints". In short:
  - zero runtime and dev dependencies; tests with `node:test` + `node:assert/strict` via `npm test`;
  - LF everywhere; content in English, README in Vietnamese;
  - budgets: always-on ≤ 6,000 B; AGENTS.md block ≤ 16,000 B (degrades per R24); Antigravity rule ≤ 24,000 B; Cursor `.mdc` ≤ 500 lines; ≤ 15 Essentials bullets; description ≤ 500 chars;
  - banned orchestration phrases and description words;
  - `{{sc:name}}` placeholders only;
  - Context7 for every library API;
  - one commit per task, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Plugin drift:** after any change under `catalog/`, `src/` or `bin/`, run `node bin/stackcrew.js plugin` before committing (`test/plugin-drift.test.js`).
- **Skills:** no `paths` key (validator rejects it). Descriptions start `Use when` and contain the stack `name` exactly: `NestJS`, `Next.js`, `Spring Boot`. New `SKILL.md` files are ≤ 350 lines; longer reference code goes into sibling files in the skill folder.
- **Guard rule ids** match `SC-[A-Z]+` (letters only after `SC-`), or `stackcrew-allow` can never waive them (`ALLOW_RE` in `src/guard/scan.js`). The new ids are `SC-TYPE`, `SC-CONST`, `SC-ENV`, `SC-IGNORE`, `SC-TYPEFILE`, and `SC-ENTITY` (ArchUnit only).
- **Test-runner traps:**
  - Node here is v22.21, where type stripping is on by default. `node --test` therefore also picks up `.ts` files.
  - No file in `catalog/`, `fixtures/` or `test/fixtures/` may be named `*.test.*`, `*-test.*`, `*_test.*`, `test-*.*` or `test.*`, or sit under a directory named `test/`.
  - Example test files use `*.spec.ts`.
  - `test/fixtures/catalog-mini/` holds no `.js`, `.mjs` or `.cjs` files.
- **Versions targeted by content:** NestJS **10** (Nest 11 APIs are not used), Next.js **16** App Router, React **19**, TypeORM **0.3**, zod **3**, next-auth **v5**, Spring Boot **3.x**. ESLint config: flat for ESLint ≥ 9, legacy for ESLint 8; typescript-eslint **8** for new installs.
- **Libraries in examples:** only those in delta §3. Plus `nestjs-pino`, and Testcontainers/supertest for Nest tests. These are new dependencies, so the example text says the agent asks the user before adding them.
- **No internal names or secrets** in `catalog/`, `fixtures/`, tests or docs: no internal package scope, no internal Git host, no credentials in URLs. The team's pasted `package.json` files are never copied.
- **Cross-stack names:** see "Cross-stack names" below. Content and examples use them exactly.
- **Masker behaviour:** see "Masker contract" below. All three language examples must pass the same table.
- **Verify before writing:** use Context7 or the official docs for these APIs before writing them in content:
  - NestJS 10 (interceptors, exception filters, `HttpService`, `ValidationPipe`, passport-jwt);
  - TypeORM 0.3 (`EntitySubscriberInterface`, `@CreateDateColumn`, which write paths call subscribers);
  - Next.js 16 (server actions, route handlers, `instrumentation.ts`, `serverExternalPackages`, `'use server'` export rules);
  - next-auth v5 `auth()`; `@t3-oss/env-nextjs`; ESLint flat config and plugin merging; typescript-eslint 8 rules;
  - Spring Data JPA auditing, Hibernate 6 `@TenantId`/`isRoot`;
  - Spring `ContentCachingRequestWrapper`/`ResponseWrapper`, `RestClient` interceptors and buffering;
  - ArchUnit, `nestjs-pino`.
- **Scratch verification:**
  - Scratch projects live under the session scratchpad, never inside the repo.
  - Each content task's report states the commands run and their outcome.
  - Docker, JDK 21, Maven 3.9, Node 22 and yarn are available on this machine.

---

## Review Focus

1. **A repo with `next-auth` or `eslint-config-next` but no `next`, or a plain Node repo with only `package.json`.**
   - Expect: no NestJS/Next.js detection; the stack stays null.
   - Owned by Task 7, test `nestjs detects only by exact package name`, and Task 9, test `nextjs detects only by exact package name and wins over nestjs`.
2. **A 0.1.1 Spring profile (no `conventions`, no `node`) on 0.2.0.**
   - Expect: it validates; `sync` exits 0; ArchUnit uses the default `BaseEntity`.
   - Owned by Task 1, test `a 0.1.1 spring profile validates and renders with default conventions`.
3. **An ESLint config shape `--wire` cannot edit** (`eslint.config.cjs`, two `export default` lines, YAML legacy config, JSONC `.eslintrc.json`).
   - Expect: exit 1 and a printed snippet; `package.json`, the ESLint config and `stackcrew.json` stay byte-identical.
   - Owned by Task 3, test `unsupported ESLint config shapes print a snippet and write nothing`.
4. **Bodies that are XML/SOAP, oversized, base64 or unparseable JSON.**
   - Expect: the Masker contract rows: placeholder, truncation, `<base64 N bytes>`.
   - Owned by Tasks 6, 7 and 9: each scratch run executes the full table.
5. **A convention key typo (`baseEnity`) or an invalid value (`"baseEntity": "Base Entity"`).**
   - Expect: a profile error naming the key; `sync` exits 1 and writes nothing.
   - Owned by Task 1, test `sync rejects a bad conventions block before writing`.

---

## Cross-stack names (used verbatim by content in Tasks 5–10)

**Conventions defaults** (`src/conventions.js`, Task 1):

| key | default |
|---|---|
| `sharedLibraries` | `[]` |
| `baseEntity` | `"BaseEntity"` |
| `baseTenantEntity` | `"BaseTenantEntity"` |
| `tenantClaim` | `"tenant_id"` |
| `tenantColumn` | `"tenantId"` |
| `rolesClaim` | `"roles"` |
| `crossTenantRoles` | `["super_admin"]` |
| `sharedComponents` | `"src/components/ui"` |
| `systemUser` | `"system"` |
| `typeFreeFiles` | `[]` |

**Template variables** (all strings), added to `RenderContext.vars`:
- `baseEntity`, `baseTenantEntity`, `tenantClaim`, `tenantColumn`, `rolesClaim`, `sharedComponents`, `systemUser`: the value as is.
- `crossTenantRoles`: each role in backticks, joined with `, `. Empty list → `none (cross-tenant access is disabled)`.
- `sharedLibraries`: each entry in backticks, joined with `, `. Empty list → `none declared (set conventions.sharedLibraries in stackcrew.json)`.
- `typeFreeFiles` is **not** a variable; it only feeds guard globs.

**Audit fields:** `createdAt`, `createdBy`, `updatedAt`, `updatedBy`. Times are UTC (`timestamptz`). The user id is the JWT `sub` claim. With no user, the value is `{{sc:systemUser}}` (default `system`).

**Message headers:** `x-tenant-id`, `x-user-id`, `x-request-id`.

**Log line fields** (one JSON line per call):
- `event` (`http_in` | `http_out` | `message_in`);
- `method`;
- `route` (inbound, templated) or `url` (outbound, sanitized);
- `target` (outbound service name);
- `status`, `durationMs`;
- `reqBody`, `resBody` (absent when body logging is off);
- context: `requestId`, `traceId`, `userId`, `tenantId`.

**Config keys:**
- Spring: `app.logging.mask-fields` (list), `app.logging.max-body-bytes` (default `16384`), `app.logging.log-bodies` (default `true`).
- Node: env `LOG_MASK_FIELDS` (comma-separated; unset **or empty** → default PII list), `LOG_MAX_BODY_BYTES` (default `16384`), `LOG_BODIES` (`false` turns bodies off; default on).

**TypeScript (Nest and Next):**
- `request-context.ts`:
  - `type RequestContext = { requestId: string; userId?: string; tenantId?: string; roles: readonly string[] }`;
  - `runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T`;
  - `currentContext(): RequestContext | undefined`;
  - `requireTenantId(): string`, which throws `MissingTenantError`;
  - `runCrossTenant<T>(reason: string, fn: () => Promise<T>): Promise<T>`, which throws `CrossTenantDeniedError` unless the context roles intersect `crossTenantRoles` or `userId` equals `systemUser`, and logs `{ event: 'cross_tenant', userId, reason }`.
- `body-masker.ts`:
  - `SECRET_FIELDS`, `DEFAULT_PII_FIELDS`;
  - `type MaskOptions = { piiFields: readonly string[]; maxBodyBytes: number }`;
  - `loadMaskOptions(): MaskOptions`;
  - `maskBody(raw: string | Buffer | undefined, contentType: string | undefined, opts: MaskOptions): unknown`;
  - `maskValue(value: unknown, opts: MaskOptions): unknown` (structural; used for already-parsed bodies).
- Entity base: `BaseEntity` and `BaseTenantEntity` (abstract classes, names from conventions).
- Audit and tenant: `AuditSubscriber` (TypeORM `EntitySubscriberInterface`), `TenantScopedRepository<T extends BaseTenantEntity>`.
- **Default locations**, used only when the project has none:
  - Nest: `src/common/context/`, `src/common/logging/`, `src/common/database/`.
  - Next: `src/shared/context/`, `src/shared/logging/`, `src/shared/db/`.
- **Nest:** `HttpLoggingInterceptor` (global, success path), `AllExceptionsFilter` (global, error path; logs through the same writer), `OutboundHttpLogger` (provider whose `onModuleInit` registers axios interceptors on `HttpService.axiosRef`).
- **Next:**
  - `withActionLogging<A extends unknown[], R>(name: string, action: (...args: A) => Promise<R>): (...args: A) => Promise<R>`;
  - `withRouteLogging(handler)` for route handlers;
  - `httpClient.fetch(target: string, input: string, init?: RequestInit): Promise<Response>`;
  - context helper `getRequestContext(): Promise<RequestContext>`, which reads the wrapper's context or calls `auth()` in Server Components.

**Java (Spring):**
- `BodyMasker` (`String mask(byte[] body, String contentType)`), `MaskingProperties` (`@ConfigurationProperties("app.logging")`);
- `HttpLoggingFilter extends OncePerRequestFilter`, `LoggingClientInterceptor implements ClientHttpRequestInterceptor`;
- `TenantContext` (`String requireTenantId()`, `<T> T runCrossTenant(String reason, Supplier<T> work)`);
- `JwtTenantIdentifierResolver implements CurrentTenantIdentifierResolver<String>`, `JwtAuditorAware implements AuditorAware<String>`;
- `BaseEntity` / `BaseTenantEntity` (`@MappedSuperclass`).

## Masker contract (one table; the Java, Nest and Next examples all pass it)

**Algorithm:**
1. **Normalize.** Split a key into words on camelCase boundaries (`aB` → `a|B`, `ABc` → `A|Bc`), `_`, `-` and spaces. Lowercase every word.
2. **Build the list.** List entries are normalized the same way, then joined with no separator (`accessToken` → `accesstoken`). The effective list = `SECRET_FIELDS` + (configured PII list, or `DEFAULT_PII_FIELDS` when unset or empty).
3. **Match.** A key is masked when **any contiguous run of its words**, joined, is in the effective list. That covers single words and the whole key. There is no substring matching.
4. **Mask.** Replace a masked key's value, whatever its type, with `"***"`. Recurse into objects and arrays.
5. **Base64.** A string longer than 1024 chars that matches `^(data:[\w/+.-]+;base64,)?[A-Za-z0-9+/\r\n]+={0,2}$` becomes `<base64 N bytes>`, where N = `floor(payloadLength * 3 / 4) - paddingCount`. The payload is the part after the comma, if any.
6. **Truncate.** Serialize compactly (no spaces). If the UTF-8 length is over `maxBodyBytes`, keep the first `maxBodyBytes` bytes, cut at a character boundary, and append `...[truncated T bytes]`, where T is the full byte length.
7. **Content-type:**
   - JSON → parse, then steps 3–6.
   - Form → parse pairs into an object, then steps 3–6.
   - `multipart/*`, `application/octet-stream`, `image/*`, `application/pdf` → `<binary CT N bytes>`.
   - Anything else, or JSON that does not parse → `<CT N bytes>` (CT = the content-type, or `unknown`).

`SECRET_FIELDS` = `password passwd secret token accessToken refreshToken idToken apiKey clientSecret privateKey authorization cookie setCookie otp pin cvv cvc`.

`DEFAULT_PII_FIELDS` = `email phone phoneNumber mobile fullName dob dateOfBirth address nationalId idNumber cccd cmnd passport passportNumber cardNumber pan accountNumber`.

**Table** (default options unless stated):

| input key or case | masked? |
|---|---|
| `password`, `newPassword`, `confirm_password`, `ACCESS_TOKEN`, `access-token`, `tokenType`, `Authorization`, `set-cookie`, `otp`, `pin`, `cvv` | yes |
| `email`, `customerEmail`, `phoneNumber`, `mobile`, `fullName`, `dateOfBirth`, `homeAddress`, `national_id`, `nationalIdNumber`, `cccd`, `passportNumber`, `cardNumber`, `accountNumber` | yes |
| `shipping`, `company`, `spanId`, `footprint`, `pinned`, `id`, `orderId`, `amount`, `status`, `name`, `typeName` | no |
| `LOG_MASK_FIELDS=email`: `email` yes, `phoneNumber` **no**, `password` yes | — |
| `{ "customer": { "contact": { "phone": "0901" } }, "items": [ { "cardNumber": "4111" } ] }` | both nested values → `"***"` |
| `{ "profile": { "x": 1 } }` with key `profile` in a configured list | `"profile": "***"` (whole object) |
| 1024-char base64 string | unchanged |
| 1028-char base64 string, no padding | `<base64 771 bytes>` |
| serialized body of exactly 16384 bytes | unchanged |
| serialized body of 16385 bytes | first 16384 bytes + `...[truncated 16385 bytes]` |
| `text/xml` body of 300 bytes | `<text/xml 300 bytes>` |
| `application/json` body `{bad` (4 bytes) | `<application/json 4 bytes>` |
| `image/jpeg` 5000 bytes | `<binary image/jpeg 5000 bytes>` |
| form `email=a%40b.c&amount=10` | `{ "email": "***", "amount": "10" }` |

---

## File map (new and changed)

```
src/conventions.js                     (new, Task 1)
src/profile.js  src/types.js  src/render/context.js  src/render/shared.js  src/commands/init.js   (Task 1)
src/catalog/load.js  src/catalog/validate.js                                                     (Tasks 1–2)
src/fs/read-utf8.js  src/wire/node.js  src/commands/run-sync.js                                  (Task 3)
catalog/languages/typescript/{rule.md,guard.json,lint/eslint.stackcrew.mjs,lint/eslintrc.stackcrew.cjs}  (Task 4)
catalog/core/rules/{persistence.md (new),logging.md}  catalog/addons/observability/rules.md
catalog/addons/typeorm/{addon.json,rules.md}                                                     (Task 5)
catalog/stacks/spring-boot/**                                                                    (Task 6)
catalog/stacks/nestjs/**                                                                         (Tasks 7–8)
catalog/stacks/nextjs/**                                                                         (Tasks 9–10)
catalog/skills/stackcrew-init/**  catalog/plugin-commands/sync.md                                (Task 11)
fixtures/{nestjs-minimal,nextjs-minimal}/**  README.md  docs/manual-checklist.md  package.json    (Task 12)
test/fixtures/catalog-mini/{languages/typescript/**,stacks/demo-ts/**}                           (Task 2)
```

---

### Task 1: Conventions in the profile, template variables, placeholder validation

**Files:**
- Create: `src/conventions.js`, `test/conventions.test.js`
- Modify: `src/types.js` (Profile, RenderContext.vars, new `Conventions` typedef), `src/profile.js`, `src/render/context.js`, `src/render/shared.js` (`renderProfileDoc`), `src/commands/init.js:84-90`, `src/catalog/validate.js`
- Test: `test/conventions.test.js`, `test/profile.test.js`, `test/commands.test.js`, `test/catalog.test.js`

**Interfaces:**
- Produces:
  - `CONVENTION_DEFAULTS` (frozen object; values in "Cross-stack names").
  - `resolveConventions(profile: Profile): Conventions`: defaults merged with `profile.conventions`; arrays copied.
  - `validateConventions(value: unknown): string[]`: errors prefixed `conventions.<key>:` or `conventions:`.
  - `conventionVars(c: Conventions): Record<string,string>`: the template variables above.
  - `CONVENTION_VAR_NAMES: string[]`.
  - `Profile` gains `conventions?: Partial<Conventions>` and `node?: { wired: boolean }`.
  - `RenderContext` gains `conventions: Conventions`; `vars` gains the convention variables.
  - `RENDER_PLACEHOLDERS` (exported from `validate.js`): `stackId stackName cli version basePackage` plus `CONVENTION_VAR_NAMES`.
- Validation rules:
  - An unknown key is an error.
  - `baseEntity`, `baseTenantEntity`, `tenantColumn` must match `^[A-Za-z_$][\w$]*$`.
  - `tenantClaim`, `rolesClaim`, `systemUser` are non-empty with no whitespace.
  - `sharedComponents` is a non-empty POSIX relative path: no leading `/`, no `\`, no `..` segment.
  - `sharedLibraries`, `crossTenantRoles`, `typeFreeFiles` are arrays of non-empty strings.
  - `validateProfile` runs it when `conventions !== undefined`. `node.wired` must be boolean when `node` is present.
- `createProfile` adds `node: { wired: false }` when the stack language is `typescript`.
- `init --force` keeps `conventions` and `node.wired === true`. It prints `overwriting existing stackcrew.json (kept: decisions, context, conventions, java/node settings)`.
- `renderProfileDoc` adds `## Conventions` after `## Context`: a `| Key | Value | Source |` table with every key; Source is `stackcrew.json` or `default`; arrays are shown as in `conventionVars`.
- Placeholder validation: validator errors on `{{sc:x}}` with `x` not in the allowed list for:
  - every rule (core, language, stack rules/testing, addon), stack skills (description, body, files), stack `lintFiles`/`wireFiles`, language `lintFiles` (added in Task 2) and roles → `RENDER_PLACEHOLDERS`;
  - shared skills of any kind and plugin commands → `cli`, `version` (P2-R8).
  - Run `npm test` first. If the current catalog uses another placeholder in a shared skill, keep it allowed and ledger a ruling.

- [ ] **Step 1: Write failing tests**

```js
test('resolveConventions fills defaults and keeps declared values', () => {
  const c = resolveConventions({ conventions: { baseEntity: 'AuditedEntity', sharedLibraries: ['@acme/core'] } });
  assert.equal(c.baseEntity, 'AuditedEntity'); assert.equal(c.tenantClaim, 'tenant_id');
  assert.deepEqual(c.crossTenantRoles, ['super_admin']); assert.deepEqual(c.sharedLibraries, ['@acme/core']);
});
test('conventionVars serializes arrays and empty lists', () => {
  const v = conventionVars(resolveConventions({}));
  assert.equal(v.crossTenantRoles, '`super_admin`');
  assert.equal(v.sharedLibraries, 'none declared (set conventions.sharedLibraries in stackcrew.json)');
  assert.equal(conventionVars(resolveConventions({ conventions: { crossTenantRoles: [] } })).crossTenantRoles,
    'none (cross-tenant access is disabled)');
});
test('validateConventions rejects unknown key, bad identifier, unsafe path', () => {
  const e = validateConventions({ baseEnity: 'X', baseEntity: 'Base Entity', sharedComponents: '../ui' });
  assert.ok(e.some((m) => m.includes('unknown key "baseEnity"')));
  assert.ok(e.some((m) => m.startsWith('conventions.baseEntity:')));
  assert.ok(e.some((m) => m.startsWith('conventions.sharedComponents:')));
});
test('a 0.1.1 spring profile validates and renders with default conventions', ...); // real catalog; no conventions/node keys; buildContext vars.baseEntity === 'BaseEntity'
test('createProfile adds node.wired false for a typescript stack', ...);   // catalog stub: stacks Map with { language: 'typescript' }
test('profile doc lists conventions with their source', ...);              // 'baseEntity | AuditedEntity | stackcrew.json' and 'tenantClaim | tenant_id | default'
test('init --force keeps conventions and node.wired', ...);
test('sync rejects a bad conventions block before writing', ...);          // exit 1, stderr names conventions.baseEntity, no file written
test('validator rejects an unknown placeholder in stack rules and a convention placeholder in a shared skill', ...);
test('convention placeholders render in rule bodies', ...);                // mutate a loaded mini rule body to include {{sc:baseEntity}}
```

- [ ] **Step 2:** `npm test` → the new tests FAIL (missing module or assertions).
- [ ] **Step 3:** Implement as specified above.
- [ ] **Step 4:** `npm test` → all pass (299 + new).
- [ ] **Step 5:** `node bin/stackcrew.js plugin`, `npm test`. Commit `feat: per-project conventions with template variables`.

---

### Task 2: Guard globs from conventions, language lint files, TypeScript mini fixture

**Files:**
- Modify:
  - `src/types.js`: `GuardRule.globsFrom?: 'typeFreeFiles'`; `Language.lintFiles: SkillFile[]`.
  - `src/catalog/load.js`: `loadGuard` keeps `globsFrom` when it is a string; the language loader reads `languages/<lang>/lint`.
  - `src/catalog/validate.js`:
    - `checkGuard`: `globsFrom` must be `typeFreeFiles`.
    - Language lint files go through the placeholder check.
    - A stack lint file whose `relPath` equals a lint file of its language is an error.
  - `src/render/shared.js`.
- Create: `test/fixtures/catalog-mini/languages/typescript/{rule.md,guard.json,lint/demo-lint.json}` and `test/fixtures/catalog-mini/stacks/demo-ts/{stack.json,rules.md,testing.md,guard.json}`.
  - `demo-ts`: `language: "typescript"`, `globs: ["**/*.ts"]`, detect `packageDeps: ["demo-ts-core"]` only.
  - Its `guard.json` has one `SC-TYPEFILE` rule with `globsFrom: "typeFreeFiles"` and default globs `["**/*.service.ts"]`.
- Test: `test/guard-globs.test.js`. Update count assertions in existing tests that list mini stacks or languages.

**Interfaces:**
- `renderShared` writes `.stackcrew/guard.json` rules as `{ id, globs, excludeGlobs, regex, flags, message }` and never includes `globsFrom`.
- A rule with `globsFrom: 'typeFreeFiles'` gets `ctx.conventions.typeFreeFiles` as its globs when that list is non-empty; otherwise it keeps its catalog globs.
- `.stackcrew/lint/` gets `language.lintFiles` and then `stack.lintFiles` (templated with `vars`).
- Consumed by: Task 3 (lint paths), Tasks 7 and 9 (stack guard rules with `globsFrom`).

- [ ] **Step 1: Write failing tests**

```js
test('loadGuard keeps globsFrom', ...);
test('globsFrom rule takes typeFreeFiles from conventions', ...);   // conventions.typeFreeFiles ['src/**/*.handler.ts'] → that glob; no globsFrom key in output
test('globsFrom rule keeps catalog globs when typeFreeFiles is empty', ...);
test('validator rejects an unknown globsFrom value', ...);
test('language lint files render into .stackcrew/lint', ...);      // demo-ts profile → '.stackcrew/lint/demo-lint.json'
test('a stack lint file with the same name as its language lint file is a catalog error', ...);
```

- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Plugin regen, `npm test`. Commit `feat: guard globs from conventions and language-level lint files`.

---

### Task 3: ESLint wiring for TypeScript stacks (`sync --wire`)

**Files:**
- Create:
  - `src/fs/read-utf8.js`: move `readBuildFile` out of `src/commands/run-sync.js` unchanged, export it as `readUtf8File(projectDir, rel)`, and use it from both wire paths.
  - `src/wire/node.js`.
  - `test/wire-node.test.js`.
- Modify: `src/commands/run-sync.js`.

**Interfaces:**
- Constants:
  - `ESLINT_DEPS`: `{ eslint, '@eslint/js', 'typescript-eslint' }` as caret ranges. Fill the current versions from `npm view eslint@9 version`, `npm view @eslint/js@9 version` and `npm view typescript-eslint@8 version`, and record them in the report.
  - `FLAT_CONFIG_FILES = ['eslint.config.js','eslint.config.mjs','eslint.config.cjs','eslint.config.ts','eslint.config.mts','eslint.config.cts']` (ESLint's lookup order).
  - `LEGACY_CONFIG_FILES = ['.eslintrc.js','.eslintrc.cjs','.eslintrc.yaml','.eslintrc.yml','.eslintrc.json','.eslintrc']`.
  - `FLAT_IMPORT = "import stackcrewConfig from './.stackcrew/lint/eslint.stackcrew.mjs';"`.
  - `LEGACY_EXTENDS = './.stackcrew/lint/eslintrc.stackcrew.cjs'`.
- `eslintMajor(pkg: object): number|null`: the first integer in `dependencies.eslint ?? devDependencies.eslint`; `null` when absent or with no digits.
- `planNodeWiring({ packageJson?: string, configs: Record<string,string> }): { edits: {path,content}[], notes: string[], wired: string[] }`. It is pure: `configs` maps each existing config file name to its text.

| ESLint dep | Config present | Result |
|---|---|---|
| none | none | add `ESLINT_DEPS` to `devDependencies`; create `eslint.config.mjs` from `NEW_FLAT_CONFIG`; wired |
| none | any | note: config found but no `eslint` dependency; not wired |
| ≥ 9 | first flat file in lookup order is `.js`/`.mjs`/`.ts`/`.mts`, has exactly one line starting `export default`, and no `module.exports` | **flat edit** (below); wired |
| ≥ 9 | flat file of another shape (`.cjs`, `.cts`, zero or several `export default`, `module.exports`) | note with the 2-line snippet; not wired |
| ≥ 9 | only legacy files | note: ESLint ≥ 9 reads flat config; snippet; not wired |
| ≥ 9 | none | create `eslint.config.mjs` from `NEW_FLAT_CONFIG`; deps unchanged; wired |
| 8 | `.eslintrc.json` that `JSON.parse`s | add `LEGACY_EXTENDS` to `extends` (string → array, appended last); wired |
| 8 | `package.json` `eslintConfig` | same edit in `package.json`; wired |
| 8 | other legacy file, or JSONC that fails to parse | note with the `extends` snippet; not wired |
| 8 | none | note; not wired |
| < 8 or `null` with the dep present | — | note: unsupported ESLint version; not wired |

- **Idempotent:** a file that already contains `.stackcrew/lint/eslint.stackcrew.mjs` (or `LEGACY_EXTENDS`) gets no edit and counts as wired.
- **Flat edit (exact algorithm):**
  - Replace the single line-start `export default ` with `const stackcrewBaseConfig = `.
  - Insert `FLAT_IMPORT + '\n'` as the first line, after a BOM if there is one.
  - Append `export default [...[stackcrewBaseConfig].flat(), ...stackcrewConfig];\n`, preceded by a newline if the file does not end with one.
- **JSON rewrites:**
  - `JSON.stringify` with the file's indent (spaces of the first indented line; default 2) plus a trailing newline.
  - CRLF is kept if the original used CRLF.
  - `devDependencies` keys are sorted alphabetically after insertion. A dependency already present in `dependencies` or `devDependencies` is not added again.
- **`NEW_FLAT_CONFIG`:** imports `@eslint/js`, `typescript-eslint` and `FLAT_IMPORT`. It ignores `dist/**`, `.next/**`, `coverage/**`, `node_modules/**`, and composes `js.configs.recommended`, the typescript-eslint recommended configs and `...stackcrewConfig`. Verify the current recommended entry point (`defineConfig` from `eslint/config` or `tseslint.config`) with Context7 before writing it. The first line is `// Created by stackcrew sync --wire. This file is yours to edit.`
- **`run-sync.js`:**
  - `planWire` dispatches by `stack.language`: `java` → existing path; `typescript` → `planNodeWire`; anything else → stderr `--wire: only supported for Java and TypeScript stacks`, exit 1.
  - `planNodeWire` reads `package.json` and every file in both lists through `readUtf8File`, and returns `{ changed, notes, ok, profile: { ...profile, node: { wired: true } } }`.
  - Plan 1 ordering stays: in-memory `applyOps(dryRun)` first, then write edits, then the profile.
  - Not wired → stdout `wire: ESLint could not be wired automatically; add this to your ESLint config and re-run \`stackcrew sync --wire\`:` + notes, exit 1.
  - Deps added → note `run your package manager's install (npm install / yarn / pnpm install) to install: eslint, @eslint/js, typescript-eslint`.
  - Hint, TypeScript stack with `node.wired !== true`: `hint: run \`stackcrew sync --wire\` to add the stackcrew rules to your ESLint config`. The Checkstyle note stays Java-only.

- [ ] **Step 1: Write failing tests:** one test per table row, named after the row. Plus:

```js
test('flat edit wraps the existing default export and imports the stackcrew config', () => {
  const src = "import next from 'eslint-config-next';\nconst eslintConfig = [...next];\nexport default eslintConfig;\n";
  const { edits, wired } = planNodeWiring({ packageJson: '{"devDependencies":{"eslint":"^9.21.0"}}', configs: { 'eslint.config.mjs': src } });
  assert.deepEqual(wired, ['eslint.config.mjs']);
  assert.equal(edits[0].content,
    "import stackcrewConfig from './.stackcrew/lint/eslint.stackcrew.mjs';\n" +
    "import next from 'eslint-config-next';\nconst eslintConfig = [...next];\nconst stackcrewBaseConfig = eslintConfig;\n" +
    "export default [...[stackcrewBaseConfig].flat(), ...stackcrewConfig];\n");
});
test('wiring is idempotent', ...);
test('CRLF .eslintrc.json stays CRLF', ...);
test('unsupported ESLint config shapes print a snippet and write nothing', ...); // CLI level: cjs, two export default, yml, JSONC; files byte-identical, exit 1
test('sync --wire on a TypeScript project validates the render before touching package.json', ...); // mini demo-ts; mirror the existing Java I1 test (render/apply failure → package.json, ESLint config and stackcrew.json unchanged)
```

- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Plugin regen, `npm test`. Commit `feat: wire ESLint for TypeScript stacks with sync --wire`.

---

### Task 4: Content: TypeScript language (rule, guard, ESLint configs)

**Files:**
- Create: `catalog/languages/typescript/rule.md` (id `lang-typescript`), `catalog/languages/typescript/guard.json`, `catalog/languages/typescript/lint/eslint.stackcrew.mjs`, `catalog/languages/typescript/lint/eslintrc.stackcrew.cjs`
- Test: `test/catalog-typescript.test.js`

**Content requirements:**
- **`rule.md`**: framework-neutral, because React and Angular reuse it later. Wrong→right examples for each point:
  - no `any` in any form; no `object`, `{}` or `Function` as types;
  - external data enters as `unknown` and is parsed at the edge (zod or class-validator);
  - no `@ts-ignore`/`@ts-nocheck`; `@ts-expect-error` carries a reason;
  - `strict: true`;
  - `process.env` only in the config/env module;
  - no magic strings or numbers (named constants or `as const` objects);
  - shared `interface`/`type` declarations live in their own files (`*.types.ts`, `dto/`, `interfaces/`, `schemas/`), never in service or action files;
  - search existing helpers, components and types first, including {{sc:sharedLibraries}}, before writing new ones.
- **`guard.json`**:
  - Every rule: `globs ["**/*.ts","**/*.tsx"]`.
  - Every rule except `SC-IGNORE`: excludeGlobs `["**/*.spec.ts","**/*.spec.tsx","**/*.test.ts","**/*.test.tsx","**/test/**","**/tests/**","**/e2e/**","**/__tests__/**"]`.
  - `SC-ENV` adds to its excludeGlobs `["**/config/**","**/env.ts","**/env.mjs","**/env/**","**/*.config.ts","**/*.config.mts","**/*.config.mjs","**/*.config.js"]`.
  - Regexes (JSON-escaped in the file; pin them byte-exact in a test as `test/catalog-spring.test.js` does):
    - `SC-TYPE`: `^(?!\s*(\*|//|/\*)).*(\bas\s+any\b|:\s*any\b|=>\s*any\b|\|\s*any\b|<\s*any\s*[>,]|,\s*any\s*[>,]|\bany\[\])`
    - `SC-IGNORE`: `@ts-(ignore|nocheck)\b`
    - `SC-ENV`: `^(?!\s*(\*|//|/\*)).*\bprocess\.env\b`
    - `SC-CONST`: ``^(?!\s*(\*|//|/\*))(?!\s*(export\s+)?const\s+[A-Z][A-Z0-9_]*\s*=).*['"`]https?://``
  - Each message states the fix and the waiver form, in the style of `catalog/languages/java/guard.json`.
- **`lint/eslint.stackcrew.mjs`**: a flat config **array**, default export. It registers **no** plugins, because the project's config supplies `@typescript-eslint`.
  - For `**/*.ts`, `**/*.tsx`:
    - `@typescript-eslint/no-explicit-any: error`;
    - `@typescript-eslint/no-restricted-types` for `object`, `{}`, `Function` (with messages);
    - `no-magic-numbers: off`;
    - `@typescript-eslint/no-magic-numbers` with `ignore [-1,0,1]`, `ignoreArrayIndexes`, `ignoreDefaultValues`, `ignoreEnums`, `ignoreNumericLiteralTypes`, `ignoreReadonlyClassProperties`, `ignoreTypeIndexes`;
    - `no-restricted-properties` for `process.env`;
    - `no-restricted-imports` for `BaseEntity` from `typeorm`;
    - `no-restricted-syntax` for a class decorated `@Entity()` without `extends`. Candidate selector: `ClassDeclaration:not([superClass]):has(Decorator > CallExpression[callee.name='Entity'])`. Prove it in scratch.
  - A second object for the SC-ENV config globs and test globs turns off `no-restricted-properties` and `@typescript-eslint/no-magic-numbers`.
- **`lint/eslintrc.stackcrew.cjs`**: `module.exports = { overrides: [...] }` with the same rules **except** `@typescript-eslint/no-restricted-types`, which needs typescript-eslint 8; ESLint 8 projects may run 6 or 7.

- [ ] **Step 1: Write failing tests**

```js
test('typescript language loads, validates and has lang-typescript rule', ...);
test('typescript guard blocks any forms, ts-ignore, process.env outside config, hardcoded URL; allows the waived and excluded cases', ...);
// any: 'const x: any = 1', 'foo as any', 'Promise<any>', 'Record<string, any>', 'any[]', '(a) => any'
// allowed: 'const company = 1', '// x: any in comment', "const API_URL = 'https://a.b'", process.env in src/config/app.config.ts
test('typescript guard.json keeps its regex escapes byte-exact', ...);
test('typescript language ships both ESLint variants', ...); // catalog.languages.get('typescript').lintFiles relPaths sorted === ['eslint.stackcrew.mjs','eslintrc.stackcrew.cjs']
test('legacy ESLint config omits no-restricted-types', ...);
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content, verifying APIs with Context7.
- [ ] **Step 4: Scratch ESLint proof** (outside the repo; paste the command lines and outputs in the report). Each scenario lints a file seeded with every violation and must report each rule, with no config error:
  1. **Fresh project:** `npm i -D eslint@9 @eslint/js@9 typescript-eslint@8 typescript`, with the Task 3 `NEW_FLAT_CONFIG` and the rendered `.stackcrew/lint/eslint.stackcrew.mjs`.
  2. **Next-style project:** `eslint@9 eslint-config-next@16 typescript`, with a create-next-app style `eslint.config.mjs` wired by `planNodeWiring`. Expect no "Cannot redefine plugin" error.
  3. **ESLint 8:** `@typescript-eslint/parser` and plugin, with `.eslintrc.json` extending `LEGACY_EXTENDS`.
- [ ] **Step 5:** `npm test` → PASS. Plugin regen. Commit `feat(catalog): TypeScript language rule, guard and ESLint configs`.

---

### Task 5: Content: cross-stack rules (persistence, logging) and the TypeORM add-on

**Files:**
- Create:
  - `catalog/core/rules/persistence.md`: id `core-persistence`, `categories: [backend, fullstack]`.
  - `catalog/addons/typeorm/addon.json`: `{ "id": "typeorm", "name": "TypeORM", "languages": ["typescript"], "detect": { "files": [], "contains": [], "excludeContains": [], "packageDeps": ["typeorm"] } }`.
  - `catalog/addons/typeorm/rules.md`: id `addon-typeorm`.
- Modify: `catalog/core/rules/logging.md` (line 15 Essentials bullet, line 34 "Do not log full bodies…", the "Request and response logging" and "HTTP client" sections), `catalog/addons/observability/rules.md:179`.
- Test: `test/catalog-cross-stack.test.js`.

**Content requirements:**
- **`core-persistence`** (language-neutral; per-stack mechanics live in the stack rules):
  - **Entity base:**
    - Every persisted entity extends `{{sc:baseEntity}}` (the four audit fields from "Cross-stack names").
    - Tenant-scoped entities extend `{{sc:baseTenantEntity}}`, which extends `{{sc:baseEntity}}` and adds `{{sc:tenantColumn}}`.
    - Use the project's existing base classes (search {{sc:sharedLibraries}} first). Create them once, in the shared location, only when absent.
    - The base holds no `id`.
  - **Audit:** the framework fills the audit fields; code never sets them by hand. The user is the JWT `sub`; with no user, `{{sc:systemUser}}`.
  - **Tenant:**
    - The tenant comes from claim `{{sc:tenantClaim}}`.
    - Every query on a tenant entity is filtered by the framework mechanism, never by a hand-written `where`.
    - Missing tenant → error (P2-R5).
    - Messages carry `x-tenant-id`/`x-user-id`/`x-request-id` (P2-R7).
    - Jobs run as `system` and set the tenant explicitly per unit of work.
    - Public endpoints do not touch tenant entities unless the project defines a resolver.
  - **Cross-tenant:** only through the one explicit call (`runCrossTenant(reason, …)`), allowed for roles {{sc:crossTenantRoles}} read from claim `{{sc:rolesClaim}}`, or for `{{sc:systemUser}}`. Each use logs who and why.
  - **Tests:** every stack's testing rules require an "audit fields filled" test and a "tenant A cannot read tenant B" test.
- **`core-logging`:** replace the no-body rules with the masked body-logging contract:
  - one line per call with the "Log line fields";
  - the masker summary: secret list always masked; PII list configurable via `LOG_MASK_FIELDS` / `app.logging.mask-fields`, default list used when unset; word-run matching; 16 KB truncation; base64 and binary placeholders; non-JSON/form → placeholder (P2-R3);
  - the `LOG_BODIES` / `app.logging.log-bodies` switch;
  - headers: only `content-type`, `content-length`, `user-agent`;
  - logging happens in one inbound and one outbound place, never scattered in services;
  - consumers log `message_in` through the same masker.
  - Keep "no PII or secret in logs" as a release gate. Keep the Essentials at ≤ 15 bullets.
- **`observability/rules.md:179`:** keep the gate. Say that bodies are logged only through the shared masker.
- **`addon-typeorm`:**
  - entities extend the project base, never TypeORM's own `BaseEntity` (Active Record);
  - `synchronize: false` outside local dev; schema changes via migrations only;
  - transactions via `DataSource.transaction`/`QueryRunner`;
  - audit via `AuditSubscriber`;
  - tenant entities only through `TenantScopedRepository`;
  - no `repository.update()`/QueryBuilder writes on audited entities, unless a test proves the audit fields are set on that path (verify which TypeORM 0.3 write paths call subscribers, with Context7 and a scratch test, and write down the answer);
  - avoid N+1; paginate lists; entities never leave the service layer.

- [ ] **Step 1: Write failing tests**

```js
test('core-persistence applies to backend and fullstack stacks only', ...);   // filter by categories in buildContext with stub stacks
test('persistence rule renders the project conventions', ...);                // conventions baseEntity 'AuditedEntity', crossTenantRoles ['ops'] → text contains both
test('core-logging logs masked bodies and names both config keys', ...);      // no 'Do not log full bodies'; contains 'LOG_MASK_FIELDS' and 'app.logging.mask-fields'
test('typeorm add-on is detected from package.json for typescript only', ...);
test('cross-stack content has no banned phrases and bounded essentials', ...);
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content. Run the TypeORM write-path scratch check (Postgres in Docker) and put the result in the report. **Step 4:** `npm test` → PASS. Check the real-render budgets: `test/catalog-spring.test.js` "renders within every budget" must still pass (a degrade warning is allowed).
- [ ] **Step 5:** Plugin regen. Commit `feat(catalog): cross-stack persistence and masked body logging rules, TypeORM add-on`.

---

### Task 6: Content: Spring Boot retrofit

**Files:**
- Modify:
  - `catalog/stacks/spring-boot/rules.md`: "Logging and observability config" lines 120–121; "Data access with Spring Data JPA".
  - `catalog/stacks/spring-boot/testing.md`.
  - `catalog/stacks/spring-boot/skills/stackcrew-spring-integration-provider/SKILL.md` §10 (about lines 426–431).
  - `catalog/stacks/spring-boot/wire/StackcrewArchitectureTest.java`.
- Create: `catalog/stacks/spring-boot/skills/stackcrew-spring-jpa-entity/SKILL.md` and `catalog/stacks/spring-boot/skills/stackcrew-spring-request-logging/SKILL.md`. Sibling `.java` files are allowed for long code; never name one `*Test*.java` outside a code block.
- Test: `test/catalog-spring.test.js`. Update the counts: 4 → 6 skills; base without add-ons 3 → 5.

**Content requirements:**
- **`rules.md`:**
  - request logging per `core-logging` through `HttpLoggingFilter` and `LoggingClientInterceptor`;
  - masking via `BodyMasker` + `MaskingProperties`;
  - entity base `@MappedSuperclass` with JPA auditing (`@EnableJpaAuditing`, `JwtAuditorAware`);
  - tenant via Hibernate `@TenantId` + `JwtTenantIdentifierResolver` (P2-R5, P2-R6);
  - cross-tenant via `TenantContext.runCrossTenant`.
- **Provider skill §10:** adapters do not log bodies themselves, because `LoggingClientInterceptor` does. Images and documents are logged by size only. Keep the traceId line.
- **`stackcrew-spring-jpa-entity`** (`kind: task`): entity + Flyway/Liquibase migration + base classes (create once if absent) + auditing + tenant + the two required tests. The description names "Spring Boot".
- **`stackcrew-spring-request-logging`** (`kind: task`): `MaskingProperties`, `BodyMasker`, `HttpLoggingFilter` (`ContentCachingRequestWrapper`/`ContentCachingResponseWrapper`, `copyBodyToResponse()` in `finally`), `LoggingClientInterceptor` (buffering request factory on `RestClient`).
  - Every line that names `JsonNode` carries `// stackcrew-allow: SC-TYPE log masking walks arbitrary JSON before it is written`. The Java guard blocks `JsonNode` in any main `.java` file.
- **`testing.md`:** add the audit test, the tenant isolation test and the cross-tenant test, all with Testcontainers Postgres.
- **ArchUnit:** a new `@ArchTest` method `entities_extend_the_base_entity` (`SC-ENTITY`), frozen like the others. Classes annotated `jakarta.persistence.Entity` must have `{{sc:baseEntity}}` among their raw superclasses' simple names. Verify the ArchUnit API with Context7.

- [ ] **Step 1: Write failing tests**

```js
test('spring-boot stack loads with 6 skills (kafka one gated by its add-on) and validates', ...);
test('spring request logging no longer forbids bodies and uses the shared masker', ...); // rules.md has no 'never the body'; has 'BodyMasker'
test('wire template has SC-ENTITY with the configured base entity', ...);              // conventions baseEntity 'AuditedEntity' → rendered test contains "AuditedEntity"
test('JsonNode lines in the request-logging skill carry an SC-TYPE waiver', ...);      // scanLines over every JsonNode line in code blocks → 0 violations
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content.
- [ ] **Step 4: Scratch proof**, Maven, Spring Boot 3.2+ (and compile-only on 3.0 if P2-R6 needs the fallback):
  - copy the skill code in;
  - with Testcontainers Postgres, tests pass for: audit fields on insert and update; tenant isolation; missing tenant (no rows or exception, never other tenants' rows); cross-tenant allowed for `super_admin` and denied otherwise;
  - every Masker contract row passes;
  - the filter and the interceptor emit one line each with masked bodies;
  - ArchUnit `SC-ENTITY` fails on an entity without the base.
  Record the commands and the results.
- [ ] **Step 5:** `npm test` → PASS. Plugin regen. Commit `feat(catalog): Spring Boot entity base, tenant and masked request logging`.

---

### Task 7: Content: NestJS stack core and infrastructure skills

**Files:**
- Create:
  - `catalog/stacks/nestjs/stack.json`:
    - `id "nestjs"`, `name "NestJS"`, `category "backend"`, `language "typescript"`, `minVersion "10.0"`;
    - `globs ["**/*.ts"]`, `aliases ["nest"]`, `priority 20`;
    - detect `{ files: [], contains: [], excludeContains: [], packageDeps: ["@nestjs/core"] }` (P2-R1).
  - `catalog/stacks/nestjs/rules.md`: id `stack-nestjs`.
  - `catalog/stacks/nestjs/testing.md`: id `stack-nestjs-testing`.
  - `catalog/stacks/nestjs/guard.json`: one `SC-TYPEFILE` rule:
    - `globsFrom "typeFreeFiles"`, globs `["**/*.service.ts"]`, test excludeGlobs as in Task 4;
    - regex `^(export\s+)?(declare\s+)?(interface|type)\s+[A-Za-z_$][\w$]*`;
    - the message says to move the declaration to `dto/`, `interfaces/` or `*.types.ts`, and gives the waiver form.
  - `catalog/stacks/nestjs/skills/stackcrew-nest-request-logging/SKILL.md` (task).
  - `catalog/stacks/nestjs/skills/stackcrew-nest-typeorm-entity/SKILL.md` (task, `requiresAddons: ["typeorm"]`).
- Test: `test/catalog-nest.test.js`.

**Content requirements:**
- **`rules.md`** follows delta §6:
  - module layout `src/modules/<feature>/{*.controller.ts,*.service.ts,dto/,entities/,interfaces/}`;
  - thin controllers;
  - response DTO with `@Expose()` + `@ApiProperty()`, mapped with `plainToInstance(…, { excludeExtraneousValues: true })` or a mapper, never an entity, not even with `ClassSerializerInterceptor`;
  - global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`;
  - `@nestjs/config` validated at boot;
  - passport-jwt verifying through JWKS, checking `issuer`/`audience`, a global guard with a public decorator, and setting the request context (`runWithRequestContext`) from `sub`, `{{sc:tenantClaim}}`, `{{sc:rolesClaim}}`;
  - TypeORM per `addon-typeorm`;
  - exception filter → RFC 7807;
  - outbound via `HttpService` with timeouts;
  - logging per `core-logging` with `nestjs-pino` (new dependency → ask first). Nest's built-in JSON logger needs Nest 11.
- **`testing.md`:**
  - Jest + `@nestjs/testing`;
  - integration against real Postgres (Testcontainers, ask first) and e2e HTTP (supertest, ask first);
  - no live provider calls;
  - the audit and tenant tests from `core-persistence`;
  - test files `*.spec.ts`.
- **`stackcrew-nest-request-logging`:** `body-masker.ts`, `request-context.ts`, `HttpLoggingInterceptor`, `AllExceptionsFilter`, `OutboundHttpLogger`, env options, `nestjs-pino` wiring. Long code goes in sibling `.ts` files (e.g. `body-masker.ts`, `body-masker.spec.ts`).
- **`stackcrew-nest-typeorm-entity`:** the base classes, `AuditSubscriber`, `TenantScopedRepository`, `runCrossTenant`, a migration, and the two required tests.

- [ ] **Step 1: Write failing tests**

```js
test('nestjs stack loads, validates, and gates the typeorm skill by its add-on', ...);
test('nestjs detects only by exact package name', ...);
// temp dirs: {'@nestjs/core'} → nestjs; {'@nestjs/common'} only → null; package.json with no deps → null
test('nest guard blocks a type declaration in a service file and honours typeFreeFiles', ...);
test('nest guard.json keeps its regex escapes byte-exact', ...);
test('nest rules forbid returning entities and require response DTOs', ...);
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content (Context7 first).
- [ ] **Step 4: Scratch proof**: a Nest 10 project with the §3 libraries, `nestjs-pino`, Postgres in Docker; keep it for Task 8.
  - `tsc --noEmit` is clean;
  - the Jest specs pass: every Masker contract row; audit on insert and update; tenant isolation; missing tenant throws `MissingTenantError`; cross-tenant allowed and denied;
  - one inbound and one outbound request each log a single line with masked bodies.
- [ ] **Step 5:** `npm test` → PASS. Plugin regen. Commit `feat(catalog): NestJS stack with request logging and TypeORM entity skills`.

---

### Task 8: Content: NestJS feature skills

**Files:**
- Create under `catalog/stacks/nestjs/skills/`:
  - `stackcrew-nest-rest-endpoint/SKILL.md` (task);
  - `stackcrew-nest-outbound-client/SKILL.md` (task);
  - `stackcrew-nest-rabbitmq-consumer/SKILL.md` (task, `requiresAddons: ["rabbitmq"]`);
  - `stackcrew-nestjs-testing/SKILL.md` (testing).
- Test: `test/catalog-nest.test.js`.

**Content requirements:**
- **rest-endpoint:**
  - a pre-flight note (as Spring's skill);
  - request DTO (class-validator), response DTO (`@Expose`, `@ApiProperty`) and mapper in their own files;
  - service via `TenantScopedRepository` when tenant-scoped;
  - controller returns only DTOs; pagination; RFC 7807 errors;
  - unit and e2e specs.
- **outbound-client:**
  - typed request/response DTOs and an ACL mapper;
  - `HttpService` with timeout and retry, plus a resilience library choice (ask first);
  - body logging through `OutboundHttpLogger` only;
  - a provider fake in tests.
- **rabbitmq-consumer** (golden task 1, delta §11.2):
  - `amqp-connection-manager` + `amqplib`;
  - typed message schema;
  - idempotency store;
  - DLX;
  - context from `x-tenant-id`/`x-user-id`/`x-request-id`;
  - `message_in` log through the masker;
  - no `any`.
- **nestjs-testing:** how the tester role works in this stack: unit, integration, e2e, fakes for third parties, the required audit and tenant tests.

- [ ] **Step 1: Write failing tests**

```js
test('nest feature skills load; rabbitmq consumer is gated by its add-on', ...);
test('nest skill descriptions name NestJS and stay within 500 chars', ...);
test('new nest SKILL.md files are at most 350 lines', ...);
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content.
- [ ] **Step 4: Scratch proof** in the Task 7 project:
  - a customer-profile endpoint built from the rest-endpoint skill returns a DTO (e2e spec);
  - the consumer handles a duplicate message once and dead-letters a poison message (RabbitMQ in Docker);
  - `tsc --noEmit` is clean.
- [ ] **Step 5:** `npm test` → PASS. Plugin regen. Commit `feat(catalog): NestJS endpoint, outbound client, RabbitMQ consumer and testing skills`.

---

### Task 9: Content: Next.js stack core and infrastructure skills

**Files:**
- Create:
  - `catalog/stacks/nextjs/stack.json`:
    - `id "nextjs"`, `name "Next.js"`, `category "fullstack"`, `language "typescript"`, `minVersion "16.0"`;
    - `globs ["**/*.ts", "**/*.tsx"]` (two globs, never `{ts,tsx}`), `aliases ["next"]`, `priority 25`;
    - detect `{ files: [], contains: [], excludeContains: [], packageDeps: ["next"] }`.
  - `catalog/stacks/nextjs/rules.md`: id `stack-nextjs`.
  - `catalog/stacks/nextjs/testing.md`: id `stack-nextjs-testing`.
  - `catalog/stacks/nextjs/guard.json`: `SC-TYPEFILE`, as in Task 7, with globs `["**/actions.ts", "**/*.actions.ts", "**/actions/**/*.ts"]`.
  - `catalog/stacks/nextjs/skills/stackcrew-next-request-logging/SKILL.md` (task).
  - `catalog/stacks/nextjs/skills/stackcrew-next-typeorm-entity/SKILL.md` (task, `requiresAddons: ["typeorm"]`).
- Test: `test/catalog-next.test.js`.

**Content requirements:**
- **`rules.md`** follows delta §7:
  - Server Components by default; `'use client'` at leaves;
  - `import 'server-only'` in data modules;
  - entities never reach the client: map to DTOs or plain objects;
  - server actions:
    - parse input with a zod schema kept in its own file (`z.infer`);
    - call `auth()` and check permissions;
    - return a typed result `{ ok: true, data } | { ok: false, error }`;
    - `revalidatePath`/`revalidateTag`;
    - wrapped with `withActionLogging`;
  - forms with `react-hook-form` + `zodResolver` on the same schema;
  - reuse components from `{{sc:sharedComponents}}` and existing feature components before writing new ones, with tables on the shared TanStack Table component;
  - `cn()` for classes; no inline styles;
  - env only through the `@t3-oss/env-nextjs` `env` object;
  - `zustand` for client UI state only;
  - loading, empty and error states (`loading.tsx`, `error.tsx`);
  - TypeORM: one `DataSource` instance that survives dev hot reload, plus the Next config TypeORM needs. Verify `serverExternalPackages` and decorator metadata under Next 16 with Context7 and the scratch build.
- **`testing.md`:**
  - Vitest (schemas, mappers, actions with fake repositories);
  - Testing Library (client components);
  - integration via the project's `vitest.int.config.ts` with Postgres;
  - Playwright E2E for async Server Components;
  - the required audit and tenant tests;
  - test files `*.spec.ts(x)`.
- **`stackcrew-next-request-logging`:** `body-masker.ts`, `request-context.ts` with `getRequestContext()`, `withActionLogging`, `withRouteLogging`, `httpClient.fetch`, `onRequestError` in `instrumentation.ts`, pino setup, env options in the `env` schema.
- **`stackcrew-next-typeorm-entity`:** the base classes, `AuditSubscriber`, `TenantScopedRepository`, `runCrossTenant`, the `DataSource` singleton, a migration via the TypeORM CLI, and the two required tests.

- [ ] **Step 1: Write failing tests**

```js
test('nextjs stack loads, validates, and gates the typeorm skill by its add-on', ...);
test('nextjs detects only by exact package name and wins over nestjs', ...);
// temp dirs: {'next'} → nextjs; {'next-auth','eslint-config-next','next-themes'} → null; {'next','@nestjs/core'} → nextjs (priority 25 > 20)
test('next guard blocks a type declaration in actions files and honours typeFreeFiles', ...);
test('next guard.json keeps its regex escapes byte-exact', ...);
test('next rules render the shared components directory from conventions', ...);   // conventions.sharedComponents 'app/ui' → text contains 'app/ui'
test('nextjs cursor globs join without braces', ...);                              // rendered .mdc globs === '**/*.ts,**/*.tsx'
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content (Context7 first).
- [ ] **Step 4: Scratch proof**: a Next 16 App Router project with the §3 libraries and Postgres in Docker; keep it for Task 10.
  - **`next build` succeeds** with a `'use server'` file exporting a `withActionLogging`-wrapped action, and with a TypeORM entity on the base classes. If decorator metadata is not emitted, the skill uses explicit column `type`s, and the report says so.
  - Vitest specs pass: every Masker contract row; audit; tenant isolation; missing tenant throws; cross-tenant allowed and denied.
  - Calling the action logs one line with masked bodies.
- [ ] **Step 5:** `npm test` → PASS. Plugin regen. Commit `feat(catalog): Next.js stack with request logging and TypeORM entity skills`.

---

### Task 10: Content: Next.js feature skills

**Files:**
- Create under `catalog/stacks/nextjs/skills/`:
  - `stackcrew-next-server-action/SKILL.md` (task);
  - `stackcrew-next-feature-page/SKILL.md` (task);
  - `stackcrew-next-route-handler/SKILL.md` (task);
  - `stackcrew-nextjs-testing/SKILL.md` (testing).
- Test: `test/catalog-next.test.js`.

**Content requirements:**
- **server-action** (golden task 3):
  - a pre-flight note;
  - schema file + type via `z.infer`;
  - action wrapped with `withActionLogging`, with `auth()` and the permission check;
  - DTO result;
  - form on `react-hook-form` + `zodResolver`, built from `{{sc:sharedComponents}}` components;
  - pending, success and error states;
  - specs.
- **feature-page:** an async Server Component loading through `getRequestContext()` + `TenantScopedRepository`, mapped to DTOs; `loading.tsx`, `error.tsx`, empty state; the shared table component.
- **route-handler:** `withRouteLogging`, zod input, auth, typed JSON response, RFC 7807 errors.
- **nextjs-testing:** how the tester role works in this stack.

- [ ] **Step 1: Write failing tests**

```js
test('next feature skills load and name Next.js in their descriptions', ...);
test('new next SKILL.md files are at most 350 lines', ...);
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content.
- [ ] **Step 4: Scratch proof** in the Task 9 project:
  - an eKYC registration form + action from the server-action skill;
  - a list page from the feature-page skill;
  - a route handler;
  - `next build` succeeds; Vitest specs pass; one Playwright test drives the form to its success state.
- [ ] **Step 5:** `npm test` → PASS. Plugin regen. Commit `feat(catalog): Next.js server action, feature page, route handler and testing skills`.

---

### Task 11: Content: init interview, profile schema, sync command

**Files:**
- Modify: `catalog/skills/stackcrew-init/SKILL.md`, `catalog/skills/stackcrew-init/references/profile-schema.md`, `catalog/plugin-commands/sync.md`.
- Test: `test/catalog-real.test.js`.

**Content requirements:**
- **Init interview:** a new topic **10. Project conventions**, asked for backend and fullstack stacks (and `sharedComponents` only for fullstack/frontend). It covers internal shared libraries, the base entity class names, the tenant claim, the roles claim, the cross-tenant roles and the shared components directory.
  - Hints: read `aliases.ui` from `components.json` when present; search the source for an existing `BaseEntity`.
  - Answers go into `conventions`; keys left at their default are omitted.
  - No `{{sc:<convention>}}` placeholders anywhere in this skill (P2-R8).
- **Step 7:** for TypeScript stacks, offer `--wire` (ESLint) only when `package.json` exists; describe what it edits.
- **Step 8 (backlog fix):** the summary tells the user to run `/stackcrew:sync`, `/stackcrew:add <addon>` and `/stackcrew:check` in Claude Code, or `{{sc:cli}} sync|add|check` elsewhere. It never prints the raw plugin-cache `node …/stackcrew.js` path.
- **Re-profile:** `conventions` may be updated on request; `node` is never edited by hand.
- **`profile-schema.md`:** document `conventions` (every key, default, meaning) and `node.wired`. Add `"conventions"` to the eKYC example.
- **`sync.md`:** `--wire` covers Java (ArchUnit) and TypeScript (ESLint).

- [ ] **Step 1: Write failing tests**

```js
test('stackcrew-init asks for project conventions and records them in conventions', ...);
test('stackcrew-init summary points to slash commands, not a plugin-cache path', ...); // no /node .*stackcrew\.js/ and contains '/stackcrew:sync'
test('profile-schema documents every convention key with its default', ...);       // each key of CONVENTION_DEFAULTS appears
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Plugin regen. Commit `feat(catalog): init interview records project conventions; sync documents ESLint wiring`.

---

### Task 12: Fixtures, end-to-end, budgets, docs, release 0.2.0

**Files:**
- Create:
  - `fixtures/nestjs-minimal/`:
    - `package.json` with `@nestjs/core` 10, `typeorm`, `amqplib`, no eslint, written from scratch;
    - `src/modules/customer/customer.service.ts` seeded with `interface CustomerRow {…}` and `: any`;
    - `src/modules/customer/entities/customer.entity.ts`, an `@Entity()` class without `extends`.
  - `fixtures/nextjs-minimal/`:
    - `package.json` with `next` 16, `next-auth`, `eslint` ^9, `typeorm`;
    - `eslint.config.mjs` in create-next-app style;
    - `src/app/register/actions.ts` seeded with `export interface RegisterInput` and `process.env.API_URL`.
- Modify: `test/e2e.test.js` (or create `test/e2e-node.test.js`), `README.md` (Vietnamese), `docs/manual-checklist.md`, `package.json` (`0.2.0`); regenerated `plugin/` and `.claude-plugin/`.

**Requirements:**
- **e2e:**
  - `init --stack nestjs` / `--stack nextjs` with all tools renders the expected file set, including both ESLint variants.
  - `check` flags every seeded violation by rule id.
  - The hook blocks writing the seeded service/action content.
  - `sync` is idempotent.
  - On a copy of the Next fixture, `sync --wire` edits `eslint.config.mjs` as in Task 3 and sets `node.wired`.
  - On a copy of the Nest fixture, `sync --wire` adds the devDependencies and creates `eslint.config.mjs`.
- **Budgets:**
  - The real render of spring-boot, nestjs and nextjs, each with every add-on that applies, finishes without `BUDGET`.
  - The test asserts whether the `agents-md-essentials-reduced` warning appears, and records each stack's AGENTS.md block size in the test name or a comment.
  - It measures the developer role's preloaded `SKILL.md` bytes per stack (M8) and writes the numbers into the report; this is not a hard limit.
- **No secrets:** a test scans `catalog/`, `fixtures/` and the generated `plugin/` for credentials in URLs (`/\/\/[^/\s:@]+:[^@\s]+@/`). Zero hits. Internal package scopes and hosts are a review check, not a test, so the test itself names none.
- **Test-runner safety:** a test asserts that no file under `catalog/`, `fixtures/` or `test/fixtures/` matches the `node --test` default patterns listed in Global Constraints.
- **README (VI):**
  - NestJS and Next.js added to the stack list;
  - a "Quy ước dự án (`conventions`)" section with the keys and defaults;
  - a note on masked body logging and the entity base;
  - `sync --wire` for ESLint;
  - the update flow for 0.2.0: plugin update, then `/stackcrew:sync` in each project.
- **`manual-checklist.md`:** golden tasks per delta §11.2: Nest RabbitMQ consumer, Nest customer endpoint, Next eKYC form for a logged-in user. Each has its expected checks.
- **Release:** `package.json` version `0.2.0`, then `node bin/stackcrew.js plugin`.

- [ ] **Step 1:** Write the failing e2e, budget, secret-scan and runner-safety tests. **Step 2:** → FAIL.
- [ ] **Step 3:** Create the fixtures and docs; bump the version; regenerate the plugin.
- [ ] **Step 4:** `npm test` → all pass. Report the final count and the budget numbers.
- [ ] **Step 5:** Commit `feat: NestJS and Next.js fixtures, end-to-end checks and 0.2.0`.
