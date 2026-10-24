---
name: init
description: "Use only when the user explicitly asks to run the stackcrew setup interview or to re-profile this project's architecture decisions."
disable-model-invocation: true
---
# stackcrew setup interview

Interview the user about the project, propose an architecture with reasons, and record what they approve in `stackcrew.json`. This skill only interviews, proposes and records. It never writes application code and never starts another workflow or skill.

## 1. Detect
Run `node "${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js" detect` from the project root. It prints the detected stack, candidates, add-ons, mode (greenfield or brownfield) and Java base package. Read `stackcrew.json` if it exists.

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
8. **Stack**: already chosen, or needs a recommendation (see `references/stack-selection.md`). Only ask when detect found no stack.
9. **AI tools**: which of Claude Code, Cursor, Codex, Antigravity the team uses.

Stop interviewing when you can justify every proposal below. Do not ask more than needed.

## 3. Propose
Present one proposal with reasons, each tied to an interview answer. Keep it short. Use `references/stack-selection.md` for the stack, `architecture-styles.md` and `patterns/*` in the `stackcrew-pattern-guide` skill for architecture and patterns, and the `stackcrew-messaging-choice` skill for messaging. Cover:

- **Stack** (only if not decided) and **add-ons** (`kafka`, `rabbitmq`, `camel`, `observability`).
- **Architecture style**: the simplest one that fits scale, timeline, stability and extensibility.
- **Patterns per area**, named with the signal. For example, provider integration: Adapter behind a port, Anti-Corruption Layer mapper, registry or factory to select the provider, Template Method for the shared call flow, resilience (timeout, retry, circuit breaker). Decide the Template Method timing as the provider playbook says in its step 0.
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
node "${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js" init --stack <stack-id> --addons <a,b> --tools <claude,cursor,codex,antigravity>
```

Use the approved stack id, add-on ids and tools. Omit `--addons` when none. This writes `stackcrew.json` and renders the files.

## 6. Record context and decisions
Edit `stackcrew.json`, preserving every other field. Set `context` (string values keyed by the interview topics) and append one entry to `decisions[]` per approved choice, with `id` (D-001, D-002, ...), `area`, `decision`, `rationale` and `rejected[]`. The exact shape and a full example are in `references/profile-schema.md`. Do not edit the generated files under `docs/stackcrew/`; `sync` rewrites them from `stackcrew.json`.

## 7. Wire and sync
For a Java stack, ask the user whether to wire ArchUnit into the build (`--wire`). Wiring edits `pom.xml` or `build.gradle(.kts)`, so run with `--wire` only on a clear yes. Then run:

```
node "${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js" sync
```

Add `--wire` to the command if the user approved it. If sync reports a skipped hand-edited file, tell the user and do not use `--force` unless they ask.

## 8. Summarize
Tell the user, briefly:
- which files were written (`stackcrew.json`, rules, skills, agents, `docs/stackcrew/architecture-profile.md`);
- the decisions recorded, one line each;
- how to change things later: edit `stackcrew.json` and run `node "${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js" sync`, add an add-on with `node "${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js" add <addon>`, check changed lines with `node "${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js" check`.

## Re-profile
When `stackcrew.json` already exists, update only `context` and `decisions` (add, amend or supersede entries; keep the ids of existing decisions stable). Do not change `stack`, `addons`, `tools`, `mode` or `java` unless the user explicitly asks. Interview only about what changed, propose, wait for approval, record, then run `node "${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js" sync`.

## Rules
- One question per message during the interview.
- Never write code, and never start another workflow or skill.
- Never record a decision the user did not approve.
- A new broker, integration framework or datastore is new infrastructure: present 2-3 options and let the user decide.
