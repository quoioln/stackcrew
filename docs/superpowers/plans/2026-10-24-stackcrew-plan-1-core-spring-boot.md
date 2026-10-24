# stackcrew — Plan 1: Core engine + Spring Boot vertical slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working `stackcrew` CLI and Claude Code plugin. It renders always-on rules, glob-scoped rules, per-stack skills and role agents for **one stack (Spring Boot 3)** into a project, for Claude Code, Cursor, Codex and Antigravity. It also ships a write-time guard hook and a diff-based `check` for Jenkins.

**Architecture:**
- All content is markdown/JSON in `catalog/`.
- A pure renderer turns `(catalog, profile)` into a list of file operations, one set per tool.
- An applier writes those operations. It keeps a hash manifest and uses marked blocks for shared files (`CLAUDE.md`, `AGENTS.md`).
- The guard hook (L2) and `stackcrew check` (L3) share one set of forbidden patterns, rendered to `.stackcrew/guard.json`.

**Tech Stack:** Node.js ≥ 18.3 (ESM), zero dependencies, `node:test`, `node:util.parseArgs`, git CLI.

**Spec:** `docs/superpowers/specs/2026-10-24-stackcrew-design.md`. Read it first. Section numbers (§) below refer to it.

**Series:**
- Plan 1 (this one): engine, Claude plugin, guard/check, Java wiring, and content for core + Java + Spring Boot + add-ons + shared skills + roles + init.
- Plan 2: Quarkus, NestJS, Next.js, React, Angular, Go; TypeScript/Go language rules; ESLint (flat + legacy by detected major) and golangci-lint configs.
- Plan 3: golden tasks on 4 tools (§13), superpowers interplay check, user checklist, npm publish.

**Tóm tắt (VI):** Plan này dựng toàn bộ "động cơ" của stackcrew và làm trọn một lát cắt cho Spring Boot:
- render rule, skill và vai ra 4 tool;
- guard hook chặn lúc ghi file;
- `check` chạy trong Jenkins;
- wire ArchUnit;
- build plugin.

Các stack còn lại thêm ở Plan 2 bằng cách thêm thư mục vào `catalog/`.

---

## Global Constraints

- **Runtime:** Node.js `>=18.3`, ESM (`"type": "module"`), **zero runtime and zero dev dependencies**. Tests use `node:test` + `node:assert/strict`, run by `npm test` (= `node --test`).
- **Test file layout:** test files are named `test/*.test.js`. Fixture data under `test/fixtures/` contains **no `.js` files**, because the default `node --test` glob would otherwise pick them up.
- **What gets published:** `package.json` `files` is exactly `["bin", "src", "catalog", "README.md"]`. Code finds the catalog via `import.meta.url`, never `process.cwd()`. The env var `STACKCREW_CATALOG_DIR` overrides it (tests only).
- **Line endings:**
  - Every file stackcrew writes uses LF.
  - Marked-block edits keep the host file's existing EOL.
  - Hashes are computed on LF-normalized text.
  - The repo has `.gitattributes` = `* text=auto eol=lf`.
- **Path matching:** paths are POSIX and project-relative inside the engine. Backslashes are normalized to `/` before any glob match (hook, check, renderer).
- **Content language:** rule and skill content in **English**. `README.md` and user guides in **Vietnamese**. CLI messages in English.
- **SDLC isolation:** never write under `docs/sdlc/`. Never touch text outside `<!-- stackcrew:begin -->`/`<!-- stackcrew:end -->` in `CLAUDE.md`/`AGENTS.md`.
- **Owned output paths** (the only files `sync` creates, overwrites or deletes):
  - `.claude/rules/stackcrew/**`, `.claude/skills/stackcrew-*/**`, `.claude/agents/stackcrew-*.md`
  - `.cursor/rules/stackcrew/**`, `.cursor/skills/stackcrew-*/**`, `.cursor/agents/stackcrew-*.md`
  - `.agents/rules/stackcrew-*.md`, `.agents/skills/stackcrew-*/**`, `.agent/skills/stackcrew-*/**`, `.agents/agents/stackcrew-*.md`
  - `.codex/agents/stackcrew-*.toml`
  - `.stackcrew/guard.json`, `.stackcrew/lint/**`, `.stackcrew/ci/**`
  - `docs/stackcrew/**`
  - `src/test/java/**/stackcrew/StackcrewArchitectureTest.java` (only when wired)
- **Budgets:**
  - The rendered always-on core is ≤ 6,000 bytes.
  - The stackcrew block in `AGENTS.md` is ≤ 16,000 bytes.
  - Each Antigravity rule file is ≤ 24,000 bytes.
  - Each Cursor `.mdc` is ≤ 500 lines.
  - Each rule's `## Essentials` has ≤ 15 bullets.
  - Each skill description is ≤ 500 chars.
  - Exceeding a budget throws `StackcrewError` code `BUDGET` and never silently truncates.
- **Skill descriptions:**
  - They start with `Use when` (task/testing/advisor) or `Use only when` (command).
  - Task/testing skills must contain the stack's `name`.
  - These words are banned (case-insensitive): `always`, `any code`, `all code`, `every task`, `whenever the user`, `proactively`.
- **No orchestration:** no catalog markdown may contain these phrases (case-insensitive): `auto-advance`, `next phase`, `when the user sends an idea`, `run the pipeline`, `proceed to the next phase`, `invoke the next skill`.
- **Template placeholders:** placeholders in catalog content are `{{sc:<name>}}` only. Angular's `{{ x }}` must survive untouched. An unknown `{{sc:x}}` throws `TEMPLATE`.
- **Versions targeted by Plan 1 content:** Spring Boot **3.x** (`jakarta.*`), **Java 17+**. DTOs default to `record`; Lombok `@Builder` only for classes with many optional fields; no Lombok/`@Data` on JPA entities.
- **CI:** Jenkins only. Generate a snippet; never edit an existing `Jenkinsfile`.
- **Build files:** never edit `pom.xml`/`build.gradle(.kts)` unless `--wire` is passed.
- **Library APIs:** ArchUnit, Checkstyle, Jenkins env vars, Resilience4j, Spring Kafka, Apache Camel, and the Claude Code hooks schema must be verified via **Context7** (or the official doc URL) when writing content or config. Do not write them from memory.
- **Plugin drift:** any change under `catalog/`, `src/` or `bin/` from Task 16 onward must be followed by `node bin/stackcrew.js plugin` before committing. `test/plugin-drift.test.js` enforces this.
- **Commits:** one per task, Conventional Commits, made inside `C:\Working\Projects\SDLC\SourceCode\stackcrew`. Every message ends with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Verification commands:** use only `node`, `npm`, `git`, so they work in PowerShell and Git Bash alike.

## Review Focus

1. **`check` without a usable base ref** (shallow or narrow Jenkins clone), **or outside a git repo**: it must exit 2 with a clear message and never print "0 violations". Owned by Task 14, test `check fails loudly when base ref is missing`.
2. **`sync` over a generated file the user edited by hand**: the file is left intact, reported, and the run exits 1. `--force` overwrites it. Owned by Task 6, test `refuses to overwrite hand-edited owned file`. Task 12 has the CLI-level test.
3. **Manifest missing or corrupt**: delete nothing. Only paths recorded in a valid manifest may be deleted. Owned by Task 6, tests `missing manifest deletes nothing` and `corrupt manifest deletes nothing`.
4. **Existing `CLAUDE.md`/`AGENTS.md`** in three cases. Owned by Task 6, tests `preserves SDLC section bytes`, `keeps CRLF`, `half marker aborts all writes`.
   - **SDLC content:** the `## SDLC Workflow` text stays byte-identical.
   - **CRLF file:** CRLF is kept.
   - **Only one marker present:** error, and nothing at all is written.
5. **Hook input it can't handle**: malformed stdin, a file outside the project, no `.stackcrew/guard.json`, or `enabled: false`. Each must exit 0 immediately. Owned by Task 13, test group `hook fails open`.

---

## Shared types (defined once in Task 2, `src/types.js` as JSDoc; referenced by name everywhere)

```js
/** Errors: class StackcrewError extends Error { constructor(code, message) } — src/errors.js
 *  codes: 'FRONTMATTER' | 'TEMPLATE' | 'CATALOG' | 'PROFILE' | 'MARKER' | 'BUDGET' | 'RENDER' | 'GIT' */

/** @typedef {{ files: string[], contains: string[], excludeContains: string[], packageDeps: string[] }} DetectSpec */
/** @typedef {{ id: string, title: string, categories: string[], languages: string[],
 *   essentials: string, body: string, source: string, globs?: string[], alwaysOn?: boolean }} RuleDoc
 *   // categories/languages empty = applies to all; globs/alwaysOn only on custom rules */
/** @typedef {{ relPath: string, content: string }} SkillFile */
/** @typedef {{ name: string, description: string, kind: 'task'|'testing'|'advisor'|'command'|'rules',
 *   paths: string[], requiresAddons: string[], body: string, files: SkillFile[], source: string }} SkillDoc */
/** @typedef {{ id: string, globs: string[], excludeGlobs: string[], regex: string, flags: string, message: string }} GuardRule */
/** @typedef {{ id: string, name: string, category: 'backend'|'frontend'|'fullstack', language: string,
 *   minVersion: string, globs: string[], aliases: string[], priority: number, detect: DetectSpec,
 *   rules: RuleDoc, testing: RuleDoc, skills: SkillDoc[], guard: GuardRule[],
 *   lintFiles: SkillFile[], wireFiles: SkillFile[] }} Stack */
/** @typedef {{ id: string, name: string, languages: string[], detect: DetectSpec, rules: RuleDoc }} Addon */
/** @typedef {{ id: string, rule: RuleDoc, guard: GuardRule[] }} Language */
/** @typedef {{ id: 'tech-lead'|'developer'|'tester', model: 'opus'|'sonnet'|'haiku',
 *   skillKinds: ('task'|'testing'|'advisor')[], description: string, body: string }} RoleDoc */
/** @typedef {{ name: string, description: string, body: string }} PluginCommandDoc */
/** @typedef {{ dir: string, alwaysOn: string, coreRules: RuleDoc[], languages: Map<string, Language>,
 *   stacks: Map<string, Stack>, addons: Map<string, Addon>, sharedSkills: SkillDoc[],
 *   roles: RoleDoc[], pluginCommands: PluginCommandDoc[] }} Catalog */
/** @typedef {{ id: string, area: string, decision: string, rationale: string, rejected: string[] }} Decision */
/** @typedef {{ version: 1, stack: string, addons: string[], tools: ('claude'|'cursor'|'codex'|'antigravity')[],
 *   mode: 'greenfield'|'brownfield', guard: boolean, context: Record<string,string>,
 *   decisions: Decision[], java?: { basePackage: string, wired: boolean } }} Profile */
/** @typedef {{ dir: string, format: 'claude'|'generic' }} SkillDir */
/** @typedef {{ taskDirs: SkillDir[], commandDirs: SkillDir[], warnings: string[] }} SkillDirPlan */
/** @typedef {{ name: string, description: string, model: string, body: string, skills: string[] }} RenderedRole */
/** @typedef {{ catalog: Catalog, profile: Profile, stack: Stack, language: Language, addons: Addon[],
 *   rules: RuleDoc[], alwaysOn: string, skills: SkillDoc[], commandSkills: SkillDoc[], roles: RenderedRole[],
 *   skillDirs: SkillDirPlan, vars: { stackId: string, stackName: string, cli: string, version: string, basePackage: string } }} RenderContext */
/** @typedef {{ path: string, kind: 'owned'|'block', content: string }} FileOp   // path: POSIX, project-relative */
/** @typedef {{ ops: FileOp[], warnings: string[] }} RenderResult */
/** @typedef {{ written: string[], unchanged: string[], deleted: string[], skippedModified: string[],
 *   blocks: string[], manifestStatus: 'ok'|'missing'|'corrupt' }} ApplyReport */
/** @typedef {{ version: 1, files: Record<string, string> }} Manifest   // path → sha256 of LF content */
/** @typedef {{ file: string, line: number, ruleId: string, message: string, text: string }} Violation */
/** @typedef {{ file: string, lines: { line: number, text: string }[] }} DiffFile */
```

