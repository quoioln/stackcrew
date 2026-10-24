# SDD ledger — plan: docs/superpowers/plans/2026-10-24-stackcrew-plan-1-core-spring-boot.md

Spec: docs/superpowers/specs/2026-10-24-stackcrew-design.md (reachable)
Branch: feat/plan-1-core-spring-boot (base main c1cfc93 = docs-only commit)
Ruling: Work on branch feat/plan-1-core-spring-boot in place instead of a worktree. — The repo is brand new and has no other users; main holds only the docs commit. — If wrong: nothing to undo beyond deleting the branch.
Ruling: Commit spec and plan to main as c1cfc93 before Task 1. Task 1's commit therefore does not include docs. — Branching needs a commit to start from; the user authorized commits. — If wrong: one docs commit lives on main.

## Pre-flight scan

### Shared files and interfaces between task pairs
| Tasks | Producer → consumer | Finding |
|---|---|---|
| 1 → 12, 14, 16 | `main(argv, io{cwd,stdout,stderr,isTTY})` → `<name>Command(args, io)` | consistent |
| 1 → 3, 16 | `getCatalogDir()` honoring `STACKCREW_CATALOG_DIR`; `PKG_ROOT` | consistent |
| 2 → all | `parseFrontmatter`/`stringifyFrontmatter`/`fillTemplate({{sc:x}})`/`matchesAny`/`sha256` | consistent |
| 3 → 5, 7–11, 16 | `Catalog` shape (`alwaysOn`, `coreRules`, `stacks`, `addons`, `sharedSkills`, `roles`, `pluginCommands`) | consistent |
| 3 → 16, 21 | `pluginCommands` + `stackcrew-init` (kind command) templated with plugin `cli` | **conflict:** see R1 |
| 4 → 12, 15 | `createProfile` / `validateProfile` / `detectProject` (`basePackage`) | consistent |
| 5 → 7–11 | `RenderContext` (`rules`, `alwaysOn`, `skills`, `commandSkills`, `roles`, `skillDirs`, `vars`) | consistent |
| 6 → 12, 15 | `applyOps` / `upsertMarkedBlock` / `MD_MARKERS` / `GRADLE_MARKERS` | consistent |
| 8 ↔ 9 | AGENTS block names skill `stackcrew-<stackId>-rules` ↔ Codex renders the same name | consistent |
| 11 → 13, 14 | `.stackcrew/guard.json` `{version, enabled, rules}` ↔ hook (honors `enabled`) and check (ignores `enabled`) | consistent |
| 11 ↔ 15 | wire files rendered when `profile.java.wired` ↔ Task 15 sets `wired = true` | consistent |
| 12 ↔ 15 | Task 12 `--wire` stub → Task 15 implements it in `run-sync` | consistent (sequenced) |
| 14 | where `guard.json` is read; diff paths | **ambiguous:** see R2 |
| 16 → 17–22 | drift test against the real catalog, which is absent at Task 16 | **gap:** see R3 |
| 17–21 → 3 | content must pass `validateCatalog` (descriptions, Essentials, banned phrases) | consistent |

### Self-consistency per task
| Task | Tests vs. code / files | Finding |
|---|---|---|
| 1 | commit step says the first commit includes spec and plan | already committed on main (ruling above) |
| 2 | stringify quoting rule ↔ the test `globs: "**/*.java"` | consistent |
| 3 | mini-catalog skills must all validate | the brief gives a description only for demo-task. The implementer must make demo-kafka and demo-testing descriptions valid too (contain "Demo Java", start with "Use when") |
| 4 | consistent | — |
| 5 | rule order test fixed to alphabetical core rules | consistent |
| 6 | consistent | — |
| 7 | owned-prefix test ↔ `.claude/skills/stackcrew-*/**` (includes supporting files) | consistent |
| 8–10 | consistent | — |
| 11 | duplicate-path check ↔ the Codex rules skill and `renderSkills` use distinct names | consistent |
| 12 | consistent | — |
| 13 | `Edit` line numbers are relative to `new_string` | acceptable; message wording see R4 |
| 14 | consistent apart from R2 | — |
| 15 | consistent | — |
| 16 | the init skill comes from the catalog | see R3 |
| 17 | real-catalog validation while stacks/roles are absent | the plan already says validation covers only present items |
| 18–22 | consistent | — |

