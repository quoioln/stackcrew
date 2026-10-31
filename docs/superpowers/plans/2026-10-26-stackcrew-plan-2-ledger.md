# SDD ledger — plan: docs/superpowers/plans/2026-10-26-stackcrew-plan-2-nest-next.md

Spec: docs/superpowers/specs/2026-10-26-stackcrew-nest-next-design.md (delta, wins) + docs/superpowers/specs/2026-10-24-stackcrew-design.md (base).
Branch feat/plan-2-nest-next, worked in place (main checkout, feature branch). Start HEAD 745da58; merge base main b914ad7. Baseline npm test 299 pass.
Scratch projects: C:\Users\quoi.vo\AppData\Local\Temp\claude\C--Working-Projects-SDLC-SourceCode-SDLC\868f2ee8-8b6e-4400-ac65-3b1c54234f7d\scratchpad\p2-{eslint,spring,nest,next}

## Pre-flight scan

| Tasks | Shared file / interface | Finding |
|---|---|---|
| T1↔T2 | src/catalog/validate.js placeholder check; ctx.conventions | T1 says the placeholder check covers language lintFiles "added in Task 2", but language lintFiles don't exist until T2. → PF-1 |
| T1↔T2 | src/render/shared.js (T1 profile doc; T2 guard + lint) | sequential edits, no conflict |
| T1↔T3 | Profile.node.wired, createProfile | produced T1, consumed T3: consistent |
| T2↔T3 | mini demo-ts stack (T2) used by T3 tests | consistent |
| T3↔T4 | NEW_FLAT_CONFIG, FLAT_IMPORT path eslint.stackcrew.mjs, LEGACY_EXTENDS eslintrc.stackcrew.cjs | names match T4 file names: consistent |
| T1↔T4..T11 | convention template vars (incl. systemUser) | names match the Cross-stack names table: consistent |
| T4↔T5 | typeorm addon languages ["typescript"] requires language typescript | order T4 before T5: consistent |
| T5↔T6 | core-persistence / core-logging vs Spring rules | consistent; T5 adds core-persistence to Spring renders and T6 adds 2 skills → test/e2e.test.js expected Spring file set changes. → PF-2 |
| T5↔T7/T9 | addon-typeorm referenced by stack rules | consistent |
| T7↔T8, T9↔T10 | scratch projects reused | location must be shared. → PF-3 |
| T7↔T9 | detect tests (nestjs vs nextjs priority) | T7 tests nestjs only; T9 tests next + priority: consistent |
| T11↔T1 | convention keys documented | consistent |
| T12↔all | fixtures, e2e, budgets | consistent |

| Task | Self-consistency |
|---|---|
| T1 | tests match interfaces; systemUser validation listed: OK |
| T2 | mini fixture names avoid .js/.mjs: OK |
| T3 | decision table vs tests: OK |
| T4 | regexes pinned + byte-exact test: OK |
| T5 | budget check stated: OK |
| T6 | skill count 4→6 and base 3→5 stated; e2e set not mentioned → PF-2 |
| T7–T10 | scratch proofs stated; SKILL.md ≤350 lines tests: OK |
| T11 | backlog step-8 fix: OK |
| T12 | secret scan without internal names: OK |

Ruling PF-1: Task 2 extends Task 1's placeholder validation to language lintFiles — they first exist in T2 — cost if wrong: none (the check just lands one task later).
Ruling PF-2: Tasks 5 and 6 update test/e2e.test.js (and any other expected-file-set test) for the new core rule and the 2 new Spring skills — plan omitted it; the suite would fail — cost if wrong: none.
Ruling PF-3: scratch projects live at <scratchpad>/p2-eslint, p2-spring, p2-nest, p2-next; Tasks 8/10 reuse the Task 7/9 projects — keeps the proofs cumulative — cost if wrong: re-create a scratch project.
Ruling PF-4: work in place on feature branch feat/plan-2-nest-next (no separate worktree) — the user approved this branch; main stays untouched — cost if wrong: none.