## File map

```
stackcrew/
├── package.json  .gitignore  .gitattributes  README.md
├── bin/stackcrew.js                     # shebang → src/cli.js main()
├── src/
│   ├── cli.js  paths.js  errors.js  types.js  profile.js  detect.js
│   ├── util/{frontmatter,template,glob,hash}.js
│   ├── catalog/{load,validate}.js
│   ├── render/{writeset,context,notice,skills,claude,agents-md,cursor,codex,antigravity,shared,index}.js
│   ├── fs/{marked-block,apply}.js
│   ├── guard/{scan,hook,diff}.js
│   ├── wire/java.js
│   ├── plugin/build.js
│   └── commands/{init,sync,run-sync,add,list,detect,check,plugin}.js
├── catalog/   (content — Tasks 17–21; layout defined in Task 3)
├── plugin/  .claude-plugin/   (GENERATED by `stackcrew plugin`, committed)
├── fixtures/spring-boot-minimal/        # Task 22
├── test/*.test.js  test/fixtures/catalog-mini/**
└── docs/superpowers/{specs,plans}/  docs/manual-checklist.md
```

---

### Task 1: Bootstrap the repo and CLI skeleton

**Files:**
- Create: `package.json`, `bin/stackcrew.js`, `src/cli.js`, `src/paths.js`, `.gitignore`, `.gitattributes`, `README.md`
- Test: `test/cli.test.js`, `test/package.test.js`

**Interfaces:**
- Produces:
  - `main(argv: string[], io?: { cwd: string, stdout: Writable, stderr: Writable, isTTY: boolean }) → Promise<number>`, the exit code. It dispatches `help|version|init|sync|add|list|detect|check|plugin`. Commands not built yet print `not implemented` and return 1.
  - `PKG_ROOT: string`, `getCatalogDir(): string` (honors `STACKCREW_CATALOG_DIR`), `readPackageVersion(): Promise<string>`.

- [ ] **Step 1: Write failing tests** (spawn `process.execPath bin/stackcrew.js …`):

```js
test('version prints package.json version', ...)      // stdout.trim() === pkg.version, exit 0
test('help lists every command', ...)                  // for c of ['init','sync','add','list','detect','check','plugin','version'] assert stdout includes c
test('unknown command exits 1 with usage', ...)        // exit 1, stderr includes 'Usage: stackcrew'
test('npm pack ships bin/src only, no tests', ...)     // `npm pack --dry-run --json` (shell:true on win32): paths include 'bin/stackcrew.js','src/cli.js'; none startsWith 'test/','fixtures/','plugin/','docs/'
```

- [ ] **Step 2:** `npm test` → FAIL (files missing).
- [ ] **Step 3: Implement.**
  - **`package.json`:** `name: "stackcrew"`, `version: "0.1.0"`, `type: "module"`, `bin: {"stackcrew": "bin/stackcrew.js"}`, `files` as in Global Constraints, `engines.node: ">=18.3"`, `scripts.test: "node --test"`, `license: "MIT"`, and description `"Coding rules, per-stack skills and dev/test roles for AI agents (Claude Code, Cursor, Codex, Antigravity)"`.
  - **`.gitattributes`:** `* text=auto eol=lf`.
  - **`.gitignore`:** `node_modules/`, `*.tgz`, `.tmp/`.
  - **`README.md`:** a Vietnamese stub with title, one-paragraph purpose and "đang phát triển".
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit.** This first commit includes the spec and this plan:

```bash
git add -A
git commit -m "chore: bootstrap stackcrew CLI skeleton"
```

---

### Task 2: Utilities: errors, types, frontmatter, template, glob, hash

**Files:**
- Create: `src/errors.js`, `src/types.js`, `src/util/frontmatter.js`, `src/util/template.js`, `src/util/glob.js`, `src/util/hash.js`
- Test: `test/util.test.js`

**Interfaces:**
- Produces:
  - `StackcrewError(code, message)` and all typedefs in "Shared types".
  - `parseFrontmatter(text: string) → { data: Record<string, string|boolean|string[]>, body: string }`. It supports `k: v`, single/double quoted strings, `true/false`, flow lists `[a, b]` and block lists (`k:` then `  - item`). No leading `---` returns `{ data: {}, body: text }`. An unterminated block throws `FRONTMATTER`.
  - `stringifyFrontmatter(entries: [string, string|boolean|string[]][]) → string`. It returns `---\n…\n---\n`, keeps the given key order, and writes arrays as block lists with double-quoted items. A string is double-quoted if it contains any of `:#*{}[],&!|>'"%@`, a leading/trailing space, or is empty. Booleans are written bare.
  - `fillTemplate(text: string, vars: Record<string,string>) → string`. It replaces `{{sc:name}}` only; an unknown name throws `TEMPLATE` naming it.
  - `toPosix(p: string) → string`, `globToRegExp(glob: string) → RegExp` (supports `**/`, `/**`, `*`, `?`, `{a,b}`; anchored), `matchesAny(relPath: string, globs: string[]) → boolean`.
  - `toLf(text) → string`, `sha256(text) → string` (hex of `toLf(text)`).

- [ ] **Step 1: Write failing tests** (exact cases):

```js
parseFrontmatter('---\nname: a\npaths:\n  - "**/*.java"\nflag: true\nlist: [x, y]\n---\nBody') // data {name:'a',paths:['**/*.java'],flag:true,list:['x','y']}, body 'Body'
assert.throws(() => parseFrontmatter('---\nname: a\n'), e => e.code === 'FRONTMATTER')
parseFrontmatter(stringifyFrontmatter([['globs','**/*.java,**/*.kt'],['alwaysApply',false]]) + 'B').data // round-trips exactly
stringifyFrontmatter([['globs','**/*.java']])   // === '---\nglobs: "**/*.java"\n---\n'
fillTemplate('Hi {{sc:stackName}} {{ title }}', {stackName:'Spring Boot'}) // 'Hi Spring Boot {{ title }}'
assert.throws(() => fillTemplate('{{sc:nope}}', {}), e => e.code === 'TEMPLATE' && /nope/.test(e.message))
matchesAny('src/main/java/a/B.java', ['**/*.java'])           // true
matchesAny('B.java', ['**/*.java'])                            // true (root-level)
matchesAny('src\\main\\java\\B.java', ['src/main/**'])         // true (backslashes)
matchesAny('web/a.tsx', ['**/*.{ts,tsx}'])                     // true
matchesAny('src/test/java/X.java', ['**/src/test/**'])         // true
matchesAny('a.javax', ['**/*.java'])                           // false
sha256('a\r\nb') === sha256('a\nb')                            // true
```

- [ ] **Step 2:** `node --test test/util.test.js` → FAIL.
- [ ] **Step 3: Implement** the functions above, each in its listed file.
- [ ] **Step 4:** `node --test test/util.test.js` → PASS.
- [ ] **Step 5: Commit** `feat: add frontmatter, template, glob and hash utilities`.

---

### Task 3: Catalog loader and validator (with the mini test catalog)

**Files:**
- Create: `src/catalog/load.js`, `src/catalog/validate.js`, and `test/fixtures/catalog-mini/**` (listed below)
- Test: `test/catalog.test.js`

**Catalog layout (authoritative, used by Tasks 17–21):**
| Path | Format → type |
|---|---|
| `core/always-on.md` | Plain markdown, no frontmatter → `Catalog.alwaysOn` |
| `core/rules/<n>.md` | Frontmatter `id` (= `core-<n>`), `title`, optional `categories`, `languages` → `RuleDoc` |
| `languages/<lang>/rule.md` + `guard.json` | Frontmatter `id` (= `lang-<lang>`), `title`. `guard.json` = `{ "rules": GuardRule[] }` |
| `stacks/<id>/stack.json` | `id, name, category, language, minVersion, globs, aliases, priority, detect` |
| `stacks/<id>/rules.md` | Frontmatter `id` (= `stack-<id>`) |
| `stacks/<id>/testing.md` | Frontmatter `id` (= `stack-<id>-testing`) |
| `stacks/<id>/guard.json` | Optional |
| `stacks/<id>/skills/<name>/SKILL.md` (+ any other files) | Frontmatter `name` (= folder), `description`, `kind` (`task`\|`testing`), optional `paths`, `requiresAddons`. The other files go to `SkillDoc.files` |
| `stacks/<id>/lint/**` | → `Stack.lintFiles` |
| `stacks/<id>/wire/**` | → `Stack.wireFiles` |
| `addons/<id>/addon.json` + `rules.md` | `id, name, languages, detect`. `rules.md` frontmatter `id` (= `addon-<id>`) |
| `skills/<name>/SKILL.md` (+ files) | Frontmatter `name`, `description`, `kind` (`advisor`\|`command`), optional `paths` |
| `roles/<id>.md` | Frontmatter `id`, `model`, `skillKinds`, `description`; the body is a template |
| `plugin-commands/<name>.md` | Frontmatter `name`, `description`; the body is a template using `{{sc:cli}}` |