### Rulings
- R1 Ruling: catalog command skills (`stackcrew-init`) and `plugin-commands/*` may use only `{{sc:cli}}` and `{{sc:version}}`. `validateCatalog` reports any other placeholder in them. — The plugin build has no stack, so any other var would throw `TEMPLATE`. — If wrong: one validation rule to relax.
- R2 Ruling: `check` resolves `.stackcrew/guard.json` and all diff paths relative to `git rev-parse --show-toplevel`, since there is one stack per repo and `stackcrew.json` sits at the repo root. — If wrong: monorepo subfolder use needs a `--cwd` flag later.
- R3 Ruling: `buildPlugin` skips command skills missing from the catalog (no `stackcrew-init` before Task 21) and copies `catalog/` only if it exists. Every content task (17–21) regenerates `plugin/` before committing, so the drift test stays green. — If wrong: the drift test fails loudly, nothing silent.
- R4 Ruling: for `Edit`/`MultiEdit` the hook reports line numbers relative to `new_string`, prefixed `~` (e.g. `A.java:~3`). For `Write` and `check` it reports exact lines. — Absolute lines would need the current file contents, which the plan doesn't require. — If wrong: cosmetic only.

## Progress
Task 1: complete (commits c1cfc93..7aaaf6c, review clean)
Task 1: minor (deferred): help test uses includes(c) (weak); bin has no catch for thrown errors (handled in Task 12 ruling R5); bin mode 100644; backslash via fromCharCode in package test; no direct test of STACKCREW_CATALOG_DIR override; extra -h/-v aliases
- R5 Ruling: Task 12 adds a top-level catch in src/cli.js main(): StackcrewError → print "stackcrew: <message>" to stderr, return 1; unknown errors rethrow. — Plan specifies codes but no handler; users must not see stack traces for expected errors. — If wrong: cosmetic.
Task 2: review 1 → Needs fixes (Important: malformed {{sc:..}} passes silently; confirmed gap: backslash round-trip test claimed but absent). Fix round 1 dispatched (FIX_BASE 7c99837).
Task 2: minor (deferred): stringify writes "true"/"false"/"null" strings bare (lossy) and newline strings unquoted; UTF-8 BOM before --- yields empty frontmatter (see R6); body LF-normalized only when frontmatter present; glob `**/**` and `{**/a,b}` mis-compile; matchesAny recompiles regex per call (perf for check/hook); missing tests (a/**/b, bare-dir match, .\ prefix, empty block list)
- R6 Ruling: Task 3 loader (and Task 5 loadCustomRules) strip a leading UTF-8 BOM before parsing. — Windows PowerShell 5.1 writes BOMs; a BOM would silently drop frontmatter. — If wrong: harmless.
Task 2: fix round 1/5 (2 addressed, 0 open; commits 7c99837..b037926). Controller ran npm test: see below.
Task 2: minor (deferred): weak assertion /n/ on non-string template error message (test/util.test.js:51)
Task 2: complete (commits 7aaaf6c..b037926, review clean after 1 fix round)
Task 3: review 1 → Needs fixes (Important: mini guard.json regex "\b" is JSON backspace). Fix round 1 dispatched (FIX_BASE 0d92b1c).
Task 3: minor (deferred): loader coerces non-array values (arr()/String()) so validator type checks are dead; guard.json without `rules` / top-level array silently loads [] (guard silently disabled — Task 18 test must assert real java guard rules match); role id / plugin-command name not checked against filename; loose /kind/ /model/ test regexes; nested bullets bypass 15-bullet limit
- R7 Ruling: `title` frontmatter is mandatory on every RuleDoc file (core, language, stack rules/testing, addon) — Shared types make RuleDoc.title a string and the validator requires it; content tasks 17–19 dispatches will state it. — If wrong: one validator line to relax.
Task 3: fix round 1/5 (1 addressed, 0 open; commits 0d92b1c..68f99d3)
Task 3: complete (commits b037926..68f99d3, review clean after 1 fix round)
- R8 Ruling: DetectSpec with empty `files` but non-empty `contains` scans default manifests (pom.xml, build.gradle, build.gradle.kts, package.json) — implementer's choice to make the mini fixture addon detectable; real catalog addons (Task 19) always list `files` explicitly. — If wrong: an addon could be detected from an unintended manifest; low impact.
Task 4: review 1 → Needs fixes (Important: BOM test vacuous; literal U+FEFF chars in source). Fix round 1 dispatched (FIX_BASE 4d41ac6).
Task 4: minor (deferred): createProfile default tools aliases exported TOOLS array; readProfile returns null for JSON `null` content and rethrows raw non-ENOENT errors; basePackage readdir order unsorted + substring match of @SpringBootApplication; `src` file vs dir; java.wired not validated boolean; no tests for 2000-file cap / per-file excludeContains
Task 4: fix round 1/5 (1 addressed, 0 open; commits 4d41ac6..cb3d59f; implementer mutation-checked BOM tests)
Task 4: complete (commits 68f99d3..cb3d59f, review clean after 1 fix round)
Task 5: review 1 → Needs fixes (Important: alwaysOn joined w/o separator; duplicated non-equivalent extractEssentials). Fix round 1 dispatched (FIX_BASE 1164bca). Implementer skipped separate RED step (procedural; reviewer judged non-blocking).
Task 5: minor (deferred): unknown profile addon ids silently dropped in buildContext (validateProfile upstream covers it); role order contract untested; model assertion weak; templating test lacks positive assertions; title non-string branch untested
Task 5: fix round 1/5 (2 addressed, 0 open; commits 1164bca..4aea130)
Task 5: minor (deferred): alwaysOn becomes '\n' when everything empty
Task 5: complete (commits cb3d59f..4aea130, review clean after 1 fix round)
Task 6: review 1 (opus) → Needs fixes (Critical: non-UTF-8 hosts corrupted; Important: case-only path change deletes kept file; corrupt-manifest test can't fail on deletion). Fix round 1 dispatched (FIX_BASE 4837704).
- R9 Ruling: Reviewer Minor "markers matched as substrings" is upgraded into the fix loop as a spec gap — spec §9 / Review Focus 4 require text outside the marked block to stay byte-identical; substring matching alters user prose. — If wrong: one extra small fix.
Task 6: minor (deferred): directory at owned/stale path + force fails mid-write (breaks two-phase); block content containing a marker yields a file the next run rejects; owned op may target MANIFEST_PATH; block hosts written truncate-then-write (not atomic); test gaps (dryRun with deletions/edits, manifest hash after force, empty segment case, tmp dirs not cleaned); stale manifest paths not checked against owned-prefix list / docs/sdlc ban (hash-gated; defense-in-depth)
Task 6: fix round 1/5 (4 addressed, 0 open; commits 4837704..ad739e1)
Task 6: minor (deferred): case-only rename on case-sensitive FS leaves orphan old-case file; toLowerCase not full Unicode case-fold/NFC; bare-\r hosts get duplicate block each run; markers inside fenced code still count
Task 6: complete (commits 4aea130..ad739e1, review clean after 1 fix round)
- R10 Ruling: shared renderer test helper lives at `test-helpers/render-ctx.js` (repo root, not under test/) exporting `miniCtx(tools, {addons, wired})` — avoids node --test default pattern `**/test/**/*.js` and is outside package `files`. Tasks 8–11 reuse it. — If wrong: move one file.
Task 7: stringifyFrontmatter emits empty array as bare 'key:' (YAML null) — agents with empty skills omit key (controller-approved fallback)
Task 7: complete (commits ad739e1..742c775, review clean)
Task 7: minor (deferred): empty globs → bare `paths:` (custom rule with globs: [] or stack with no globs); loose startsWith assertion test:167; no test for role with empty skills omitting key; agent body glued after frontmatter without blank line
Ruling: Tasks 8–10 batched into one implementer dispatch + one review (same-shape small renderers, separate commits) — reduces per-task overhead; review covers 742c775..HEAD as one unit. — If wrong: a finding may need splitting per task.
Ruling: leave mixed Co-Authored-By trailers (Opus 5.5 vs Sonnet 5.5 on 07c2721..e21ce67) unamended — rewriting history for attribution wording is not worth it; both are Claude attribution. — If wrong: cosmetic; can amend before merge.
Task 8: complete (commits 742c775..07c2721, batch review clean)
Task 9: complete (commits 07c2721..dc28b47, batch review clean)
Task 10: complete (commits dc28b47..e21ce67, batch review clean)
Task 8-10: minor (deferred): [T9] TOML multiline body leaves control chars U+0001-08,0B-1F,7F and lone CR raw (invalid TOML if custom content has them); [T8] cursor line count off-by-one at boundary; [T8] BUDGET top-3 ranks by essentials even when codex absent; [T10] tests use substring 'skills' check and unguarded find(); T10 no separate RED run
Task 11: review 1 → Needs fixes (Important: pipe escape no-op + vacuous test). Fix round 1 dispatched (FIX_BASE 15fd123); newline-in-cell folded into the same fix (same function, ruling: cheap and same root cause of broken table rows).
Task 11: minor (deferred): wire path trusts basePackage (validated by validateProfile regex + applyOps rejects ..; no extra guard needed); duplicate assertion test:189
Task 11: fix round 1/5 (1 addressed, 0 open; commits 15fd123..839d3d3)
Task 11: minor (deferred): cell() doesn't escape pre-existing backslash before pipe (a\|b → a\|b splits cell)
Task 11: complete (commits e21ce67..839d3d3, review clean after 1 fix round)
Note: implementer-common.md gained a backslash-verification warning (recurring tooling issue in Tasks 9, 11).
- R11 Ruling: accept StackcrewError code 'CLI' for argument/usage errors (added to the documented code set). — Distinct from PROFILE/RENDER; harmless. — If wrong: rename one code.
Task 12: review 1 → Needs fixes (Important: init --force drops decisions/context/java; init forwards --force to sync overwriting hand edits). Fix round 1 dispatched (FIX_BASE b28cc12).
- R12 Ruling: `init --force` carries over decisions, context, java.basePackage (and java.wired if still a java stack) from an existing valid profile and prints that it did; `init` never forwards force to runSync (hand-edited files are only overwritten by an explicit `sync --force`). — Interview decisions are the user's work; spec §6.3/§9 manifest rules protect hand edits. — If wrong: user must hand-reset decisions via editing stackcrew.json.
Task 12: minor (deferred): profile written before catalog validation/--wire check (init leaves profile on failure); corrupt-profile and invalid-catalog exit paths untested; --dry-run summary not labelled; promptForStack bypasses io streams; skipped hint on stdout while exit 1; no tests for --no-guard / invalid --tools / alwaysOn custom rule; test/cli.test.js 'unimplemented' test now uses `check` (Task 14 must update it)
Task 12: fix round 1/5 (2 addressed, 0 open; commits b28cc12..015b7f5)
Task 12: minor (deferred): wired carry-over and non-java case untested; "overwriting" line printed before validateProfile
Task 12: complete (commits 839d3d3..015b7f5, review clean after 1 fix round)
Task 13: review 1 (opus) → Needs fixes (Important: symlinked entry disables hook; blank regex fail-closed; plan-mandated Edit fragment-diff FP/FN). Fix round 1 dispatched (FIX_BASE 067e0e3).
- R13 Ruling: Edit/MultiEdit are evaluated by applying the edit(s) to the current file and multiset-diffing full before/after text (exact line numbers); fragment diff with `~` lines only as fallback (file unreadable or old_string not found). Supersedes R4 for the normal path. — Spec §8.1 intent is "only newly added content" at line granularity; fragment diff loses line context causing false positives and false negatives in the core guard. — If wrong: slightly more hook work per edit (reads one file).
- R14 Ruling: unreadable-existing-file and `..`-escaping paths are folded into the fix loop as fail-open spec gaps (brief: any failure / outside-project → exit 0). — If wrong: harmless.
Task 13: minor (deferred): stderr unbounded for many violations (cap list); back-to-back allow markers; missing message prints undefined; spawn helper relies on || fallback without comment; no test for missing tool_input / non-string file_path; no RED run captured
Task 13: fix round 1/5 (4 addressed, 0 open; commits 067e0e3..972346f)
Task 13: minor (deferred): Edit old_string with \n on CRLF file falls back to fragment diff (errs toward blocking)
Task 13: complete (commits 015b7f5..972346f, review clean after 1 fix round)
Task 14: review 1 → Needs fixes (Important: quoted path w/ trailing TAB + octal not decoded → file silently unscanned; diff prefix depends on user config; no real-git tests for no-merge-base/detached/rename). Fix round 1 dispatched (FIX_BASE fcc6af0).
- R15 Ruling: `check` argument errors exit 2 (cannot-run class), not 1 — CI must distinguish "could not run" from "violations found". — If wrong: trivial.
Task 14: minor (deferred): "not a git repository" hides real cause (safe.directory); dangling untracked symlink → exit 2 locally; --base with --staged silently ignores --staged; -diff/binary attributes silently skipped (document); no-merge-base message could hint shallow clone
Task 14: fix round 1/5 (4 addressed, 0 open; commits fcc6af0..cf41c42)
Task 14: minor (deferred): decodeQuoted iterates UTF-16 units (astral chars in quoted paths → U+FFFD)
Task 14: complete (commits 972346f..cf41c42, review clean after 1 fix round)
Task 15: review 1 → Needs fixes (Important: wired=true + ArchUnit test emitted when no build file wired → broken compile). Fix round 1 dispatched (FIX_BASE 34edb05).
- R16 Ruling: java.wired/basePackage persisted only if ≥1 build file carries ArchUnit (marked block present/inserted, or user already declares archunit-junit5 → skip insert + note); otherwise sync continues without wiring, prints snippet + re-run hint, exits 1. Folds reviewer Minor "duplicate dependency" into the same gate. — Spec: never leave the user's build broken; --wire was explicitly requested so failure must be visible. — If wrong: user re-runs --wire after adding dep.
Task 15: minor (deferred): pom inner indent always marker+4 (cosmetic in 2-space poms); <build\b mask matches <build-foo> (fails closed); duplicated strict-UTF-8 check (export shared helper); multi-file wiring writes not atomic
Task 15: fix round 1/5 (1 addressed, 0 open; commits 34edb05..cfc4166)
Task 15: minor (deferred): declaresArchunit substring matches archunit-junit5-api (use word boundary); `//` in Gradle string blanks rest of line; wire hint printed after failed wire
Task 15: complete (commits cf41c42..cfc4166, review clean after 1 fix round)
Task 16: complete (commits cfc4166..ea9e906, review clean)
Task 16: minor (deferred): pluginCommand honors STACKCREW_CATALOG_DIR for skills but copies pkgRoot/catalog (mismatch if env set); bundled hook.js not spawned from plugin copy in tests; catalog-copy branch and init skill files loop untested; plugin validate warnings: no author/license/icon/marketplace description
Task 17: review 1 → Needs fixes (Important: SC-TYPE omits JsonNode/Map<?,?>; conflicting waiver path in type-safety; SC-PREFLIGHT trigger/location unspecified). Fix round 1 dispatched (FIX_BASE a46cc3a).
- R17 Ruling: rule text must not contradict the guard or itself — always-on allow-marker scope corrected to same line only (guard/check behavior + spec §8.1); backend-api migration reversible vs forward-only reconciled. Folded into fix loop. — If wrong: harmless clarifications.
Task 17: minor (deferred): "large dependency" yardstick; outbox/idempotent consumer duplicated in backend-api Essentials+Detail; locking qualifier dropped; brownfield lost "100%" diff coverage; WCAG 2.1 vs 2.2; tests don't pin Decision gate bullets / Do-Don't-Exception shape; leak test narrow
Task 17: fix round 1/5 (5 addressed, 0 open; commits a46cc3a..3b14d14)
Task 17: minor (deferred): preflight trigger "constant" overlaps one-line exception; "same marker" wording for non-type suppressions ambiguous; roll-forward rule stated twice
Task 17: complete (commits ea9e906..3b14d14, review clean after 1 fix round)
- R18 Ruling: AGENTS.md block budget raised 12,000 → 16,000 bytes and, when codex is selected, each rule contributes only its FIRST 5 Essentials bullets ("top essentials") under `### <title> — essentials`; full essentials + detail stay in the Codex rules skill. — Measured: always-on + full backend core essentials ≈ 10.4 KB before any stack/addon, so 12 KB cannot hold a Spring Boot + addons render; spec §9.2's 12 KB was a [Claude] call; 16 KB still leaves ~8 KB under Antigravity's 24 KB single-file truncation for user/SDLC content. — If wrong: Codex sees fewer inline bullets (full rules still one skill away).
Engine change "Task 8b" dispatched before Task 18 (BASE 3b14d14).
- R19 Ruling: the skill `stackcrew-spring-kafka-consumer` (requiresAddons: [kafka]) and its test "kafka skill only rendered with kafka addon" move from Task 18 to Task 19 — validateCatalog rejects requiresAddons naming an addon that doesn't exist yet, and the camel addon in Task 19 needs language java from Task 18 (circular otherwise). — If wrong: none; same content, one task later.
Task 8b: review 1 → Needs fixes (Important: env restore deletes in both branches). Fix round 1 dispatched (FIX_BASE e847990).
Task 8b: minor (deferred): topEssentials not fence-aware; only -/* bullets (numbered essentials silently dropped from codex block); lazy continuation keeps `## x`; test silently falls back to mini stack; spec §9.2 mixes English into Vietnamese sentence; plan task sections still mention 12000 (historical)
Task 8b: Ruling: review finding 'env restore deletes in both branches' is INVALID — controller verified e847990:test/render-cursor.test.js:98-99 already restores the saved value; no change made for it. — If wrong: n/a (verified against source).
Task 8b: fix round 1/5 (2 cheap fixes addressed; 1 finding ruled invalid; commits e847990..682f5a4). topEssentials defined in same module (controller verified).
Task 8b: complete (commits 3b14d14..682f5a4, review clean after 1 fix round)
Task 18: review 1 (opus) → Needs fixes (9 Important: provider template error paths + NPEs; mislabeled/non-compiling Template Method; Resilience4j retries/trips on 4xx; waiver honored only by guard; SC-CONST regex FPs (plan-mandated); javax ban too broad; self-invocation-prone tx/async guidance; testing example NPE; spec gaps FreezingArchRule + domain→infra rule). Fix round 1 dispatched (FIX_BASE 83fc8d1) with findings file task-18-fix1-findings.md.
- R20 Ruling: SC-CONST guard regex replaced: `^(?!\s*(\*|//|/\*))(?!.*\bstatic\s+final\b)(?!\s*"[^"]*"\s*[;,)]*\s*$).*"https?://` (skip comments/Javadoc, static final, lone string-literal continuation lines) — plan's verbatim regex blocked the prescribed fix (wrapped constants). SC-TYPE regexes also skip import/comment lines. — If wrong: some literal URLs on comment-like lines slip to check/CI ArchUnit.
- R21 Ruling: provider playbook applies Resilience4j programmatically (registries keyed by provider code) inside a real Template Method base — avoids proxy/final pitfalls and makes retry unit-testable. — If wrong: teams preferring annotations can still use them in services.
- R22 Ruling: ArchUnit template adds domain↛infrastructure/adapter rule and freezes all rules via FreezingArchRule with programmatic allowStoreCreation (spec §6.3, §8.2). — If wrong: committed archunit_store baseline file appears in projects (intended).
Task 18: folded minors (R17 principle): Spring map-injection keying fact, Boot 3.2 RestClient note, layering contradiction, core contradictions (test literals, ignoreNumbers, idempotency scope), own-rule violations in examples, per-provider config copy-paste, bulkhead/jitter, PII in record toString, first-provider consistency, Essentials order, guard edge-case tests.
Task 18: minor (deferred): ArchUnit ..api..|..web.. selectors match module-root packages; allowEmptyShould(true) can silently check nothing; no_field_injection misses @Inject/@Value/@Resource; raw Map not flagged; port omissions (profiles per env, tx propagation/flush lifecycle, bind-param PII note); Camel API not verified via Context7 (to verify in fix)
Task 18: fix round 1/5 (16 addressed, open: F7 AFTER_COMMIT listener never fires (Important), F3 default resilience config + test-kit construction, F1 audit residual, F4 "only exception" wording, Minor9 first-provider contradiction; new breakage a–f; commits 83fc8d1..e74116d)
Task 18: fix round 2 dispatched (FIX_BASE e74116d) with task-18-fix2-findings.md
Task 18: fix round 2/5 (all open items + a–f addressed, 0 open; commits e74116d..a5c5286)
Task 18: complete (commits 682f5a4..a5c5286, review clean after 2 fix rounds)
- R23 Ruling: carry two small Task-18-area edits into Task 19's dispatch (reviewed there): (1) core always-on SC-TYPE lists BOTH exceptions (dynamic-payload boundary, framework-required signature) to match java rule/guard (R17); (2) MySQL `ON DUPLICATE KEY UPDATE id = id` guidance notes Connector/J `useAffectedRows=true` (else duplicates count as new). — Avoids a third Task 18 loop for one-line edits. — If wrong: trivial.
Task 18: minor (deferred): CallbackProcessor.on package-private (prefer public); test kit uses CircuitBreakerRegistry.ofDefaults(); snippet imports omitted; ArchUnit selectors/allowEmptyShould/no_field_injection gaps (from review 1)
- R24 Ruling (pending dispatch after Task 19 closes, as "Task 19b"): AGENTS.md block degrades gracefully — with codex, try top-5 essentials per rule; if over 16,000 bytes retry with top-3, then top-1; emit a render warning `agents-md-essentials-reduced: N bullets per rule to fit 16000 bytes`; throw BUDGET only if top-1 still exceeds. — Measured 15,777/16,000 with spring-boot + 4 addons leaves 223 bytes; custom rules or Plan 2 addons would otherwise hard-fail render. — If wrong: Codex sees fewer inline bullets in big profiles (full rules remain in the rules skill).
Task 19: review 1 (opus) → Needs fixes (Critical: Kafka DLT suffix version-dependent; Important: Alloy default instance/job labels, Rabbit TTL loop, Rabbit retry classification, Kafka idempotency IT can't fail, Camel useOriginalMessage/JSON redelivery, Camel direct: contract vs provider skill, Camel idempotent key lifecycle). Fix round 1 dispatched (FIX_BASE 3446685) with task-19-fix1-findings.md; folded minors: throttle 4.4+, unverified camel MDC property, validate.js missing languages key, QueueBuilder.quorum(), confirms, structured logging fields, Kafka nits, budget trim, console.log.
Task 19: note: BullMQ/Watermill (spec §5.4) are covered by Task 20 messaging-choice skill + Plan 2 stacks.
Task 19: fix round 1/5 (Critical 1 + Important 2–7 + most minors addressed; open: new Important Rabbit parking-lot publish without confirms, Finding 8 text (controller's own findings premise was wrong — key removed on handled failure per bytecode), Rabbit confirms naming/snippet; commits 3446685..e803a30)
Task 19: Ruling: controller's round-1 finding 8 premise ("key stays after DLC/handled") was false per Camel 4.4–4.14 bytecode; corrected in round-2 findings. — If wrong: n/a (bytecode-verified by reviewer).
Task 19: fix round 2 dispatched (FIX_BASE e803a30) with task-19-fix2-findings.md (folds: spring-amqp 3.1 getRetryCount gap + retry-count name, isFatal isInstance + FQN MessageConversionException, quorum at-least-once dead-lettering, stale DLQ wording, Camel 4.15+ MDC, languages:null)
Task 19: fix round 2/5 (9 addressed, 0 open; commits e803a30..4f55da9)
Task 19: minor (deferred): RabbitNames constants referenced but not declared in doc (consistent with style); attempts() reads only deaths[0]; Camel port route keeps default error handler (noErrorHandler() would avoid duplicate exhausted logs)
Task 19: complete (commits a5c5286..4f55da9, review clean after 2 fix rounds)
Task 19b (R24 adaptive AGENTS block) dispatched next (BASE 4f55da9).
Task 19b: complete (commits 4f55da9..64523d7, review clean)
Task 19b: minor (deferred): non-codex BUDGET message lists "0 bytes" largest rules; BUDGET ranking-at-last-n not pinned by test
Task 20: review 1 (opus) → Needs fixes (Critical: final template method vs playbook; Important: base/registry timing, resilience order, ACL types/NPE, NestJS HttpService Observable, Redis Pub/Sub guarantees (also kafka/rabbitmq addon rules — R17 correctness), Java 21 sealed switch, NestJS multi-provider, Bridge threshold, Next 16 proxy, outbox CDC). Fix round 1 dispatched (FIX_BASE e7a6361) with task-20-fix1-findings.md (minors M1–M14 folded: copied-example correctness/consistency).
Task 20: fix round 1/5 (C1, I1–I10, most minors addressed; open: new Important singleton Go example doesn't compile, M6 Watermill forwarder decorator missing; minors 3–9; commits e7a6361..7c8cc4b)
Task 20: fix round 2 dispatched (FIX_BASE 7c8cc4b)
Task 20: fix round 2/5 (10 addressed, 0 open; commits 7c8cc4b..a14029f)
Task 20: minor (deferred): OnceValues caches transient failure permanently (could note); Angular 17/18 cutoff sentence awkward; per-line firstValueFrom test can false-positive on multi-line await
Task 20: complete (commits 64523d7..a14029f, review clean after 2 fix rounds)
Task 21: review 1 → Needs fixes (Important: greenfield --wire path unhandled (basePackage/no build file); "omit --addons" means use-detected; "proceed without stack rules" impossible). Fix round 1 dispatched (FIX_BASE f6c4d00), minors 4–10 folded.
Task 21: fix round 1/5 (10 addressed, 0 open; commits f6c4d00..74202a6)
Task 21: minor (deferred): sync.md "stop" on --wire exit 1 slightly pessimistic; non-UTF-8 build file MARKER not listed; redundant sync after add in re-profile
Task 21: complete (commits a14029f..74202a6, review clean after 1 fix round)
Task 22: implementer DONE_WITH_CONCERNS (commit 2be42bd). Real Maven run: freeze run 1 PASS (store created), run 2 FAIL naming BadService2 (SC-TYPE). Concern: surefire 3.5.3 (managed by Boot 3.4.0–3.5.4) runs 0 tests → wired ArchUnit gate silently no-op; fixture moved to Boot 3.5.11.
- R25 Ruling (pending, "Task 22b" after Task 22 review): investigate root cause (surefire 3.5.3 vs JUnit Platform version from archunit-junit5 1.5.1 vs Boot-managed junit-bom) with real Maven, then fix in `--wire` so the gate cannot silently no-op on Boot 3.2–3.5 (e.g. align junit-platform / pin surefire ≥3.5.4 via marked block, or choose compatible archunit version), plus an e2e/Maven verification across Boot 3.2.x, 3.4.x, 3.5.x. — G5 (build fails on violation) is a core promise; user's projects are Boot 3.x. — If wrong: one more engine task.
Task 22: review 1 → Needs fixes (Important, plan-mandated: e2e lacks Review Focus 1,2,3,5 and part of 4). Ruling: add them (cheap, defense-in-depth; unit-level coverage already exists in Tasks 6/13/14). Fix round 1 dispatched (FIX_BASE 2be42bd), docs minors folded.
Task 22: fix round 1/5 (most addressed; open: manifest tests lack positive control; X4/A4 probe used `metadata` (controller's own suggestion — wrong, it's a spec key); commits 2be42bd..d8825d1)
Task 22: fix round 2 dispatched (FIX_BASE d8825d1)
Task 22: minor (deferred): t.after requires Node 18.13+ while engines says >=18.3 (tests only); Cursor/Antigravity UI paths unverified (Plan 3 checklist)
Task 22: fix round 2/5 (all addressed, 0 open; commits d8825d1..d99d880)
Task 22: minor (deferred): missing/corrupt manifest e2e don't assert other managed files untouched / skip report names
Task 22: complete (commits 74202a6..d99d880, review clean after 2 fix rounds)
Task 22b (R25 surefire/ArchUnit no-op) dispatched (BASE d99d880).
Task 22b: complete (commits d99d880..1b57e41, review clean). Root cause: surefire 3.5.3 SUREFIRE-1643 drops FieldSource results; fix = @ArchTest methods + base_package_contains_classes guard; verified Boot 3.2.12/3.3.13/3.4.9/3.5.4/3.5.11 + Gradle 8.14.4.
Task 22b: minor (deferred): narrow basePackage passes vacuously; "Tests run: 5" wording should say StackcrewArchitectureTest line / at least 5; template unit test brittle to indentation; testing.md could mention surefire>=3.5.4 escape hatch; Gradle Kotlin DSL unverified
ALL TASKS COMPLETE. Next: final whole-branch review.
FINAL REVIEW (opus, c1cfc93..1b57e41): With fixes. No Critical. Important I1 (sync --wire writes before render can fail; breaks RF4), I2 (multi-module Maven wire no-op), I3 (Cursor duplicate agents w/ cursor+codex), I4 (CLAUDE.md shadows AGENTS.md on Claude Code ≥2.1.277), I5 (no-plugin hint wrong/undocumented), I6 (hook CRLF fallback = ledger L114). Deferred-minor triage: only L114 must-fix (=I6); 33 can wait.
- Ruling: final fix wave = I1–I6 + cheap user-facing minors M1, M2, M3, M5, M9, M10, M11 (LICENSE MIT "stackcrew contributors"; plugin.json license; author left to user), M12, M13. Deferred to Plan 2/3: M4, M6 (CI store creation), M7 (commas in globs, Plan 2), M8 (developer preload size), anchoring ArchUnit selectors, check git stderr, --dry-run label, owned-prefix stale deletion check. — Keeps the wave small and localized; publish-blockers listed for Plan 3. — If wrong: items resurface in Plan 3 checklist.
Final fix wave dispatched (FIX_BASE 1b57e41) with final-fix-findings.md
Final fix wave: re-review (opus) → all findings addressed, no new Critical/Important (commits 1b57e41..85f122f; 298 pass).
Final: parked — Ruling: residual Minors parked for Plan 3 / backlog, not a second fix wave (skill: one final fix wave): (1) `/<modules\b/` matches `<modules.version>` property → single-module pom refused (loud, nothing written); (2) aggregator check sits after the marker early-return in planPom (pre-wired root pom later gaining <modules> gets re-wired); (3) multi-module exit-1 header says "re-run sync --wire" and later syncs keep printing the --wire hint; (4) checklist C3/C3d wording vs cursor-duplicate-agents; (5) EPERM etc. surface as raw Node stack; (6) I1 partial state possible on IO error after pre-check (self-heals on re-run). — All rare/loud/self-healing; none can silently pass a violation. — If wrong: a multi-module or exotic-pom user hits a confusing message.