## Progress
Task 1: dispatched (BASE 745da58, implementer sonnet a31fa134afced7117)
Task 1: implemented b81fd70 (310/310); review dispatched (sonnet ac0600254c265f008)
Task 1: ⚠️ resolved — addon rules go through checkRule (validate.js:183) which runs the placeholder check; plugin-drift is part of the 310/310 run; implementer confirmed no shared skill uses a placeholder beyond cli.
Task 1: minor (deferred): commands.test 'sync rejects a bad conventions block' reads `before` and asserts only length>0 (weak; snapshot stackcrew.json instead)
Task 1: minor (deferred): non-object `node` reports "node.wired: must be a boolean" (should say node: must be an object)
Task 1: minor (deferred): conventions.test 0.1.1 render asserts only ops.length>0 (no BaseEntity in output yet)
Task 1: complete (commits 745da58..b81fd70, review clean)
Task 2: dispatched (BASE b81fd70, implementer sonnet a2fecd9819a40b990)
Task 2: implemented 36f0f8e (317/317)
Task 2: ⚠️ resolved — 317/317 includes all existing count tests; readTree returns [] for missing dirs (java language has no lint dir and its assertion passes).
Task 2: minor (deferred→folded): mini guard.json fixtures use "\b" in JSON (backspace, regex never matches). Ruling: fold the one-line fix ("\b") into the Task 3 dispatch and warn content tasks 4/7/9 — cheap, prevents the style being copied — cost if wrong: none.
Task 2: minor (deferred): shared.js guard override map is one long line with redundant ...rest destructure
Task 2: minor (deferred): no test for language-level globsFrom rule or for non-globsFrom rule untouched when typeFreeFiles is set
Task 2: complete (commits b81fd70..36f0f8e, review clean)
Task 3: dispatched (BASE 36f0f8e, implementer sonnet a47529c4508253d2e)
Task 3: implemented e2e6a58 (342/342), DONE_WITH_CONCERNS. Ruling: NEW_FLAT_CONFIG is a plain exported array (no defineConfig/globalIgnores) — defineConfig needs ESLint >=9.22 and the '>=9, no config' row only knows the major — cost if wrong: config looks less modern, no behavior loss. Implementer resumed to apply it before review.
Task 3: ruling applied ac4d7cf (342/342); review dispatched (sonnet a89c0c1321bc942e7)
Task 3: ⚠️ resolved — real ESLint run is Task 4's scratch proof (carried into the Task 4 dispatch); I1 write loop untouched after applyOps(dryRun) per reviewer.
Task 3: minor (deferred): I1 test covers only "no dep, no config"; add a flat-edit-on-failure case
Task 3: minor (deferred): idempotency marker check is `includes` — a comment mentioning the path counts as wired
Task 3: minor (deferred): `export default function/async function` configs become expressions after flat edit (rare)
Task 3: minor (deferred): `let plan` far from use (node.js:741); meaningless regex alternative in wire-node test:1115; JSON.stringify expands inline arrays in package.json
Task 3: complete (commits 36f0f8e..ac4d7cf, review clean)
Task 4: dispatched (BASE ac4d7cf, implementer sonnet a079a78e761c22bf3; may fix src/wire/node.js if the real ESLint run finds a Task 3 defect)
Task 4: implemented fc1f9e6 (347/347; 3 ESLint scratch scenarios passed)
Task 4: review approved with ⚠️ (raw ESLint output not pasted) — confirmed real evidence gap → fix round 1.
Ruling: fold three content minors into round 1 (rule.md "right" example `retry: 3` violates the shipped no-magic-numbers; SC-TYPE exception wording conflict between rule.md and guard message; enum vs as const) — agents copy examples verbatim and a round is happening anyway — cost if wrong: a slightly larger fix diff.
Task 4: minor (deferred): report's self-review claim about `5_000` being flagged is wrong (harmless)
Task 4: fix round 1/5 (4 addressed, 0 open — evidence gap, retry:3 example, SC-TYPE waiver wording, enum vs as const; commits fc1f9e6..1bc24f2). Controller confirmed test/catalog-typescript.test.js 5/5 at 1bc24f2.
Task 4: minor (deferred): report overstated a Style-section edit; MAX_RETRIES undefined in fragment (harmless)
Task 4: complete (commits ac4d7cf..1bc24f2, review clean)
Task 5: dispatched (BASE 1bc24f2, implementer sonnet a47fbeaecd5940b84; PF-2 e2e update carried; TypeORM write-path scratch in p2-typeorm)
Task 5: implemented 1e4864a (352/352), DONE_WITH_CONCERNS: (1) AGENTS.md spring+4 add-ons now degrades to 3 bullets/rule (12,369 B; R24 by design); (2) TypeORM 0.3.31 observed: save/insert/update()/QB insert+update/increment call subscribers and event.entity changes persist; upsert-conflict/softDelete/restore/raw SQL do not; subscriber needs @EventSubscriber() — add-on written from observations; carry to Tasks 7/9; (3) serverExternalPackages ['typeorm'] to confirm in Task 9 scratch.
Task 5: review Needs fixes — Important: tenant repo leaves update/delete unfiltered; Essentials order loses tenant/masker bullets under 3-bullet degrade. Spec drift: leftover "never the body".
Ruling: fold review minors into fix round 1 (CT/N undefined, "mask partially / key-name patterns" contradiction, empty-default variable grammar, message_in field name, callListeners(false), weak contract tests, degrade-level assertion) — same files, user-visible wording on every default project — cost if wrong: larger fix diff.
Task 5: ⚠️ resolved — SSE skip comes from delta §4.2 ("SSE/streaming không log body"); Spring files are Task 6; serverExternalPackages deferred to Task 9 scratch.
Ruling: accept that spring-boot with 3+ add-ons degrades to 3 Essentials bullets per rule in AGENTS.md (e2e now pins '3 bullet(s) per rule' + 16,000 B cap) — R24 designed for this; the reorder puts the key contract bullets first — cost if wrong: Codex users see fewer inline bullets (full rules stay in the rules skill).
Task 5: fix round 1/5 (7 addressed, 0 open — tenant update/delete filter, Essentials order, wording, defaults grammar, message_in field, callListeners, pinned tests; commits 1e4864a..abc4219)
Task 5: minor (deferred→folded): persistence.md:163/typeorm rules.md:33 "never hand-write a where / never inject a QueryBuilder" vs persistence.md:192/typeorm:56 "or add the tenant condition explicitly". Ruling: fold into Task 7 dispatch — drop the explicit-condition escape hatch; tenant-entity writes go only through TenantScopedRepository — one consistent instruction for agents — cost if wrong: rare bulk writes need the repository to expose a method.
Task 5: minor (deferred): empty crossTenantRoles renders "none (cross-tenant access is disabled) ...; the system identity is also allowed" (awkward); empty-roles rendering untested
Task 5: complete (commits 1bc24f2..abc4219, review clean)
Task 6: dispatched (BASE abc4219, implementer opus acecd28da9ea70cb6; scratch p2-spring)
Task 6: implementer hit API rate limit mid-task (last step: ArchUnit SC-ENTITY); resuming same agent
Task 6: implemented b1bee61 (358/358), DONE_WITH_CONCERNS. Scratch proof on Boot 3.0–3.5 (masker 40 cases, audit, tenant isolation, missing tenant, cross-tenant, http_in/http_out lines, SC-ENTITY fail).
Ruling: accept P2-R6 deviation — isRoot exists from Boot 3.0 (Hibernate 6.1.5); no native-SQL fallback; native SQL on tenant tables banned outright — cost if wrong: none (stricter).
Ruling: accept the @PostLoad tenant guard (Hibernate <6.6 load-by-id ignored @TenantId; deleteById removed another tenant's row) — security fix found by the scratch proof — cost if wrong: a cross-tenant by-id lookup throws (mapped to 404) instead of returning empty.
Ruling: cross-tenant roles at runtime — Spring `app.tenancy.cross-tenant-roles`, Node env `CROSS_TENANT_ROLES`, both defaulting to conventions; Task 6's masker detail decisions are binding for Tasks 7–10 (written to cross-stack-decisions.md) — one behavior across stacks — cost if wrong: one more config key per stack.
Task 6: review dispatched (opus a31476d95f5c1683f)
Task 6: review Needs fixes — Important: (1) MDC can leak to next request when copyBodyToResponse throws; putContext keeps stale userId/tenantId; (2) failed-auth requests get no http_in line; (3) Spring Kafka consumer skill contradicts message_in/consumer-context rules (plan omission); (4) runCrossTenant honors systemUser from a JWT sub.
Ruling: extend Task 6 to catalog/stacks/spring-boot/skills/stackcrew-spring-kafka-consumer (runAs from x-tenant-id/x-user-id, requestId from x-request-id, message_in via BodyMasker, drop "never the payload") — plan omitted it; no later task covers it — cost if wrong: none.
Ruling: the system identity passes the cross-tenant check only inside a context created by the job/consumer runner (runAs / runWithRequestContext from a non-request entry point), never because a JWT sub equals systemUser — amends the plan's "userId equals systemUser"; applies to Tasks 7/9 (added to cross-stack-decisions.md) — cost if wrong: a system job started inside a request must use runAs explicitly.
Ruling: fold review minors into fix round 1 (cross-tenant-roles YAML default, multibyte truncation test, by-id no-tenant assertion in testing.md, non-JPA note, streaming/download skip, outbound read-failure line, cross_tenant line tenantId/CRLF) — verbatim-copied production code, round happening anyway — cost if wrong: larger fix diff.
Task 6: fix round 1 implemented b78948f (361/361; p2-spring Boot 3.2.12+3.5.16 84 run/0 fail). Concerns: stream wrapper decides at first write; streamed downloads lose Content-Length (chunked); Kafka add-on "never log payload" line also updated.
Task 6: minor (deferred): claim names (tenantClaim/rolesClaim) go raw into Java string literals; conventions validation only forbids whitespace — consider restricting to [A-Za-z0-9_.:-]
Task 6: fix round 1/5 (9 addressed, 1 partial + 2 new Important open — #9 inline image/pdf/other non-maskable still cached whole; NEW system identity forwardable via x-user-id/@Async runAs; NEW streamed downloads lose Content-Length and >2GiB fail; commits b1bee61..b78948f)
Ruling: system identity only via a dedicated job entry (Spring TenantContext.runAsSystem(tenantId, work); TS runAsSystem(tenantId, fn)); runAs(tenant, userId)/runWithRequestContext never grant it whatever the string; consumers never take system from x-user-id — closes forwarding path — cost if wrong: jobs must call runAsSystem explicitly.
Ruling: fold into round 2 the minors (tombstone null guard, UserMdc finally, YAML + TenancyProperties default rendered from conventions, sanitize consumer header values) and the out-of-scope gaps that contradict cross-stack-decisions (log filter before CorsFilter; stop skipping SSE requests) and persistence.md:16 wording — cost if wrong: larger round.
Task 6: fix round 2 implemented ab3a027 (361/361; scratch Boot 3.2.12/3.5.16 92 run 0 fail, 3.0.13 90 run 0 fail).
Ruling: add template variable `crossTenantRolesCsv` (plain comma-joined roles, empty list → empty string) in Task 7; use it for the Nest/Next CROSS_TENANT_ROLES default and update the Spring jpa-entity YAML + TenancyProperties default to render from it — Task 6 kept YAML [] (fails closed) for lack of a variable — cost if wrong: one more variable.
Task 6: fix round 2/5 (7 addressed, 0 open — runAsSystem-only system identity, tee wrapper keeps Content-Length/no buffering of non-maskable, no hard-coded role, tombstone, UserMdc finally, header sanitizing, CORS/SSE lines; commits b78948f..ab3a027)
Task 6: minor (deferred): catalog-spring test asserting kafka has no runAsSystem( cannot fail (assert on code blocks instead)
Task 6: minor (deferred): tee writer hides client disconnects (checkError always false); surrogate pair split across writes garbles captured copy
Task 6: minor (deferred): sendError/resetBuffer can make the logged body differ from what the client got (fail-safe)
Task 6: minor (deferred): Awaitility hasSize(1) guidance cannot catch a late duplicate; ListAppender list read across threads
Task 6: minor (deferred): request bodies cached type-blind up to 2 MiB (logging correct); firewall rejections get no line; runAsSystem callable inside a runAs scope (doc-only guard); system job async work told to use runAs
Task 6: minor (deferred): findById behaviour differs by Hibernate version (mapped to 404)
Task 6: complete (commits abc4219..ab3a027, 0 parked; review clean after 2 rounds)
Task 7: dispatched (BASE ab3a027, implementer opus ada487eeac5504f21; scratch p2-nest). Carried rulings: R-T7-a crossTenantRolesCsv var (+ Spring YAML), R-T7-b drop tenant explicit-condition escape hatch, runAsSystem-only system identity, one line per request incl. guard rejections, maskable-only capture, TypeORM observed write paths.
Task 7: implementer hit API rate limit near the end (last step: final scratch run for the report); resuming same agent
Task 7: implemented 4eaad53..a2c7612 (377/377; p2-nest tsc clean, Jest 81/81 real Postgres + JWKS), DONE_WITH_CONCERNS.
Ruling R-T7-e: accept middleware instead of HttpLoggingInterceptor (one line per request incl. guard rejections); Task 8 uses httpLoggingMiddleware, setupApp, CommonModule, OutboundHttpLogger — the plan's name was a mechanism guess; the spec only requires one line per call — cost if wrong: none.
Ruling R-T7-c: skill sibling code files must not match their stack's globs — TS siblings (.ts) are picked up by project tsconfig (Nest/Next include **/*.ts), Jest, ESLint and `stackcrew check`; Java siblings by `check`/IDE. Store them as Markdown (`<name>.ts.md` / `<name>.java.md`: a one-line "goes to <path>" header + one fenced block); validator enforces it; convert Nest (24) and Spring (16) siblings — cost if wrong: agents read .md instead of raw code (same content).
Ruling R-T7-d: tighten conventions validation — tenantClaim, rolesClaim, systemUser and each crossTenantRoles entry match ^[A-Za-z0-9_.:/-]+$ (safe in Java/TS literals, YAML and CSV) — closes Task 6/7 deferred minors — cost if wrong: an exotic role name must be mapped.
Pre-review fix sent to implementer for R-T7-c and R-T7-d.
Task 7: pre-review fixes a3d86b3 (R-T7-d) + ed96d65 (R-T7-c) (379/379)
Task 7: review dispatched (opus a7bd389c11eb60646) over ab3a027..ed96d65
Task 7: review Needs fixes — CRITICAL: (1) unbounded masker recursion: 10 KB nested JSON crashes the Node process pre-auth (probe: PROCESS EXIT 1); same in outbound/consumer; (2) rules' transaction guidance (EntityManager) lets tenant B update/delete tenant A rows (probe: affected=1). Spec: traceId missing; jwks-rsa/pino-pretty outside §3; Nest 10.0.0–10.0.3 ALS binding unproven.
Ruling (cross-stack masker contract amendment): nesting depth > 64 → the whole body becomes the `<CT N bytes>` placeholder (walk depth-capped or iterative); logging never throws — any masker/log failure still writes the one line with a placeholder body and never changes the request/call result. Applies to Spring BodyMasker/HttpLoggingFilter/LoggingClientInterceptor too (fixed in this round) and Next (Tasks 9/10) — cost if wrong: deep legit payloads log as placeholders.
Ruling: TenantScopedRepository.withManager(manager) is the only transactional path for tenant entities; rules (nestjs rules.md, addon-typeorm) rewritten; subscriber docstring corrected; spec case for tx update/delete → 0 — cost if wrong: none.
Ruling: accept jwks-rsa and pino-pretty (dev only) as "ask first" dependencies alongside nestjs-pino — JWKS is the team's stated auth (user: "jwt, jwks"); pretty logs are dev-only — cost if wrong: two deps to approve.
Ruling: emit traceId/spanId (camelCase) from the active OpenTelemetry span in contextLogFields when present — core-logging field parity — cost if wrong: none.
Ruling: state "NestJS ≥ 10.0.4" for the request-context interceptor in the skill (AsyncResource.bind first in 10.0.4) unless proven on 10.0.0 — cost if wrong: projects on 10.0.0–10.0.3 must upgrade a patch.
Ruling: fold minors into round 1 (ClientAbort status, SKIPPED_PATHS with global prefix, JWKS https outside tests, flaky updatedAt test, @Roles reference without guard) — verbatim-copied code — cost if wrong: larger round.
Task 7: fix round 1 implemented 833b009 (384/384; Nest Jest 86/86; Spring BodyMaskerTest 44/44 on Boot 3.5.16 + 3.0.13; crash probe survives; withManager 0 rows). Residual: raw manager.getRepository update/delete still crosses tenants — banned by rules/skill only.
Task 7: fix round 1/5 (10 addressed, 1 new Important open — serializedSize loops forever on a cyclic value; commits ed96d65..833b009). Residual raw manager path: reviewer judged the documented ban adequate.
Ruling: fold round-1 minors into round 2 (toJSON depth/levels, guarded fallbacks in Nest writeCallLine + Spring filter/interceptor, JWKS require_protocol, withManager rollback test, fallback specs, doc inconsistencies, "any manager method" ban wording, outbound non-JSON sizing via serializedSize keeping url) — verbatim-copied infra code that Next will mirror — cost if wrong: larger round.
Task 7: fix round 2 implemented 91ce08f (385/385; Nest Jest 92/92; Spring 69 run 0 fail; probes: cycle → placeholder, toJSON this → stops, writeCallLine never throws, withManager rollback ok).
Ruling: accept Spring last-resort as one shared LogFields.warnLineNotWritten(event, failure) in its own try (JDK logging is bridged into SLF4J, so a per-class JDK logger hits the same backend) — cost if wrong: none.
Ruling: keep the Spring logging-backend-failure test scratch-only (needs Logback TurboFilter wiring); catalog test pins the code shape — cost if wrong: that fallback path is proven only in scratch.
Task 7: fix round 2/5 (7 addressed, 1 new Important open — copied function-valued toJSON leaks unmasked values via serializeMasked/maskValue; commits 833b009..91ce08f)
Ruling: ratify placeholder `<CT {maxBodyBytes}+ bytes>` for "size unknown or over the cap after masking failed" as a masker-contract extension (all stacks) — documented, only after a masking failure — cost if wrong: overstated size on small cyclic values.
Ruling: fold round-2 minors/nits into round 3 (drop function-valued entries, wide-node cap check, Spring self-suppression guard, empty Buffer → no field in message_in fallback, file-table export, putUserContext inside try) — cost if wrong: none.
Task 7: fix round 3 implemented 22a83f5..b11e0ed (386/386; Nest Jest 94/94; Spring 76 run 0 fail; rv7b probes masked).
Ruling: accept "any function value becomes undefined in masked output" (stricter than dropping object entries; a function with its own toJSON would otherwise still leak via JSON.stringify) — logs less, safe direction — cost if wrong: a function-with-toJSON logs null/absent.
Ruling: accept Spring LogFields.warnLineNotWritten(event, failure, fallbackFailure) suppressing only distinct instances inside its own guard — cost if wrong: none.
Task 7: fix round 3/5 (7 addressed, 1 new Important open — Array-subclass species copy keeps inherited toJSON (masking bypass); Minor: Buffer/TypedArray sizing via Object.entries; commits 91ce08f..b11e0ed)
Ruling: round 4 = fresh implementer on a higher tier (fable) per the escalation rule. Preferred design (controller): normalize an already-parsed value by a guarded JSON round-trip (JSON.parse(JSON.stringify(value)) in try; any throw → placeholder), then mask plain JSON data — eliminates the toJSON/species/boxed-primitive bypass class and matches "what JSON.stringify would write" — cost if wrong: one extra serialization per logged object.
Task 7: fix round 4 implemented cd1660e by fresh fable implementer (387/387; Jest 95/95; probes clean; normalize via guarded JSON round-trip). Accepted concern: normalize cost linear in JSON size (sparse 2e8 ~6s) only on direct live-value calls — equals res.json cost — cost if wrong: slow log on pathological values.
Task 7: fix round 4/5 (3 addressed, 0 open — Array-subclass bypass, Buffer sizing cost, boxed primitives/BigInt; commit cd1660e)
Task 7: minor (deferred→folded into Task 8): stale wording — body-masker.spec.ts.md:90 comment, core/rules/logging.md:60 unknown-size list (add stack-overflowing nesting), outbound-http-logger.ts.md:122 "bounded size", catalog-nest.test.js:921 message; outbound responseBody has no 2 MiB capture cap (parity with inbound).
Task 7: minor (deferred): deep parsed values (>~2229 levels, less under deep call stacks) log N+ instead of exact size; placeholderFor(undefined) → 0 bytes (unreachable)
Task 7: complete (commits ab3a027..cd1660e, review clean after 4 rounds; raw manager.getRepository residual accepted as rule-only per reviewer)
Task 8: dispatched (BASE cd1660e, implementer opus a9dcfb6b0276710fa; folded R-T8-a..d wording + outbound responseBody 2 MiB cap; scratch p2-nest + RabbitMQ)
Task 8: implemented 974299a..aee0804 (395/395; p2-nest tsc clean, 148/148; RabbitMQ 4 + 3.13), DONE_WITH_CONCERNS.
Ruling: shipped Nest skill code must pass the shipped stackcrew ESLint config — Task 7 code uses `object` type and `2 * 1024 * 1024`; fix before review (Task 7+8 files; run eslint.stackcrew.mjs over p2-nest src; update pinned tests) — examples that fail our own lint teach agents to violate it — cost if wrong: none.
Ruling: accept cockatiel 3.x and amqp-connection-manager 4.1.x pins (v4/v5 are ESM-only; Jest cannot load them) — cost if wrong: projects on newer majors adapt imports.
Ruling: accept prefetch-ordering note, Idempotency-Key in prose only, fixed queue retry delay — documented limits — cost if wrong: minor.
Ruling: accept Task 7 file edits made for copy-consistency (rules.md mapper-built DTO, request-logging §7 KycModule, exported entity lengths, env.spec values) — pinned by tests — cost if wrong: none.
Task 8: pre-review lint fix a1f73d5 (396/396; ESLint 0 problems on p2-nest src+test with NEW_FLAT_CONFIG; Jest 148/148).
Note for final review: Spring skill code passed shipped checkstyle.xml at Task 6 round 0 (report §Checkstyle); later Task 6/7 rounds changed Spring code — re-check in Task 12/final review.
Task 8: review Needs fixes — Important: (1) no 'error' listener on ChannelWrapper → failed setup (e.g. PRECONDITION_FAILED on redeclare) crashes the process (probe exit 1); readiness stays healthy; (2) outbound idempotency key = requestId field, invites using client-controlled x-request-id (cross-tenant/KYC bypass risk).
Ruling: outbound idempotency key is server-generated once per business operation and stored before the call (e.g. the verification record id); never the inbound x-request-id or a raw client Idempotency-Key; field named idempotencyKey; traceRef separate — applies cross-stack (Spring provider skill wording to re-check in final review) — cost if wrong: none.
Ruling: message_in payload capture capped at 2 MiB like http_in/http_out (Nest template §8 + consumer; cross-stack note) — cost if wrong: none.
Ruling: fold minors into round 1 (per-attempt timeout bound + maxContentLength + softened worst-case sentence, page upper bound, non-empty API key, ack outside handler classification + graceful consumer cancel/drain on shutdown, wording fixes) — cost if wrong: larger round.
Task 8: fix round 1 implemented 053d014 (397/397; Jest 154/154; ESLint 0; consumer stays up + not-ready on setup failure; reconnect 5 s). Accepted concern: a persistently failing setup reconnects the shared connection every 5 s (interrupts publishing) — documented.
Task 8: fix round 1/5 (8 addressed, 1 new Important open — outbound SKILL §9 "call first, then persist" contradicts §6 store-key-before-call; commits a1f73d5..053d014)
Ruling: fold round-1 minors/OOS into round 2 (broker-cancel recovery via wrapper consume or honest wording, readiness-probe-only wording, stopping guard in setup, bounded cancel, outer catch comment, body-read failure after headers classified retryable/unavailable, testing-skill cover list, order-independent consumer e2e rows) — cost if wrong: larger round.
Task 8: fix round 2 implemented 0cadc17 (398/398; scratch 17 suites/160; consumer e2e 13/13 x5 seeds). Concerns: broker-closed channel recovery = full reconnect pausing publishing (wording incomplete); stopping guard + bounded cancel lack mutation proof.
Task 8: fix round 2/5 (8 addressed, 1 open — broken-2xx retry relies on axios >=1.16.0 which the catalog does not require; commits 053d014..0cadc17)
Ruling: require axios >= 1.16.0 where axios is listed (request-logging deps, outbound §6) and pin it in scratch — older axios drops the partial response — cost if wrong: projects on axios 1.7–1.15 must upgrade a minor.
Ruling: fold into round 3 — operation-row lifecycle (start() dedupe via partial unique index on tenant+subject PENDING or 202+separate run; terminal FAILED on provider 4xx; where evidence/reference lives; orphaned PENDING pickup note), neutral cancel-cause wording + publishing-pause note, stale connection comment, migration timestamp note, readiness-coupling consequence (consider a separate consumer Deployment), bounded channel/connection close on shutdown — AND the Spring out-of-scope contradiction of the binding outbound-idempotency decision (spring rules.md:88, integration-provider SKILL.md:351 "call first, then persist", :430 key "derived from the business request id") — cost if wrong: larger round.
Task 8: round-3 implementer stalled (watchdog, last step: Spring compile harness); resuming
Task 8: fix round 3 implemented 8b6d954 (Nest) + d4c9b36 (Spring parity) (400/400; scratch 163/163; Spring provider blocks compile).
Task 8: minor (deferred): Spring provider skill lacks the Nest operation-row dedupe and terminal FAILED state (ordering parity only); Spring compile used stubs, not run.
Task 8: fix round 3/5 (5 addressed, 1 new Important open — N1 FAILED can overwrite a concurrent success (409 key-in-use → Rejected → FAILED; COMPLETED update affected-count ignored), made reachable by the new dedupe; commits 0cadc17..d4c9b36)
Ruling: round 4 = fresh implementer (fable). Fold N2 (shutdown order sentence/publisher close in beforeApplicationShutdown), N3 (concurrent starts on a fresh profileId), N4 (pattern-guide template-method requestId → traceRef), upsert updatedBy assertion, Spring rest-endpoint "call first, then persist" phrase, §9 dedupe-reuses-key sentence — cost if wrong: larger round.
Ruling: provider 409 (idempotency key in use) and 401/403 (credential/config) are classified unavailable/retryable, not a refusal; a 0-row COMPLETED update reloads and acts on stored state; COMPLETED may replace FAILED — cross-stack (Spring provider classification to check in final review) — cost if wrong: a genuine 403 refusal retries until the circuit opens.
Task 8: fix round 4 implemented ef3d2c0 by fresh fable implementer (401/401; Jest 169/169; ESLint 0).
Task 8: minor (deferred, final review): Spring AbstractProviderAdapter still treats 409/401/403 as rejected — cross-stack parity with the round-4 ruling.
Task 8: fix round 4/5 (7 addressed, 1 new Important open — COMPLETED transaction's documented side writes commit when the guarded update affects 0 rows; commits d4c9b36..ef3d2c0)
Ruling: round 5 resumes the round-4 fable implementer (same top tier, already the fresh-eyes escalation; it holds the context) rather than a second fresh agent — cost if wrong: less fresh perspective on the last round.
Ruling: fold minors into round 5 (row (c) call-count assert, spec for the ended===0 FAILED-path branch, stale "do not retry a 4xx" wording in SKILL.md:139 and provider-call.policy, drop cached token on 401 before retry, In([PENDING, FAILED]) instead of Not(COMPLETED), shutdown e2e waits for handler start + close in finally, credential-fault log distinction/alert note).
Task 8: fix round 5 implemented f90dc36 (402/402; Jest 170/170; KycOutcomeEffects seam; side writes only on 1-row update).
Task 8: fix round 5/5 (8 addressed, 1 new Important open — @Optional KYC_OUTCOME_EFFECTS binding with no wiring example can silently drop side writes; commits ef3d2c0..f90dc36). Breaker tripped.
Task 8: Ruling (breaker adjudication): finding is real; smallest unblocking change = drop @Optional, bind an explicit no-op default for KYC_OUTCOME_EFFECTS in KycVerificationModule.providers with a comment showing how to replace it, plus seam doc rules (failed may be superseded by completed; DB writes only, no remote calls under the row lock; read outcome from `result`), an effect-throws rollback spec row, and the stale file-table rows — carried as housekeeping into the Task 9 dispatch (Next mirrors this seam) — cost if wrong: one more small Nest commit inside Task 9.
Task 8: minor (deferred): probe effect uses raw manager.query (non-tenant table; fine)
Task 8: complete (commits cd1660e..f90dc36, 1 carried — effects binding fix carried into Task 9)
Task 9: dispatched (BASE f90dc36, implementer opus ab48a86a533416d47; housekeeping: Nest effects binding first; scratch p2-next)
Task 9: implemented 6862a52 (Nest effects housekeeping) + 491db95 + 5a31812 (420/420; p2-next Next 16.4.3 + 16.0.11: tsc, ESLint 0, Vitest 84+7, next build clean, one line per call, no mixed contexts).
Task 9 findings: Next evaluates server modules once per layer → one DataSource per layer on globalThis (typeorm add-on text updated); typeorm in serverExternalPackages recommended not required (Task 5 claim corrected), pino required on 16.0; withRouteLogging(route, handler).
Task 9: review Needs fixes — Important: an error whose cause is a Next control-flow error gets no http_in line (unstable_rethrow recurses into cause; wrapper treats it as bailout). Ruling: fold all 8 minors into fix round 1 (revalidateTag(tag,'max'), AUTH_SECRET validation, Nest name in Next spec, dev DataSource map growth, pool wording, nested wrapped actions note, yarn vs npx, spec row) — cost if wrong: larger round.
Task 9: fix round 1 implemented 24048cd (421/421; scratch 16.4.3 + wrapper specs on 16.0.11).
Task 9: fix round 1/5 (8 addressed, 0 open; commits 5a31812..24048cd)
Task 9: minor (deferred): redirect digest accepted without checking replace/push segment (Next never emits malformed); rules.md:134 tells user code to call unstable_rethrow in catch (correct, could confuse)
Task 9: minor (deferred): Next prints uncaught error messages to stderr itself; action log status = outcome status; next-auth v5 beta; tested 16.0.11 + 16.4.3 only
Task 9: complete (commits f90dc36..24048cd, review clean after 1 round)
Task 10: dispatched (BASE 24048cd, implementer opus aca22216f9a9c06c7; scratch p2-next)
Task 10: implemented a66c5bb + 0611728 (428/428; scratch Vitest 117+11, Playwright 9/9, next build OK).
Task 10: review Needs fixes — Important: TanStack Table not pinned to v8 (npm latest v9 breaks the sibling); {{sc:sharedComponents}} used as path for placement but imports hardcode @/components/ui. Ruling: fold minors (neutral CONFLICT text + partial-unique-index note, CI retry tolerant, unauthenticated E2E, route-handler auth-before-parse for Nest parity, page-past-last cosmetic, success focus a11y) into round 1 — cost if wrong: larger round.
Task 10: fix round 1 implemented 57ab98a (429/429; Playwright 11/11; non-default sharedComponents proven with manual alias step).
Task 10: fix round 1/5 (8 addressed, 0 open; commits 0611728..57ab98a)
Task 10: minor (deferred→Task 11): feature-page SKILL.md:53 "Empty state" bullet contradicts the new past-last-page bullet — fold into Task 11 dispatch.
Task 10: minor (deferred): non-default sharedComponents still needs a manual import-alias step (documented)
Task 10: complete (commits 24048cd..57ab98a, review clean after 1 round)
Task 11: dispatched (BASE 57ab98a, implementer sonnet a39d7c7c050478f22; folded feature-page empty-state wording)
Task 11: implemented a929b7a (434/434).
Task 11: review Approved (spec ✅).
Task 11: minor (deferred→Task 12): init step 8 rendered in plugin contradicts itself ({{sc:cli}} expands to node cache path, then "never print a node command against it"); sync.md TS exit-1 list incomplete (config w/o eslint dep, eslint <8, ESLint>=9 legacy-only, ESLint 8 no config) and "no file is changed" ambiguous; "eslint.config.*" should be js|mjs|ts|mts (sync.md + init step 7); topic 10 skips rolesClaim for single-tenant (should skip only tenantClaim + crossTenantRoles). Ruling: fold all four into Task 12 dispatch — cost if wrong: none.
Task 11: complete (commits 57ab98a..a929b7a, review clean)
Task 12: dispatched (BASE a929b7a, implementer sonnet a3b72fca7d9b4cf85; folded R-T12-a..d doc fixes)
Task 12: implemented 2677f6f (460/460; 0.2.0). Budgets: AGENTS.md spring 13113 B / nest 12907 / next 13419 with all add-ons (3-bullet degrade); own add-ons nest 15540 / next 15354 no warning; Cursor max 296 lines; Antigravity max 17250 B. M8 developer preload: spring 101,467 B, nest 93,236, next 76,397 (7 skills each).
Ruling: accept removal of a test-only credentialed postgres URL from catalog/stacks/nextjs/testing.md found by the new secret scan — cost if wrong: none.
Task 12: review Needs fixes — README stackcrew list example stale + --force kept-list; R-T12-a contradiction only worded around; replacement DATABASE_URL has no user. Ruling: init step 8 offers slash commands in Claude Code and, for other tools, the plain CLI form 'stackcrew sync|add|check' (README explains how to run it), never {{sc:cli}} — removes the plugin-cache path from advice — cost if wrong: users read README for the exact runner. Fold minors (manual-checklist baseline commit, drop hard-coded byte comments, idempotence compares bytes).
Task 12: fix round 1 implemented 0cd5374 (460/460).
Task 12: fix round 1/5 (5 addressed, 0 open; commits 2677f6f..0cd5374)
Task 12: minor (deferred): README.md:574 sample output still "(kept: decisions, context, java settings)" vs init.js "(kept: decisions, context, conventions, java/node settings)"; init step 8 "see the README" ambiguous inside a user project; POSTGRES_HOST_AUTH_METHOD applies only on first volume init (note)
Task 12: complete (commits a929b7a..0cd5374, review clean after 1 round)
ALL TASKS COMPLETE. Next: final whole-branch review b914ad7..HEAD.
FINAL REVIEW: dispatched (fable aca084a05899c57eb) over b914ad7..0cd5374
FINAL REVIEW: With fixes. No Critical. Important: (1) core-logging.md:46 "skip SSE" contradicts binding decision; (2) Spring provider status classification parity (409/401/403). Minor 3–9. Spring checkstyle re-check VERIFIED CLEAN (0 violations, 18 files). All ledger deferred minors triaged CAN-WAIT.
Ruling: final fix wave includes Important 1–2 and Minors 3–8 (Minor 9 trailing-comment guard noted, not fixed; same as Java guard style); Spring operation-row dedupe/FAILED + side-write seam parity stays a tracked follow-up (bigger Spring content change) — cost if wrong: Spring lacks two Nest lifecycle refinements until the follow-up.
FINAL FIX WAVE: c0677a0 + 1cd2ba7 (465/465; p2-spring Boot 3.2.12 green; checkstyle 0 violations on changed files). Concern: Spring §8 still lacks FAILED-on-refusal and 1-row side-write gating (tracked follow-up per ruling).
Observed (not by controller agents): main was fast-forwarded to 0cd5374 and origin/main is at 0cd5374 (user merged + pushed Plan 2 during the rate-limit wait); local branches renamed (main_ tracks origin/main; new 'main' at 0cd5374; 'branch' at b914ad7). Fix-wave commits are on feat/plan-2-nest-next only.
FINAL FIX WAVE re-review: all 8 addressed, no new breakage. Final review clean.