Every `RuleDoc` body must contain a `## Essentials` heading. `essentials` is the text between that heading and the next `## ` heading.

**Ordering and leniency:**
- Core rules, stacks, add-ons, skills and roles are ordered by **file/folder name, ascending**.
- `loadCatalog` tolerates missing dirs (empty collections) and a missing `core/always-on.md` (`alwaysOn: ''`).
- `validateCatalog` reports a missing `core/always-on.md`. Everything else is validated only if present, because the real catalog grows over Tasks 17–21.

**Mini catalog** (`test/fixtures/catalog-mini/`):
- **Core:** `core/always-on.md` ("# Always\nSC-TYPE"), `core/rules/testing.md` (no categories) and `core/rules/backend-api.md` (`categories: [backend]`).
- **Language:** `languages/java/{rule.md,guard.json}`. Its guard has one rule: SC-TYPE, regex `\bJsonNode\b`, globs `["**/*.java"]`, excludeGlobs `["**/src/test/**"]`.
- **Stack `stacks/demo-java/`:**
  - `stack.json`: name "Demo Java", category backend, language java, globs `["**/*.java"]`, priority 10.
  - `detect`: files `["pom.xml"]`, contains `["org.springframework.boot"]`, excludeContains `["io.quarkus"]`.
  - Files: `rules.md`, `testing.md`, `lint/demo.xml`, `wire/StackcrewArchitectureTest.java` (contains `package {{sc:basePackage}}.stackcrew;`).
  - Skills: `skills/stackcrew-demo-task/SKILL.md` (kind task, `paths: ["**/*.java"]`, description "Use when adding a demo endpoint in this Demo Java service."), `skills/stackcrew-demo-kafka/SKILL.md` (kind task, `requiresAddons: [demo-addon]`), `skills/stackcrew-demo-testing/SKILL.md` (kind testing).
- **Add-on:** `addons/demo-addon/{addon.json,rules.md}`, with languages `["java"]` and detect contains `["kafka"]`.
- **Shared skills:** `skills/stackcrew-demo-advisor/{SKILL.md,patterns/x.md}` (kind advisor) and `skills/stackcrew-init/SKILL.md` (kind command, description "Use only when the user explicitly asks to run the stackcrew setup interview.", body contains `{{sc:cli}} sync`).
- **Roles:** `roles/{tech-lead,developer,tester}.md`, with descriptions containing `{{sc:stackName}}`.
- **Plugin command:** `plugin-commands/sync.md`.

**Interfaces:**
- Produces:
  - `loadCatalog(dir: string = getCatalogDir()) → Promise<Catalog>`. A missing optional dir means empty; a malformed file throws `CATALOG` naming the file.
  - `validateCatalog(catalog: Catalog) → string[]`, each error prefixed by the source path.
  - `lintSkillDescription(skill: SkillDoc, stackName?: string) → string[]`.
  - `BANNED_ORCHESTRATION: string[]`, `BANNED_DESCRIPTION_WORDS: string[]`.
- **`validateCatalog` checks:**
  - ids unique and matching the conventions above;
  - `name` === folder;
  - every skill name starts with `stackcrew-`;
  - skill kinds valid for their location;
  - description rules (Global Constraints);
  - `## Essentials` present with ≤ 15 bullets;
  - every guard regex compiles;
  - `stack.json`/`addon.json` required fields and enum values;
  - addon `languages` ⊆ known languages;
  - role `skillKinds` valid;
  - no banned orchestration phrase in any `.md`.

- [ ] **Step 1: Write failing tests:**

```js
test('loads mini catalog', async () => { const c = await loadCatalog(MINI);
  assert.equal(c.stacks.get('demo-java').skills.length, 3); assert.equal(c.coreRules.length, 2);
  assert.match(c.stacks.get('demo-java').rules.essentials, /\S/); assert.equal(c.roles.length, 3);
  assert.deepEqual(c.stacks.get('demo-java').wireFiles.map(f => f.relPath), ['StackcrewArchitectureTest.java']) })
test('mini catalog validates clean', ...)                         // deepEqual(validateCatalog(c), [])
test('rejects description not starting with Use when', ...)       // mutate a skill → error includes 'stackcrew-demo-task'
test('rejects banned description word', ...)                      // 'Use when writing any code' → error
test('rejects task skill description missing stack name', ...)
test('rejects banned orchestration phrase in body', ...)           // body 'then invoke the next phase' → error
test('rejects rule without Essentials', ...)
test('rejects invalid guard regex', ...)                          // regex '(' → error names rule id
```

- [ ] **Step 2:** `node --test test/catalog.test.js` → FAIL.
- [ ] **Step 3: Implement** `loadCatalog` and `validateCatalog`. The loader is a recursive `readdir` + `parseFrontmatter`; files are read as UTF-8 and passed through `toLf`.
- [ ] **Step 4:** `node --test test/catalog.test.js` → PASS.
- [ ] **Step 5: Commit** `feat: load and validate the content catalog`.

---

### Task 4: Profile and project detection

**Files:**
- Create: `src/profile.js`, `src/detect.js`
- Test: `test/profile.test.js`, `test/detect.test.js` (temp dirs via `fs.mkdtemp(os.tmpdir())`)

**Interfaces:**
- Consumes: `Catalog`, `Profile`, `StackcrewError`.
- Produces:
  - **Constants:** `PROFILE_FILE = 'stackcrew.json'`, `TOOLS = ['claude','cursor','codex','antigravity']`.
  - `readProfile(projectDir) → Promise<Profile|null>`: `null` if the file is missing; invalid JSON throws `PROFILE`.
  - `writeProfile(projectDir, profile) → Promise<void>`: 2-space JSON plus a trailing LF.
  - `createProfile({ stack, addons=[], tools=TOOLS, mode, guard=true, basePackage=null }, catalog) → Profile`: sets `context: {}`, `decisions: []`. For a stack whose `language === 'java'` it also sets `java = { basePackage: basePackage ?? '', wired: false }`.
  - `validateProfile(profile, catalog) → string[]`. It checks:
    - `version === 1`;
    - stack known;
    - each addon known and applicable (`addon.languages` empty or includes `stack.language`);
    - `tools` non-empty ⊆ `TOOLS`;
    - `mode` enum;
    - `guard` boolean;
    - decisions shape;
    - `java.basePackage` matches `/^([a-z_]\w*)(\.[a-z_]\w*)*$/` when non-empty.
  - `detectProject(projectDir, catalog) → Promise<{ stack: string|null, candidates: string[], addons: string[], mode: 'greenfield'|'brownfield', basePackage: string|null }>`.
- **`DetectSpec` matching:** a spec matches if either of these holds:
  - **File match:** some file in `files` exists, its text includes some `contains` item (or `contains` is empty), and its text includes no `excludeContains` item.
  - **Package match:** some `packageDeps` item is in `package.json` `dependencies ∪ devDependencies`.

  The highest `priority` wins. A tie between two or more candidates gives `stack: null`. `brownfield` means any of `package.json, pom.xml, build.gradle, build.gradle.kts, go.mod` or a `src/` dir exists (port of SDLC `looksLikeExistingProject`, `SDLC/bin/cli.js:113-120`). `basePackage` is the `package` line of the first `src/main/java/**/*.java` file that contains `@SpringBootApplication`; scan at most 2,000 files.

- [ ] **Step 1: Write failing tests:**

```js
test('detects demo-java from pom with spring boot', ...)          // stack 'demo-java', mode 'brownfield'
test('excludeContains rejects quarkus pom', ...)                  // stack null, candidates []
test('tie between equal-priority stacks yields null + candidates', ...) // add a 2nd stack via cloned catalog object
test('empty dir is greenfield with no stack', ...)
test('finds basePackage from @SpringBootApplication', ...)        // 'com.example.kyc'
test('detects addon by pom content', ...)                         // addons ['demo-addon']
test('validateProfile rejects addon not applicable to stack language', ...)
test('validateProfile rejects unknown tool and bad basePackage', ...)
test('readProfile returns null when missing; throws PROFILE on bad JSON', ...)
```

- [ ] **Step 2:** `node --test test/profile.test.js test/detect.test.js` → FAIL.
- [ ] **Step 3: Implement** both modules.
- [ ] **Step 4:** Run the same command → PASS.
- [ ] **Step 5: Commit** `feat: add profile model and project detection`.

---

### Task 5: Skill directory plan and render context

**Files:**
- Create: `src/render/writeset.js`, `src/render/context.js`
- Test: `test/context.test.js`

**Interfaces:**
- Consumes: `Catalog`, `Profile`, `fillTemplate`, `parseFrontmatter`.
- Produces:
  - `planSkillDirs(tools: string[]) → SkillDirPlan`, following §9.2 exactly.
    - **`taskDirs`** (deduplicated, in this order):
      - `claude` → `.claude/skills` (format `claude`);
      - `codex` → `.agents/skills`;
      - `antigravity && !codex` → `.agent/skills` if `claude && cursor`, else `.agents/skills`;
      - `cursor && !claude` with no `.agents/skills` yet → `.agents/skills`.
    - **`commandDirs`:**
      - the generic `taskDirs`;
      - plus `.cursor/skills` when `cursor && claude` and `.agents/skills` is not among them.
    - **`warnings`:** `cursor-duplicate-skills` when `cursor && claude && codex`.
  - `loadCustomRules(projectDir) → Promise<RuleDoc[]>`. It reads `.stackcrew/custom/*.md`:
    - frontmatter `title` (required), optional `globs` list, optional `alwaysOn` boolean;
    - id = `custom-<basename>`;
    - a missing `## Essentials` is allowed (`essentials: ''`).
  - `buildContext(catalog, profile, { customRules = [], cli, version }) → RenderContext`. It builds:
    - **`rules`, in order:** core rules filtered by `categories` (match `stack.category`, empty = all) and `languages`; then the language rule; `stack.rules`; `stack.testing`; addon rules in profile order; custom rules with `alwaysOn !== true`.
    - **`alwaysOn`:** `catalog.alwaysOn` plus the bodies of `alwaysOn` custom rules.
    - **`skills`:** stack skills whose `requiresAddons ⊆ profile.addons`, then the shared `advisor` skills.
    - **`commandSkills`:** shared `command` skills.
    - **`roles`:** one per `RoleDoc`. Names are `stackcrew-tech-lead`, `stackcrew-<stackId>-developer`, `stackcrew-<stackId>-tester`. Each role's `skills` are the names of `ctx.skills` whose kind is in `skillKinds`.
    - **`vars`:** `{ stackId, stackName, cli, version, basePackage: profile.java?.basePackage ?? '' }`.
    - **Templating:** `fillTemplate` runs on every skill body, description, file content and role text.

