---
name: stackcrew-init
description: Use only when the user explicitly asks to run the stackcrew setup interview or to re-profile this project's architecture decisions.
kind: command
---
# stackcrew setup interview

Interview the user about the project, propose an architecture with reasons, and record what they approve in `stackcrew.json`. This skill only interviews, proposes and records. It never writes application code and never starts another workflow or skill.

## 1. Detect
Run `{{sc:cli}} detect` from the project root. It prints the detected stack, candidates, add-ons, mode (greenfield or brownfield) and Java base package. Read `stackcrew.json` if it exists.

- `stackcrew.json` missing: this is the first setup. Follow every step below.
- `stackcrew.json` present: this is a re-profile. Follow the "Re-profile" section instead.
- Brownfield (existing code): rules apply to new and changed code only. Do not propose rewrites of existing code; propose what new code should follow.

## 2. Interview
Ask ONE question per message and wait for the answer. Skip any question already answered by the detect output or by `context` in `stackcrew.json`. Offer short example answers to make replying easy. Cover these topics:

1. **Domain**: the problem the system solves, and its domain.
2. **Integrations**: how many third-party or internal systems it talks to, and what kind (REST, SOAP, callbacks or webhooks, files, queues).
3. **Scale**: users and peak transactions per second.
4. **Timeline**: when the first release is due.
5. **Stability**: how stable the requirements are and how costly an outage or a wrong result is.
6. **Extensibility**: what is expected to grow, for example how many more providers or channels will be added.
7. **Team skills**: languages and frameworks the team knows well.
8. **Stack**: already chosen, or needs a recommendation (see `references/stack-selection.md`). Only ask when detect found no stack. Run `{{sc:cli}} list` to get the stacks stackcrew supports; recommend only from that list. If the user needs an unsupported stack, say plainly that stackcrew cannot be set up for it yet, and let them pick a supported stack or stop.
9. **AI tools**: which of Claude Code, Cursor, Codex, Antigravity the team uses.
10. **Project conventions**: ask only for a stack whose category (from `{{sc:cli}} list`) is `backend` or `fullstack`. Cover the items below, one question per item, and offer the default as the example answer. Pre-fill each answer from the code when you can, then confirm it with the user.
    - **Internal shared libraries** (`sharedLibraries`): internal packages or modules the project must reuse instead of re-implementing (an auth client, a logging helper, a common DTO package). Give the package or module names. None is a fine answer.
    - **Base entity classes** (`baseEntity`, `baseTenantEntity`): the names of the abstract classes entities extend, with and without a tenant column. Hint: search the source for an existing `BaseEntity` (or similarly named) class and confirm its name; do not invent one.
    - **Tenant claim** (`tenantClaim`): the name of the token claim or session field that carries the tenant id (default `tenant_id`). Skip this item and `crossTenantRoles` when the system is not multi-tenant.
    - **Roles claim** (`rolesClaim`): where the user's roles come from (default `roles`). Still ask it when the system is not multi-tenant: roles also drive authorization and role binding.
    - **Cross-tenant roles** (`crossTenantRoles`): the roles allowed to read across tenants (default `["super_admin"]`). An empty list disables cross-tenant access. Skip it when the system is not multi-tenant.
    - **Shared components directory** (`sharedComponents`), only for fullstack and frontend stacks: the folder of shared UI components that pages must reuse. Hint: when `components.json` (shadcn) exists, read `aliases.ui` from it and resolve that alias through the `paths` of `tsconfig.json` to the folder on disk (for example `@/components/ui` with `"@/*": ["./src/*"]` is `src/components/ui`). Record the filesystem path, relative to the project root and with `/` separators, not the alias.

    Other keys (`tenantColumn`, `systemUser`, `typeFreeFiles`) keep their defaults unless the user raises them. Allowed characters and the default of every key are in `references/profile-schema.md`.

Stop interviewing when you can justify every proposal below. Do not ask more than needed.

## 3. Propose
Present one proposal with reasons, each tied to an interview answer. Keep it short. Read `references/stack-selection.md` for the stack. Read the files of the `stackcrew-pattern-guide` skill (`architecture-styles.md`, `patterns/*`) and of the `stackcrew-messaging-choice` skill as reference material for architecture, patterns and messaging; do not start those skills. If those files are not in the project yet (on the first run only the init skill is installed), read them from the plugin bundle if available (`${CLAUDE_PLUGIN_ROOT}/cli/catalog/skills/...`), or run the interview with the general guidance and re-check after the first sync. Cover:

- **Stack** (only if not decided) and **add-ons** (`kafka`, `rabbitmq`, `camel`, `observability`).
- **Architecture style**: the simplest one that fits scale, timeline, stability and extensibility.
- **Patterns per area**, named with the signal. For example, provider integration: Adapter behind a port, Anti-Corruption Layer mapper, registry or factory to select the provider, Template Method for the shared call flow, resilience (timeout, retry, circuit breaker). Template Method timing (provider playbook step 0): the shared base and the registry arrive at the second provider, or at the first provider when more are expected. Ask how many providers are expected and record it in `context` as `expectedProviders`.
- **Messaging**: in-process events, a lightweight broker or Kafka, with the deciding reason. If it needs a new broker or integration framework, state that it is new infrastructure.
- **Observability**: structured JSON logs, trace and request ids in the log line, RED dashboards per service and per provider.
- **Test strategy**: unit tests, integration tests with Testcontainers, WireMock contract tests per provider, end-to-end tests for web stacks.
- **Suggestions the user did not ask for**, for example idempotency keys for provider callbacks, WireMock contract tests, outbox when writing the database and publishing an event together.