- [ ] **Step 1: Write failing tests:**

```js
const rows = [ // tools → taskDirs.dir / commandDirs.dir / warning?
 [['claude'], ['.claude/skills'], [], false],
 [['cursor'], ['.agents/skills'], ['.agents/skills'], false],
 [['codex'], ['.agents/skills'], ['.agents/skills'], false],
 [['antigravity'], ['.agents/skills'], ['.agents/skills'], false],
 [['claude','cursor'], ['.claude/skills'], ['.cursor/skills'], false],
 [['claude','codex'], ['.claude/skills','.agents/skills'], ['.agents/skills'], false],
 [['claude','antigravity'], ['.claude/skills','.agents/skills'], ['.agents/skills'], false],
 [['claude','cursor','antigravity'], ['.claude/skills','.agent/skills'], ['.agent/skills','.cursor/skills'], false],
 [['claude','cursor','codex'], ['.claude/skills','.agents/skills'], ['.agents/skills'], true],
 [['claude','cursor','codex','antigravity'], ['.claude/skills','.agents/skills'], ['.agents/skills'], true],
 [['cursor','codex'], ['.agents/skills'], ['.agents/skills'], false],
 [['cursor','antigravity'], ['.agents/skills'], ['.agents/skills'], false] ]
test('planSkillDirs table', ...)
test('buildContext orders and filters rules', ...)    // ids: ['core-backend-api','core-testing','lang-java','stack-demo-java','stack-demo-java-testing']
test('skills requiring a missing addon are excluded', ...)   // without demo-addon: no 'stackcrew-demo-kafka'
test('roles get names, models and skill lists', ...)  // developer.skills includes 'stackcrew-demo-task', excludes 'stackcrew-demo-testing'
test('templates are filled; no {{sc: left anywhere', ...)
test('custom alwaysOn rule appends to alwaysOn; others join rules', ...)
```

- [ ] **Step 2:** `node --test test/context.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: build render context and skill directory plan`.

---

### Task 6: Marked blocks, apply and manifest

**Files:**
- Create: `src/fs/marked-block.js`, `src/fs/apply.js`
- Test: `test/apply.test.js`

**Interfaces:**
- Consumes: `FileOp`, `Manifest`, `sha256`, `toLf`.
- Produces:
  - `MD_MARKERS = { begin: '<!-- stackcrew:begin -->', end: '<!-- stackcrew:end -->' }`, `GRADLE_MARKERS = { begin: '// stackcrew:begin', end: '// stackcrew:end' }`.
  - `upsertMarkedBlock(existing: string, content: string, markers = MD_MARKERS) → string`:
    - **EOL** = `'\r\n'` if `existing` contains it, else `'\n'`.
    - **Exactly one begin and one end, with begin before end:** replace only the text between them.
    - **Neither marker present:** append `existing` + (an EOL if it doesn't end with one) + (a blank line if it is non-empty) + `begin EOL content EOL end EOL`.
    - **Anything else:** throw `MARKER`.
  - `MANIFEST_PATH = '.stackcrew/manifest.json'`.
  - `applyOps(projectDir, ops: FileOp[], { force = false, dryRun = false }) → Promise<ApplyReport>`. It runs in phases:
    1. Reject absolute paths or paths containing `..` → `RENDER`.
    2. Compute every block result in memory. Any `MARKER` error aborts before any write.
    3. Read the manifest. Missing gives `missing`; unparsable or wrong shape gives `corrupt`.
    4. For each owned op:
       - absent file → write it;
       - existing file whose hash equals the new content's hash → `unchanged`;
       - existing file whose hash equals the manifest hash → overwrite it;
       - any other existing file → `skippedModified`, unless `force`.
    5. Deletions run **only** when the manifest is `ok`. A path in the old manifest but not in the new ops is deleted if its hash matches the manifest; otherwise it goes to `skippedModified` (or is deleted when `force`).
    6. Write the manifest: written and unchanged paths get the new hash; skipped paths keep their old hash.
    7. Create parent dirs. Write owned files as LF and block files with their own EOL.

- [ ] **Step 1: Write failing tests:**

```js
test('appends block to file without markers, keeps other bytes', ...)
test('preserves SDLC section bytes', ...)   // existing '## SDLC Workflow\nX\n' → result.startsWith(existing)
test('keeps CRLF', ...)                     // existing 'a\r\n' → result === 'a\r\n\r\n<!-- stackcrew:begin -->\r\nB\r\n<!-- stackcrew:end -->\r\n'
test('replaces only between markers', ...)
test('half marker aborts all writes', ...)  // AGENTS.md has only begin marker + an owned op → rejects MARKER; owned file NOT created
test('writes owned files and manifest', ...)
test('refuses to overwrite hand-edited owned file', ...) // edit file → apply same ops → skippedModified=[p], content still edited; force → overwritten
test('deletes stale owned file listed in manifest', ...)
test('missing manifest deletes nothing', ...)
test('corrupt manifest deletes nothing', ...) // manifest '{' → manifestStatus 'corrupt', stale file kept
test('dryRun writes nothing', ...)
test('rejects path traversal', ...)         // '../x' → RENDER
```

- [ ] **Step 2:** `node --test test/apply.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: apply file ops with marked blocks and hash manifest`.

---

### Task 7: Skills renderer and Claude renderer

**Files:**
- Create: `src/render/notice.js`, `src/render/skills.js`, `src/render/claude.js`
- Test: `test/render-claude.test.js`

**Interfaces:**
- Consumes: `RenderContext`, `stringifyFrontmatter`.
- Produces:
  - `GENERATED_NOTICE = '<!-- Generated by stackcrew. Do not edit: change stackcrew.json or .stackcrew/custom/, then run `stackcrew sync`. -->'`. It is placed right after the frontmatter, or first if there is none.
  - `renderSkills(ctx) → FileOp[]`:
    - **Task dirs:** every `ctx.skills` item goes into each `ctx.skillDirs.taskDirs` entry.
    - **Command dirs:** every `ctx.commandSkills` item goes into each `commandDirs` entry.
    - **Output:** `<dir>/<name>/SKILL.md`, plus each `SkillFile` at `<dir>/<name>/<relPath>`.
    - **Frontmatter:** format `claude` writes `name`, `description`, and `paths` when non-empty. Format `generic` writes only `name` and `description`.
  - `renderClaude(ctx) → FileOp[]` (empty unless `tools` includes `claude`):
    - `.claude/rules/stackcrew/core.md`: notice + `ctx.alwaysOn`, no frontmatter.
    - `.claude/rules/stackcrew/<rule.id>.md` for each `ctx.rules`: frontmatter `paths: rule.globs ?? ctx.stack.globs`, then notice, then body.
    - `.claude/agents/<role.name>.md`: frontmatter `name`, `description`, `model`, `skills` (list), then the body.
    - A `block` op on `CLAUDE.md` with this content:
      `stackcrew: coding rules for this repo are in .claude/rules/stackcrew/ (auto-loaded). Architecture decisions: docs/stackcrew/architecture-profile.md.`

- [ ] **Step 1: Write failing tests** (mini catalog, tools `['claude']`):

```js
test('core rule has no frontmatter and contains always-on text', ...)
test('stack rule frontmatter paths equal stack globs', ...)   // parseFrontmatter(...).data.paths deepEqual ['**/*.java']
test('claude skill keeps paths; generic skill drops it', ...)  // tools ['claude','codex']
test('agent frontmatter lists preloaded skills', ...)
test('CLAUDE.md op is a block op', ...)
test('no op path outside owned prefixes', ...)                // every path matches the Global Constraints owned list or is CLAUDE.md/AGENTS.md
```

- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `node --test test/render-claude.test.js` → PASS.
- [ ] **Step 5: Commit** `feat: render skills and Claude Code rules/agents`.

---

### Task 8: AGENTS.md block and Cursor renderer

**Files:**
- Create: `src/render/agents-md.js`, `src/render/cursor.js`
- Test: `test/render-cursor.test.js`

**Interfaces:**
- Consumes: `RenderContext`, `GENERATED_NOTICE`.
- Produces:
  - `AGENTS_BLOCK_BUDGET = 12000`.
  - `renderAgentsMdBlock(ctx) → FileOp|null`. It returns `null` unless one of `cursor|codex|antigravity` is selected.
    - **Content:** `## stackcrew rules` + `ctx.alwaysOn`.
    - **Codex selected:** add, for each rule with non-empty essentials, `### <title> — essentials` + essentials. End with `Full rules: use the skill \`stackcrew-<stackId>-rules\`.`
    - **Budget:** over budget throws `BUDGET`, with the byte count and the top three largest rules.
  - `renderCursor(ctx) → FileOp[]` (empty unless `cursor`):
    - `.cursor/rules/stackcrew/<rule.id>.mdc` with frontmatter `description: <title>`, `globs: "<globs joined by ,>"`, `alwaysApply: false`, then notice, then body. More than 500 lines throws `BUDGET`.
    - **Agents:** if `claude` is not selected, `.cursor/agents/<role.name>.md` with frontmatter `name` and `description`, then the body. If `claude` is selected, write nothing (Cursor reads `.claude/agents`).

- [ ] **Step 1: Write failing tests:**

```js
test('null when only claude', ...)
test('essentials included only when codex selected', ...)
test('throws BUDGET when block exceeds 12000 bytes', ...)     // inflate a rule's essentials
test('cursor rule frontmatter', ...)  // data.globs === '**/*.java', data.alwaysApply === false
test('cursor agents only without claude', ...)
```

- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: render AGENTS.md block and Cursor rules`.

---

### Task 9: Codex renderer

**Files:**
- Create: `src/render/codex.js`
- Test: `test/render-codex.test.js`

**Interfaces:**
- Produces:
  - `renderCodex(ctx) → FileOp[]` (empty unless `codex`):
    - **Rules skill:** `.agents/skills/stackcrew-<stackId>-rules/SKILL.md`.
      - Frontmatter: `name`, plus description `Use when writing, editing or reviewing <stackName> code in this repository to load the full stackcrew rules for <stackName>.`
      - Body: one line per rule, linking `rules/<rule.id>.md`.
      - One `rules/<rule.id>.md` file per rule.
    - **Agents:** `.codex/agents/<role.name>.toml` per role, built by `toTomlAgent`.
  - `toTomlAgent(role: RenderedRole) → string`. It writes keys `name`, `description` (TOML basic strings, escaped) and `developer_instructions`. The instructions are a multi-line literal string `'''…'''`, or an escaped basic multi-line string `"""…"""` when the body contains `'''`.

- [ ] **Step 1: Write failing tests:**

```js
test('rules skill lists every rule and ships each as a file', ...)
test('rules skill description passes lintSkillDescription', ...)
test('toml escapes quotes and handles triple quotes in body', ...) // body containing "'''" → uses """ form; description with " escaped
```

- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: render Codex rules skill and agents`.

---

### Task 10: Antigravity renderer

**Files:**
- Create: `src/render/antigravity.js`
- Test: `test/render-antigravity.test.js`

**Interfaces:**
- Produces: `renderAntigravity(ctx) → FileOp[]` (empty unless `antigravity`):
  - **Rules:** `.agents/rules/stackcrew-<rule.id>.md`, flat with no subfolders. Frontmatter `trigger: glob`, `globs: "<joined by ,>"` (a quoted string), then notice, then body. More than 24,000 bytes throws `BUDGET`.
  - **Agents:** `.agents/agents/<role.name>.md` with frontmatter `name`, `description`, `model: inherit`, `skills` (list), then the body.

- [ ] **Step 1: Write failing tests:**

```js
test('rule frontmatter has trigger glob and quoted globs', ...) // raw text includes 'globs: "**/*.java"'; data.trigger === 'glob'
test('rule files are flat under .agents/rules', ...)
test('throws BUDGET over 24000 bytes', ...)
```

- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: render Antigravity rules and agents`.

---

### Task 11: Shared outputs and `renderProject`

**Files:**
- Create: `src/render/shared.js`, `src/render/index.js`
- Test: `test/render-project.test.js`

**Interfaces:**
- Consumes: all renderers above.
- Produces:
  - `renderShared(ctx) → FileOp[]`:
    - **`docs/stackcrew/architecture-profile.md`:** sections `# Architecture profile`, `## Stack` (name + minVersion), `## Add-ons`, `## Context` (table of `profile.context`), `## Decisions` (per decision: `### <id> — <area>`, Decision, Rationale, Rejected) and `## How to change` ("edit stackcrew.json, then run `stackcrew sync`").
    - **`.stackcrew/guard.json`:** `{ "version": 1, "enabled": profile.guard, "rules": [...language.guard, ...stack.guard] }`, 2-space JSON.
    - **Lint files:** `.stackcrew/lint/<relPath>` for each `stack.lintFiles` (templated).
    - **Wire files:** when `profile.java?.wired && basePackage`, each `stack.wireFiles` goes to `src/test/java/<basePackage with . → />/stackcrew/<relPath>` (templated).
    - **`.stackcrew/ci/Jenkinsfile.stackcrew.groovy`** with this exact content (version filled):

```groovy
// Generated by stackcrew {{sc:version}}: paste this stage into your Jenkinsfile.
// Shallow/multibranch clones: fetch the target branch first (git fetch origin <target>), otherwise check fails loudly.
stage('stackcrew check') {
  steps {
    sh 'npx --yes stackcrew@{{sc:version}} check --base "origin/${CHANGE_TARGET:-main}"'
  }
}
```

  - `renderProject(ctx) → RenderResult`:
    - **Concatenation order:** `renderSkills`, `renderClaude`, `renderCursor`, `renderCodex`, `renderAntigravity`, `renderAgentsMdBlock` (when non-null, `block` on `AGENTS.md`), `renderShared`.
    - **Duplicate paths** → `RENDER`.
    - **Any path starting with `docs/sdlc/`** → `RENDER`.
    - **`warnings`** come from `skillDirs.warnings`.

- [ ] **Step 1: Write failing tests** (mini catalog, all four tools):

```js
test('renders expected path set for all tools', ...)  // includes .claude/rules/stackcrew/core.md, .cursor/rules/stackcrew/stack-demo-java.mdc,
     // .agents/rules/stackcrew-stack-demo-java.md, .agents/skills/stackcrew-demo-java-rules/SKILL.md, .codex/agents/stackcrew-demo-java-developer.toml,
     // .agents/agents/stackcrew-tech-lead.md, docs/stackcrew/architecture-profile.md, .stackcrew/guard.json, .stackcrew/ci/Jenkinsfile.stackcrew.groovy, AGENTS.md, CLAUDE.md
test('warns cursor-duplicate-skills for claude+cursor+codex', ...)
test('guard.json merges language and stack rules and honors guard flag', ...)
test('wire files rendered only when wired', ...)  // path src/test/java/com/example/kyc/stackcrew/StackcrewArchitectureTest.java, content has 'package com.example.kyc.stackcrew;'
test('jenkins snippet pins the package version', ...)
test('throws RENDER on duplicate path', ...)
```

- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: render shared outputs and assemble project render`.

---

### Task 12: Commands `init`, `sync`, `add`, `list`, `detect`

**Files:**
- Create: `src/commands/{run-sync,init,sync,add,list,detect}.js`
- Modify: `src/cli.js`
- Test: `test/commands.test.js` (spawns the CLI in temp dirs, with `STACKCREW_CATALOG_DIR` = mini catalog and stdin not a TTY)

**Interfaces:**
- Consumes: `loadCatalog`, `validateCatalog`, `readProfile`/`writeProfile`/`createProfile`/`validateProfile`, `detectProject`, `loadCustomRules`, `buildContext`, `renderProject`, `applyOps`, `planJavaWiring` (Task 15; until then `--wire` prints `not implemented` and returns 1).
- Produces:
  - **Command signature:** each command module exports `<name>Command(args: string[], io) → Promise<number>`.
  - **`runSync(projectDir, { force, wire, dryRun }, io) → Promise<number>`:**
    - load and validate the catalog and the profile (errors → exit 1);
    - `buildContext` with `cli: 'npx --yes stackcrew@<version>'`;
    - `renderProject`, then `applyOps`.
    - **Prints:** written/unchanged/deleted counts, every warning, and every `skippedModified` path with the hint "re-run with --force (your edits will be lost) or move them to .stackcrew/custom/".
    - **Java stack not wired:** prints the `--wire` hint.
    - **Returns 1** if `skippedModified` is non-empty, else 0.
  - **`init [--stack <id>] [--addons a,b] [--tools t,…] [--wire] [--force] [--no-guard]`:**
    - existing profile without `--force` → exit 1, "already initialized; use `stackcrew sync`";
    - the stack comes from the flag, then from detection (stack aliases accepted). If there is none and stdin is a TTY, prompt with a numbered list. If there is none and no TTY → exit 1 listing the stacks;
    - addons come from the flag or the detected addons; tools from the flag, else all four;
    - `createProfile`, then `writeProfile`, then `runSync`;
    - prints next steps: Claude → `/stackcrew:init`; other tools → "ask your agent to use the skill stackcrew-init".
  - **`sync [--force] [--wire] [--dry-run]`:** calls `runSync`. A missing profile → exit 1, "run `stackcrew init` first".
  - **`add <addon…>`:** validates applicability, appends to `profile.addons` without duplicates, writes the profile, then `runSync`.
  - **`list`:** prints stacks (id, name, category, minVersion) and addons (id, name, languages).
  - **`detect`:** prints the detection result as `key: value` lines.
- **Arguments:** parsed with `util.parseArgs({ strict: true, allowPositionals: true })`. Unknown flags → exit 1 with the command's usage.

- [ ] **Step 1: Write failing tests:**

```js
test('init with flags writes profile and rendered files', ...)    // stackcrew.json, .claude/rules/stackcrew/core.md, .stackcrew/manifest.json exist; exit 0
test('init twice without --force exits 1', ...)
test('init without stack in non-TTY empty dir exits 1 listing stacks', ...)
test('init detects stack from pom', ...)
test('sync refuses hand-edited generated file (exit 1) and --force fixes it', ...)
test('sync removes rules of a removed addon', ...)               // init --addons demo-addon, edit profile to [], sync → addon-demo-addon files gone
test('add appends addon and re-renders', ...)
test('add rejects addon not applicable to stack', ...)
test('list and detect print expected lines', ...)
test('custom rule in .stackcrew/custom is rendered for claude and cursor', ...)
```

- [ ] **Step 2:** `node --test test/commands.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** → PASS. Then run `npm test` → all PASS.
- [ ] **Step 5: Commit** `feat: add init, sync, add, list and detect commands`.

---

### Task 13: Guard scanner and PreToolUse hook

**Files:**
- Create: `src/guard/scan.js`, `src/guard/hook.js`
- Test: `test/guard.test.js`

**Interfaces:**
- Consumes: `GuardRule`, `matchesAny`, `toPosix`.
- Produces:
  - `compileGuardRules(rules: GuardRule[]) → { rule: GuardRule, re: RegExp }[]`. An invalid regex throws `CATALOG` naming the rule id.
  - `isAllowed(text: string, ruleId: string) → boolean`. True if the line matches `/stackcrew-allow:\s*(SC-[A-Z]+)\s+\S/` with that id. A marker without a reason does not count.
  - `scanLines(relPath: string, lines: {line:number,text:string}[], compiled) → Violation[]`. A rule applies when `matchesAny(relPath, globs)` and not `matchesAny(relPath, excludeGlobs)`.
  - `newLines(toolName, toolInput, currentFileText: string|null) → {line,text}[]` (multiset line diff):
    - **Write:** lines of `content` whose occurrence count exceeds their count in the current file. Line numbers are 1-based in `content`.
    - **Edit:** lines of `new_string` not covered by `old_string`.
    - **MultiEdit:** the same, for each item in `edits[]` if present.
  - `runHook(input: unknown, { env, readFile }) → { exitCode: 0|2, stderr: string }`:
    - **Fails open (exit 0):** non-object input; `tool_name` ∉ `Edit|Write|MultiEdit`; no root (`env.CLAUDE_PROJECT_DIR ?? input.cwd`); `.stackcrew/guard.json` missing, unparsable or `enabled: false`; file outside root; any thrown error.
    - **Relative path:** compute `relPath` with string operations so it works the same on every OS. Take `a = toPosix(file_path)` and `r = toPosix(root)` with any trailing `/` removed. If `a.toLowerCase()` starts with `r.toLowerCase() + '/'`, then `relPath = a.slice(r.length + 1)`; otherwise the file is outside the project and the hook exits 0. Don't use `path.relative`, because POSIX hosts treat `\` as a literal character.
  - **Violations → exit 2.** stderr starts with `stackcrew guard blocked this edit:` and lists `- [<ruleId>] <relPath>:<line>: <message>` and `    > <text>` per violation. It ends with ``Fix the code to follow the rule. For a justified exception add `stackcrew-allow: <ruleId> <reason>` in a comment on that line.``
  - **Standalone use:** when run directly, `hook.js` reads all of stdin, `JSON.parse`s it (failure → exit 0), calls `runHook` with `fs.readFileSync`, writes stderr, and exits with the code.

- [ ] **Step 1: Write failing tests:**

```js
// group 'hook fails open'
test('malformed stdin exits 0', ...)                  // spawn node src/guard/hook.js with stdin 'not json'
test('file outside project exits 0', ...)
test('no guard.json exits 0', ...)
test('guard disabled exits 0', ...)
// blocking
test('Write of new java file with JsonNode exits 2 and names SC-TYPE', ...)
test('excluded test path is not blocked', ...)        // src/test/java/... → 0
test('Edit keeping a pre-existing violation is not blocked', ...)  // old_string and new_string both contain JsonNode line → 0
test('allow marker with reason passes; without reason blocks', ...)
test('windows paths are normalized', ...)             // root 'C:\\p', file_path 'C:\\p\\src\\main\\java\\A.java' → 2
test('scanLines reports correct line numbers', ...)
```

- [ ] **Step 2:** `node --test test/guard.test.js` → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: add guard scanner and PreToolUse hook`.

---

### Task 14: `check` command (diff scan for CI)

**Files:**
- Create: `src/guard/diff.js`, `src/commands/check.js`
- Modify: `src/cli.js`
- Test: `test/check.test.js` (temp git repos; commit with `git -c user.email=t@t -c user.name=t commit`)

**Test repos:** create them with `git init -b main`.

**Interfaces:**
- Consumes: `compileGuardRules`, `scanLines`.
- Produces:
  - `parseUnifiedDiff(text: string) → DiffFile[]`. It handles `+++ b/<path>` (quoted paths unquoted), `+++ /dev/null` (skip), `rename to`, multiple `@@ -a,b +c,d @@` hunks (added-line numbers counted from `c`), `\ No newline at end of file`, and `Binary files … differ` (skip).
  - `checkCommand(args, io) → Promise<number>` with `[--base <ref>] [--staged]`:
    1. Run `git rev-parse --show-toplevel`. Failure → exit 2, `stackcrew check: not a git repository`.
    2. With `--base`: run `git rev-parse --verify --quiet <ref>^{commit}`. Failure → exit 2, ``stackcrew check: base ref not found: <ref> (fetch it first, e.g. `git fetch origin <branch>`)``.
    3. Read `.stackcrew/guard.json` (it ignores `enabled`). Missing → exit 2, ``stackcrew check: not initialized (.stackcrew/guard.json missing); run `stackcrew sync` ``.
    4. Get the diff with `git -c core.quotepath=false diff --unified=0 --no-color --no-ext-diff`:
       - `--base` → `<base>...HEAD`;
       - `--staged` → `--cached`;
       - default → `HEAD`, plus untracked files (`git ls-files --others --exclude-standard`) scanned in full.
    5. Print each violation as `<file>:<line> [<ruleId>] <message>` and `    > <text>`, then `stackcrew check: <n> violation(s)` → exit 1. With no violations print `stackcrew check: 0 violations in <k> added line(s) across <m> file(s)` → exit 0.
- **git calls:** `child_process.execFileSync('git', …, { encoding: 'utf8', maxBuffer: 64 MiB })`.

- [ ] **Step 1: Write failing tests:**

```js
test('parseUnifiedDiff: hunks, rename, deleted file, no-newline marker', ...)  // assert exact {file, lines} arrays
test('check fails loudly outside a git repo', ...)     // exit 2, stderr /not a git repository/
test('check fails loudly when base ref is missing', ...) // --base origin/nope → exit 2, stderr /base ref not found/, stdout NOT /0 violations/
test('check fails when not initialized', ...)
test('check --base reports added violation with line number', ...)  // branch adds JsonNode line → exit 1, stdout includes 'src/main/java/A.java:3 [SC-TYPE]'
test('check ignores pre-existing violations', ...)     // violation already on main → exit 0
test('default mode scans untracked files', ...)
```

- [ ] **Step 2:** `node --test test/check.test.js` → FAIL. **Step 3:** Implement. **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: add diff-based check command for CI`.

---

### Task 15: Java wiring (`--wire`)

**Files:**
- Create: `src/wire/java.js`
- Modify: `src/commands/run-sync.js`
- Test: `test/wire-java.test.js`

**Interfaces:**
- Consumes: `upsertMarkedBlock`, `MD_MARKERS`, `GRADLE_MARKERS`.
- Produces:
  - `ARCHUNIT_VERSION`: the latest **1.x** `com.tngtech.archunit:archunit-junit5` release. **Verify it via Context7 (`/tngtech/archunit`) or Maven Central at implementation time** and write the value into the constant.
  - `planJavaWiring({ pomXml?: string, buildGradle?: string, buildGradleKts?: string }) → { edits: { path: 'pom.xml'|'build.gradle'|'build.gradle.kts', content: string }[], notes: string[] }`:
    - **pom.xml:** place a block inside the project-level `<dependencies>`. Find it after masking `<dependencyManagement>…</dependencyManagement>`, `<build>…</build>` and `<profiles>…</profiles>`. The block uses `MD_MARKERS` and contains `<dependency><groupId>com.tngtech.archunit</groupId><artifactId>archunit-junit5</artifactId><version>ARCHUNIT_VERSION</version><scope>test</scope></dependency>`. It sits before that `</dependencies>`, or replaces an existing marked block in place. Without a project-level `<dependencies>`, add no edit and add a note with the snippet.
    - **Gradle:** place a block right after the first top-level `dependencies {` line, skipping `buildscript { … }` via brace matching, using `GRADLE_MARKERS`.
      - **Kotlin:** `testImplementation("com.tngtech.archunit:archunit-junit5:V")`.
      - **Groovy:** `testImplementation 'com.tngtech.archunit:archunit-junit5:V'`.
    - **Idempotent:** a second run returns identical content.
  - **`runSync` with `--wire`** (Java stack only):
    1. Requires `profile.java.basePackage`. If it is empty, use the detected one; if still empty → exit 1, "set java.basePackage in stackcrew.json".
    2. Writes the edits, keeping each file's EOL.
    3. Sets `profile.java.wired = true`, writes the profile, then renders, so the ArchUnit test file is emitted by `renderShared`.
    4. Prints the Checkstyle snippet note (Checkstyle is not wired in Plan 1).

- [ ] **Step 1: Write failing tests:**

```js
test('pom: inserts block into project dependencies, not dependencyManagement', ...)
test('pom: second run is identical', ...)
test('pom without dependencies returns a note, no edit', ...)
test('gradle kts and groovy: block after top-level dependencies, not buildscript', ...)
test('sync --wire on demo-java writes pom block and ArchUnit test file', ...) // CLI e2e in temp dir with mini catalog
```

- [ ] **Step 2:** → FAIL. **Step 3:** Implement. **Step 4:** `node --test test/wire-java.test.js` → PASS.
- [ ] **Step 5: Commit** `feat: wire ArchUnit into Maven/Gradle on --wire`.

---

### Task 16: Plugin build, hooks and drift test

**Files:**
- Create: `src/plugin/build.js`, `src/commands/plugin.js`
- Modify: `src/cli.js`
- Test: `test/plugin.test.js`, `test/plugin-drift.test.js`
- Generated + committed: `.claude-plugin/marketplace.json`, `plugin/**`

**Interfaces:**
- Consumes: `loadCatalog`, `stringifyFrontmatter`, `fillTemplate`, `readPackageVersion`.
- Produces: `buildPlugin({ pkgRoot, outRoot, version, catalog }) → Promise<string[]>` (relative paths written). It first deletes `<outRoot>/plugin/`, then writes:
  - **`.claude-plugin/marketplace.json`:** `{ name: 'stackcrew', owner: { name: 'stackcrew' }, plugins: [{ name: 'stackcrew', source: './plugin', description, version }] }`. Same shape as SDLC `buildMarketplaceJson`, `SDLC/bin/cli.js:307-324`.
  - **`plugin/.claude-plugin/plugin.json`:** `{ name: 'stackcrew', description, version, keywords: ['rules','skills','design-patterns','spring-boot','guard'] }`.
  - **`plugin/hooks/hooks.json`:** `PreToolUse`, matcher `Edit|Write|MultiEdit`, one `command` hook running `plugin/cli/src/guard/hook.js` with Node, `timeout: 10`.
    - **Verify the current hooks.json schema first** at https://code.claude.com/docs/en/hooks.md (WebFetch or the claude-code-guide agent).
    - If exec form (`command` + `args`) is documented, use `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/cli/src/guard/hook.js"]`.
    - Otherwise use `"command": "node \"${CLAUDE_PLUGIN_ROOT}/cli/src/guard/hook.js\""`.
  - **`plugin/skills/init/`:** the catalog's `stackcrew-init` skill, renamed `init`, with frontmatter adding `disable-model-invocation: true`. Its body and files are templated with `cli = node "${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js"`.
  - **`plugin/skills/<name>/SKILL.md`:** one per `catalog.pluginCommands` entry (same frontmatter rule, same `cli`).
  - **`plugin/cli/`:** copies of `bin/`, `src/` and `catalog/` (`catalog/` only if it exists), plus `plugin/cli/package.json` = `{ name, version, type: 'module', bin }`.
  - **CLI:** `stackcrew plugin` builds into `PKG_ROOT` and prints the written paths.

- [ ] **Step 1: Write failing tests:**

```js
test('builds marketplace, manifest, hooks, skills and bundled cli', ...) // outRoot = tmp, catalog = mini
test('command skills are user-only and call the bundled CLI', ...)       // data['disable-model-invocation'] === true; body includes '${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js'
test('bundled cli runs from the plugin copy', ...)   // spawn node <tmp>/plugin/cli/bin/stackcrew.js version → version (proves import.meta.url catalog resolution)
test('hook matcher covers Edit, Write and MultiEdit', ...)
// test/plugin-drift.test.js
test('committed plugin matches a fresh build', ...)  // build real catalog into tmp; compare every file under plugin/ and .claude-plugin/ (LF-normalized) with repo copy; message lists files + 'run: node bin/stackcrew.js plugin'
```

- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implement**, then run `node bin/stackcrew.js plugin` to generate the committed copy.
- [ ] **Step 4:** `npm test` → all PASS. If the `claude` CLI is installed, also run `claude plugin validate ./plugin` and expect no errors. If it isn't, note that in the commit body.
- [ ] **Step 5: Commit** `feat: build Claude Code plugin with guard hook and command skills`.

---

### Task 17: Content: core always-on and core rules

**Files:**
- Create: `catalog/core/always-on.md` and `catalog/core/rules/{type-safety,error-handling,logging,testing,performance,security,backend-api,frontend,delivery,brownfield}.md`
- Test: `test/catalog-real.test.js` (new), `test/package.test.js` (add assertion)

**Content requirements:**
- **`always-on.md`** (≤ 6,000 bytes, English). Headings, in this order:
  - `# stackcrew rules`
  - `## Project profile`: read `docs/stackcrew/architecture-profile.md` and `stackcrew.json` before any non-trivial change.
  - `## SC-PREFLIGHT`: the 5-point implementation note from spec §7.2; skip only for trivial one-line changes.
  - `## SC-TYPE`, `## SC-CONST`, `## SC-REUSE`, `## SC-PATTERN`: the rule, correct approach and exception from spec §5.1. Language examples live in language rules, not here. SC-PATTERN points to the skill `stackcrew-pattern-guide`.
  - `## Decision gate`: stop and ask the user before new infrastructure, a pattern or architecture that departs from the profile, or a big dependency. Record the outcome as a new decision in `stackcrew.json`.
  - `## Exceptions`: the `stackcrew-allow: <rule-id> <reason>` marker.
- **Core rules: port and trim `DEV_QUALITY_RULES`** (`SDLC/bin/cli.js:3325-3486`):

  | New file | SDLC source |
  |---|---|
  | `type-safety.md` | §3 (3344) |
  | `error-handling.md` | §4 "Error handling" (3350) |
  | `logging.md` | §4 logging → operability (3356-3392) |
  | `testing.md` | §2 (3338) + §12G (3466) |
  | `performance.md` | §5 (3393) |
  | `security.md` | §6 (3398) + §12E (3458) |
  | `backend-api.md` | §12 A–D, F (3437-3465); `categories: [backend, fullstack]` |
  | `frontend.md` | §10–11 (3418-3434); `categories: [frontend, fullstack]` |
  | `delivery.md` | §1, §7, §8, §9 (3331, 3403-3417) |
  | `brownfield.md` | §14 (3477) |

  **Drop:** living-guideline lines, phase checkpoints, "Phase 8", `docs/sdlc` links and §13. §13 moves to the pattern guide in Task 20.

  **Each file:** frontmatter `id: core-<name>`, `title`, then `## Essentials` (≤ 15 bullets), then the detail.

- [ ] **Step 1: Write failing tests:**

```js
test('real catalog validates clean', async () => assert.deepEqual(validateCatalog(await loadCatalog()), []))
test('always-on has SC headings in order and fits 6000 bytes', ...) // ['## Project profile','## SC-PREFLIGHT','## SC-TYPE','## SC-CONST','## SC-REUSE','## SC-PATTERN','## Decision gate','## Exceptions']
test('core rules exist with ids', ...)   // the 10 ids
test('no SDLC-only concepts leak', ...)  // no file contains 'docs/sdlc', 'Phase 8', 'guideline/'
// package.test.js
test('npm pack ships catalog', ...)      // includes 'catalog/core/always-on.md'
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content. **Step 4:** `npm test` → PASS. (Real-catalog validation only covers the dirs that exist; empty `stacks/` is allowed until Task 18.)
- [ ] **Step 5:** `node bin/stackcrew.js plugin`, then `npm test`. **Commit** `feat(catalog): core always-on and core rules`.

---

### Task 18: Content: Java language and Spring Boot stack

**Files:**
- Create:
  - `catalog/languages/java/{rule.md,guard.json}`
  - `catalog/stacks/spring-boot/{stack.json,rules.md,testing.md}`
  - `catalog/stacks/spring-boot/lint/checkstyle.xml`
  - `catalog/stacks/spring-boot/wire/StackcrewArchitectureTest.java`
  - `catalog/stacks/spring-boot/skills/{stackcrew-spring-integration-provider,stackcrew-spring-rest-endpoint,stackcrew-spring-kafka-consumer,stackcrew-spring-boot-testing}/SKILL.md`
- Test: `test/catalog-spring.test.js`

**Content requirements:**
- **`stack.json`:**
  - `id: "spring-boot"`, `name: "Spring Boot"`, `category: "backend"`, `language: "java"`, `minVersion: "3.0"`;
  - `globs: ["**/*.java"]`, `aliases: ["spring","springboot"]`, `priority: 10`;
  - `detect`: files `["pom.xml","build.gradle","build.gradle.kts"]`, contains `["org.springframework.boot"]`, excludeContains `["io.quarkus"]`, packageDeps `[]`.
- **`languages/java/rule.md`:**
  - port `TECH_STACKS.java` (`SDLC/bin/cli.js:3712-3731`);
  - add SC-TYPE / SC-CONST / SC-REUSE wrong→right Java examples;
  - add the record-vs-Lombok rule (Global Constraints);
  - jakarta only.
- **`languages/java/guard.json`:** these SC rules, all with globs `["**/*.java"]` and excludeGlobs `["**/src/test/**"]`:
  - SC-TYPE `\b(JsonNode|ObjectNode)\b`;
  - SC-TYPE `Map<\s*String\s*,\s*Object\s*>`;
  - SC-TYPE `Map<\s*\?\s*,\s*\?\s*>`;
  - SC-CONST `^(?!.*\bstatic\s+final\b).*"https?://` (hardcoded URL outside a constant).

  Each rule's message states the fix.
- **`rules.md`:**
  - port `spring-boot` + `spring-jpa` (`SDLC/bin/cli.js:3777-3828`);
  - Boot 3 specifics: `jakarta.*`, `RestClient`, `ProblemDetail`, Micrometer Tracing;
  - a provider-integration section: port + Adapter + ACL + registry, linking the skill.
- **`testing.md`:** JUnit 5 + AssertJ, Mockito, slice tests, Testcontainers (no H2 stand-in), **WireMock for every third-party provider**, the ArchUnit test, and naming/AAA rules from core testing.
- **Skills** (`kind: task` unless noted; `paths: ["**/*.java"]`; descriptions name "Spring Boot"):
  - **`stackcrew-spring-integration-provider`:** the steps for spec §13 fixture 1:
    - port interface;
    - adapter per provider;
    - ACL DTO mapping (records);
    - provider registry via `Map<String, ProviderPort>` injection (Strategy + Factory);
    - Template Method base flow (auth → call → map → audit);
    - Resilience4j circuit breaker/retry/timeout;
    - idempotency key for callbacks;
    - per-provider logs/metrics with traceId;
    - WireMock tests;
    - a Camel variant section used only when the profile has the `camel` addon.
  - **`stackcrew-spring-rest-endpoint`:** DTO records, Bean Validation, `ProblemDetail`, layering, pagination.
  - **`stackcrew-spring-kafka-consumer`:** `requiresAddons: [kafka]`; idempotent consumer, DLT, typed events, outbox link.
  - **`stackcrew-spring-boot-testing`:** `kind: testing`.
- **`wire/StackcrewArchitectureTest.java`:**
  - package `{{sc:basePackage}}.stackcrew`;
  - `@AnalyzeClasses(packages = "{{sc:basePackage}}")`;
  - rule: no field, method parameter or return type in `..service..`/`..domain..` of raw type `com.fasterxml.jackson.databind.JsonNode`/`ObjectNode`, or `java.util.Map` with an `Object` value type (generic inspection);
  - rule: no field injection (`@Autowired` on fields);
  - rule: controllers don't depend on repositories.
  - **Verify the ArchUnit 1.x API (generic type inspection, `haveRawType` by name) via Context7 `/tngtech/archunit` before writing.**
- **`lint/checkstyle.xml`:** `MagicNumber`, `IllegalType` (`JsonNode`, `ObjectNode`), `MethodLength` (max 60), `AvoidStarImport`. **Verify module and property names via Context7 (checkstyle) before writing.**

- [ ] **Step 1: Write failing tests:**

```js
test('spring-boot stack loads with 4 skills and validates', ...)
test('detects spring-boot and not quarkus', ...)   // temp dirs with pom contents
test('java guard blocks JsonNode, Map<String, Object>, hardcoded URL; allows static final URL', ...) // scanLines on sample lines
test('kafka skill only rendered with kafka addon', ...)
test('wire template fills basePackage', ...)
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content (verify the APIs first, as above). **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `node bin/stackcrew.js plugin`, then `npm test`. **Commit** `feat(catalog): Java language and Spring Boot stack`.

---

### Task 19: Content: add-ons (Kafka, RabbitMQ, Camel, observability)

**Files:**
- Create: `catalog/addons/{kafka,rabbitmq,camel,observability}/{addon.json,rules.md}`
- Test: `test/catalog-addons.test.js`

**Content requirements:**
- **`kafka`:**
  - `languages: []`;
  - detect contains `["spring-kafka","kafka-clients","kafkajs","segmentio/kafka-go","confluent-kafka-go"]` on files `["pom.xml","build.gradle","build.gradle.kts","package.json","go.mod"]`;
  - rules: port `SDLC/bin/cli.js:3943-3962`.
- **`rabbitmq`:**
  - detect contains `["spring-boot-starter-amqp","amqplib","amqp091-go"]` on the same files;
  - rules: port `3963-3983`.
- **`camel`:**
  - `languages: ["java"]`;
  - detect contains `["camel-"]` on JVM build files;
  - rules (new, verify via Context7 `apache camel`): routes as code, error handler/redelivery, DLQ, idempotent consumer, throttling, mapping to typed DTOs, testing with `camel-test-junit5`.
- **`observability`:**
  - `languages: []`, detect `[]` (opt-in);
  - rules (new) from spec §5.5: JSON logs to stdout; Promtail/Alloy → **Loki** with low-cardinality labels `service, env, level` and traceId in the line, not as a label; **Grafana** RED dashboards per service and per third-party provider; alerts on error rate, latency, consumer lag and DLQ size; OpenTelemetry traces → Tempo and metrics → Prometheus (marked as defaults);
  - plus the redaction and request-logging gates moved from SDLC `logging`.

- [ ] **Step 1: Write failing tests:**

```js
test('four addons load and validate', ...)
test('camel is not applicable to a non-java stack', ...)  // validateProfile with a fake typescript stack → error
test('observability rules mention Loki, Grafana and low-cardinality labels', ...)
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `node bin/stackcrew.js plugin`, then `npm test`. **Commit** `feat(catalog): Kafka, RabbitMQ, Camel and observability add-ons`.

---

### Task 20: Content: shared skills (pattern guide, messaging choice)

**Files:**
- Create:
  - `catalog/skills/stackcrew-pattern-guide/SKILL.md`
  - `catalog/skills/stackcrew-pattern-guide/patterns/{template-method,factory,adapter,bridge,builder,strategy,singleton,outbox,decorator,chain-of-responsibility,anti-corruption-layer,resilience,repository-unit-of-work}.md`
  - `catalog/skills/stackcrew-pattern-guide/architecture-styles.md`
  - `catalog/skills/stackcrew-messaging-choice/SKILL.md`
- Test: `test/catalog-skills.test.js`

**Content requirements:**
- **`stackcrew-pattern-guide`** (`kind: advisor`):
  - **Description:** "Use when deciding whether a concrete code change needs a design pattern (Template Method, Factory, Adapter, Bridge, Builder, Strategy, Singleton, Outbox, …) or when reviewing a pattern choice; gives signals, when not to use it, and idioms per language."
  - **`SKILL.md`:** a signal → pattern lookup table linking each file, the rule of three, and "prefer the language idiom". Port §13 from `SDLC/bin/cli.js:3469-3476`.
  - **Each `patterns/*.md`:** headings exactly `## Signals`, `## Use when`, `## Do not use when`, `## Idioms` (with `### Java (Spring Boot / Quarkus)`, `### TypeScript (NestJS / Next.js / React / Angular)`, `### Go`), `## Example`, `## AI anti-patterns`. Idioms per the spec §5.3 table, written now for all three languages so Plan 2 does not rework these files.
  - **`architecture-styles.md`:** layered, hexagonal, modular monolith, microservices, CQRS, event-driven, each with signals and when not to use it. Frontend structure: feature folders, container/presentational, state choice.
- **`stackcrew-messaging-choice`** (`kind: advisor`):
  - **Description:** "Use when deciding between in-process events, a lightweight broker (RabbitMQ, Redis, cloud Pub/Sub) and Kafka for a concrete integration or event flow."
  - **Body:** the spec §5.4 decision tree. Camel is JVM-only; for NestJS/Go, use adapter + registry with BullMQ/Watermill. Link the add-on rules.

- [ ] **Step 1: Write failing tests:**

```js
test('pattern guide has 13 pattern files with exact headings incl. Java/TypeScript/Go idioms', ...)
test('architecture styles cover the six styles', ...)
test('advisor descriptions pass lint and contain no banned words', ...)
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `node bin/stackcrew.js plugin`, then `npm test`. **Commit** `feat(catalog): pattern guide and messaging choice skills`.

---

### Task 21: Content: roles, init interview skill, plugin command skills

**Files:**
- Create:
  - `catalog/roles/{tech-lead,developer,tester}.md`
  - `catalog/skills/stackcrew-init/SKILL.md`
  - `catalog/skills/stackcrew-init/references/{stack-selection,profile-schema}.md`
  - `catalog/plugin-commands/{sync,check,add}.md`
- Test: `test/catalog-roles.test.js`

**Content requirements:**
- **Roles** (spec §7.4):
  - `tech-lead`: `model: opus`, `skillKinds: [advisor]`.
  - `developer`: `model: sonnet`, `skillKinds: [task, advisor]`.
  - `tester`: `model: sonnet`, `skillKinds: [testing]`.
  - **Descriptions** start with `Use only when the user or a plan explicitly asks for the stackcrew {{sc:stackName}} …`.
  - **Bodies:** responsibilities. Departures from the profile → ask the user. The tester owns WireMock, Testcontainers and contract tests.
- **`stackcrew-init`** (`kind: command`):
  - **Description:** `Use only when the user explicitly asks to run the stackcrew setup interview or to re-profile this project's architecture decisions.`
  - **Body (spec §6.1):**
    1. Run `{{sc:cli}} detect`.
    2. Interview one question at a time, covering the spec §6.1 list.
    3. Propose stack (if needed), architecture, per-area patterns, messaging, observability and test strategy, with reasons, plus proactive suggestions.
    4. Wait for approval.
    5. If `stackcrew.json` is missing: `{{sc:cli}} init --stack … --addons … --tools …`.
    6. Write `context` and `decisions` into `stackcrew.json` per `references/profile-schema.md`.
    7. Ask about `--wire`, then run `{{sc:cli}} sync`.
    8. Summarize.
  - **Rule:** never start other workflows.
  - **`references/stack-selection.md`:** spec §5.6.
  - **`references/profile-schema.md`:** the `Profile` JSON with an eKYC example decision.
- **Plugin commands:**
  - `sync`: runs `{{sc:cli}} sync $ARGUMENTS`.
  - `check`: runs `{{sc:cli}} check $ARGUMENTS`.
  - `add`: runs `{{sc:cli}} add $ARGUMENTS`.

  Each description starts with `Use only when the user runs /stackcrew:<name>`.

- [ ] **Step 1: Write failing tests:**

```js
test('three roles with models and skill kinds', ...)
test('init skill is a command skill using {{sc:cli}} and references both files', ...)
test('real catalog validates clean (full)', ...)   // validateCatalog(loadCatalog()) === []
test('real catalog renders for spring-boot without unknown placeholders', ...)
```

- [ ] **Step 2:** → FAIL. **Step 3:** Write the content. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `node bin/stackcrew.js plugin`, then `npm test`. **Commit** `feat(catalog): roles, init interview and plugin commands`.

---

### Task 22: End-to-end on the real catalog, fixture, README, manual checklist

**Files:**
- Create:
  - `fixtures/spring-boot-minimal/pom.xml` (Spring Boot 3.x parent, `spring-boot-starter-web`, `spring-boot-starter-test`)
  - `fixtures/spring-boot-minimal/src/main/java/com/example/kyc/KycApplication.java` (`@SpringBootApplication`)
  - `fixtures/spring-boot-minimal/src/main/java/com/example/kyc/service/BadService.java` (a `Map<String, Object>` field: the seeded violation)
  - `docs/manual-checklist.md`
- Modify: `README.md` (full Vietnamese guide)
- Test: `test/e2e.test.js`

**Interfaces:**
- Consumes: the CLI (spawned) and the real catalog.

- [ ] **Step 1: Write failing tests.** Each copies the fixture to a temp dir and runs `git init`:

```js
test('init all tools renders the expected spring-boot file set', ...)   // node bin/stackcrew.js init --stack spring-boot --addons kafka,camel,observability --tools claude,cursor,codex,antigravity
  // expect paths: .claude/rules/stackcrew/core.md, .claude/rules/stackcrew/stack-spring-boot.md, .cursor/rules/stackcrew/stack-spring-boot.mdc,
  // .agents/rules/stackcrew-stack-spring-boot.md, .agents/skills/stackcrew-spring-boot-rules/SKILL.md,
  // .claude/skills/stackcrew-spring-integration-provider/SKILL.md, .agents/skills/stackcrew-spring-integration-provider/SKILL.md,
  // .claude/agents/stackcrew-spring-boot-developer.md, .codex/agents/stackcrew-spring-boot-developer.toml, .agents/agents/stackcrew-spring-boot-developer.md,
  // docs/stackcrew/architecture-profile.md, .stackcrew/guard.json, .stackcrew/lint/checkstyle.xml, .stackcrew/ci/Jenkinsfile.stackcrew.groovy
  // stdout includes 'cursor-duplicate-skills'; no path under docs/sdlc/
test('budgets hold on the real render', ...)            // AGENTS.md block ≤ 12000, every .mdc ≤ 500 lines, every .agents/rules file ≤ 24000
test('existing SDLC CLAUDE.md and AGENTS.md survive byte-for-byte', ...) // pre-seed '## SDLC Workflow\r\n...' → prefix unchanged after init and after a second sync
test('check flags the seeded violation', ...)           // commit fixture on main, branch adds BadService2 with JsonNode → check --base main exits 1
test('hook blocks writing BadService content', ...)     // runHook with Write of BadService.java content → exit 2
test('sync is idempotent', ...)                         // second sync: written = 0
```

- [ ] **Step 2:** `node --test test/e2e.test.js` → FAIL until the remaining fixes land, then fix.
- [ ] **Step 3: Manual verification.**
  - **If Maven and network are available:** copy the fixture to a temp dir, run `node <repo>/bin/stackcrew.js init --stack spring-boot --tools claude --wire`, then `mvn -q test`.
  - **Expected:** an ArchUnit failure naming `BadService`.
  - **Record** the result (or "Maven unavailable — deferred to Plan 3") in `docs/manual-checklist.md`.
- [ ] **Step 4: Write `README.md`** (Vietnamese): purpose and non-goals, install (npm + plugin marketplace), `init`/`sync`/`add`/`check`, Jenkins snippet, guard hook and allow marker, custom rules in `.stackcrew/custom/`, using it with superpowers, limitations (Cursor duplicate skills, L2 only on Claude Code).
- [ ] **Step 5: Write `docs/manual-checklist.md`** for Plan 3. Smoke steps per tool:
  - **Cursor:** rules attach on `*.java`; skills listed once, or the known duplicate warning.
  - **Codex:** `AGENTS.md` essentials applied; the `stackcrew-spring-boot-rules` skill gets invoked.
  - **Antigravity:** glob rules actually load (a bad trigger is dropped silently); skills visible.
  - **Claude Code:** rules load in a superpowers implementer subagent; the guard blocks; `/stackcrew:init` runs the interview.
  - **Cursor and Claude together:** Cursor lists the stackcrew agents from `.claude/agents` and accepts their `model` field (spec §9.2 b).
  - **Codex and Antigravity:** both ignore any unknown SKILL.md keys (spec §9.2 c).
- [ ] **Step 6:** `node bin/stackcrew.js plugin`, then `npm test` → all PASS.
- [ ] **Step 7: Commit** `test: end-to-end spring-boot render, fixture and docs`.

---

## Self-review notes

- **Spec coverage:**
  - §4.1 L1/L2/L3 → Tasks 7–11 / 13 / 14–15.
  - §5.1 SC rules → 17–18.
  - §5.2 port → 17–19.
  - §5.3 patterns → 20.
  - §5.4 messaging → 19–20.
  - §5.5 observability → 19.
  - §5.6 stack selection → 21.
  - §6 init → 12 + 21.
  - §6.3 brownfield → 6 (manifest), 14 (diff-only), 15 (no build edits without `--wire`).
  - §7.2 pre-flight → 17.
  - §7.3 descriptions → 3.
  - §7.4 roles → 5 + 21.
  - §8.1 hook → 13 + 16.
  - §8.2/8.3 lint/CI/wire → 11, 15, 18.
  - §9 packaging → 5, 7–11.
  - §10 extensibility → catalog layout (3) + custom rules (5).
  - §12 coexistence → 6.
  - §13 → 22 here; the rest in Plan 3.
- **Deferred to Plan 2:** the other six stacks, TypeScript/Go language rules and guards, ESLint major detection.
- **Deferred to Plan 3:** golden tasks on 4 tools, the superpowers interplay check, publishing.