For each area with a real choice, list 2-3 options and the ones you reject, so the rejected alternatives can be recorded.

## 4. Wait for approval
Do not write anything until the user approves or edits the proposal. If they change something, update the proposal and confirm the final version in one short message.

## 5. Create the profile if missing
If `stackcrew.json` does not exist, run:

```
{{sc:cli}} init --stack <stack-id> --addons <a,b> --tools <claude,cursor,codex,antigravity>
```

Always pass the approved add-ons explicitly: omitting `--addons` means "use the detected add-ons", not "none". If the approved list is empty, run `init` without `--addons`, then set `"addons": []` in `stackcrew.json` before the sync step (this avoids shell-quoting problems with an empty value). `init` prints a `next:` hint; ignore it, you are already in the interview.

## 6. Record context and decisions
Edit `stackcrew.json`, preserving every other field. Set `context` (string values keyed by the interview topics, plus `expectedProviders` when providers are involved) and append one entry to `decisions[]` per approved choice, with `id` (D-001, D-002, ...), `area`, `decision`, `rationale` and `rejected[]`. The exact shape and a full example are in `references/profile-schema.md`. Do not edit the generated files under `docs/stackcrew/`; `sync` rewrites them from `stackcrew.json`.

Record the approved answers of topic 10 in a `conventions` object in `stackcrew.json`. Include only the keys whose approved value differs from the default; omit the rest, and omit `conventions` entirely when every key is at its default. `sharedLibraries`, `crossTenantRoles` and `typeFreeFiles` are arrays of strings; the others are strings. If `sync` rejects a value, it names the key: fix that key and sync again.

For a Java stack, ask the user for the base package (or confirm the detected one from `{{sc:cli}} detect`) and record it in `java.basePackage`. It must be a valid Java package such as `com.acme.kyc`.

## 7. Wire and sync
`--wire` edits project files, so offer it only when the project has what it edits. Describe the edit in one line, then use `--wire` only on a clear yes.
- Java stack: needs a non-empty `java.basePackage` and an existing `pom.xml` or `build.gradle(.kts)`. It adds ArchUnit (test scope) to the build file and generates the architecture test.
- TypeScript stack (NestJS, Next.js): needs an existing `package.json`. It adds the stackcrew rules to the ESLint config: it edits `eslint.config.js|mjs|ts|mts` (ESLint 9 and later), or `.eslintrc.json` or the `eslintConfig` key of `package.json` (ESLint 8). When the project has no ESLint at all, it creates `eslint.config.mjs` and adds `eslint`, `@eslint/js` and `typescript-eslint` to `devDependencies`; tell the user to run their package manager's install afterwards.
- No build file or `package.json` yet (new repo): do not offer it now. Tell the user to run `/stackcrew:sync --wire` (or `{{sc:cli}} sync --wire`) after the file is created.

Then run:

```
{{sc:cli}} sync
```

Add `--wire` if approved. If sync exits 1 with `--wire`, show the user the message and the snippet it printed (a dependency snippet for Java, an ESLint config snippet for TypeScript); do not retry blindly. A config shape it cannot edit is left untouched, and the user pastes the snippet by hand. If sync reports a skipped hand-edited file, tell the user and do not use `--force` unless they ask.

## 8. Summarize
Tell the user, briefly:
- which files were written (`stackcrew.json`, rules, skills, agents, `docs/stackcrew/architecture-profile.md`);
- the decisions recorded, one line each, and the `conventions` recorded (or that every convention kept its default);
- how to change things later. In Claude Code: edit `stackcrew.json` and run `/stackcrew:sync`, add an add-on with `/stackcrew:add <addon>`, check changed lines with `/stackcrew:check`. In Cursor, Codex or Antigravity, which have no slash commands: `stackcrew sync|add|check` (the README explains how to run the CLI). Never print the path of the plugin cache as something for the user to remember.

## Re-profile
When `stackcrew.json` already exists, update only `context` and `decisions` (add, amend or supersede entries; keep the ids of existing decisions stable). `conventions` may also be updated when the user asks (add, change or remove a key; a removed key falls back to its default). Do not change `stack`, `addons`, `tools`, `mode` or `java` unless the user explicitly asks. Never edit `node` by hand: `{{sc:cli}} sync --wire` sets `node.wired`. Never edit `addons` by hand here: when a decision implies a new add-on, run `{{sc:cli}} add <addon>` after the user approves. Interview only about what changed, propose, wait for approval, record, then run `{{sc:cli}} sync`.

## Rules
- One question per message during the interview.
- Never write code, and never start another workflow or skill.
- Never record a decision the user did not approve.
- A new broker, integration framework or datastore is new infrastructure: present 2-3 options and let the user decide.
