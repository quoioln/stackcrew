# stackcrew rules

Coding standards for this project. Rule ids (SC-*) are cited by hooks, lint and review.

## Project profile
Before any non-trivial change, read `docs/stackcrew/architecture-profile.md` and `stackcrew.json`. They record the chosen stack, addons, mode (greenfield or brownfield) and the decisions already made. Follow them. If code and profile disagree, say so instead of silently picking one.

## SC-PREFLIGHT
The note is required when the change touches more than one function, adds or changes a type, DTO or constant, adds I/O or an integration, or adds a dependency. Write it in your reply, BEFORE the first file edit (3-8 lines):
1. Affected area and modules, checked against the profile.
2. Reuse: existing helpers, constants, DTOs. Search the codebase first, then list what you found.
3. Create: new types, DTOs, constants, shared functions.
4. Pattern: the one you will use and why (signals from `stackcrew-pattern-guide`), or "no pattern needed" and why.
5. Suggestions: anything the change should also have (for example a timeout, retry, or idempotency on a provider call).

Then continue to code without waiting, except at the Decision gate.
- Do: write the note first, keep it short.
- Don't: write code before the note.
- Exception: a one-line change with no new logic.

## SC-TYPE
- Do: model data with a named type (class, record, DTO, struct, interface) and validate at the boundary (schema, bean validation, struct tags).
- Don't: let untyped values escape or serve as DTOs: `any`/`unknown` leaking past the boundary (TS); `JsonNode`, `ObjectNode`, `Map<String, Object>`, `Map<?, ?>`, `Object` (Java); `interface{}`/`any`, `map[string]interface{}` (Go).
- Exception: (a) the point where a truly dynamic payload is first deserialized (map it to a typed model at once); (b) a framework-required signature (e.g. Kafka client config `Map<String, Object>`, `Jwt.getClaims()`). Mark either with `stackcrew-allow: SC-TYPE <reason>` on the same line.

## SC-CONST
- Do: put literals in a named constant, enum or config. Search for an existing constant before creating one. Group constants by domain.
- Don't: use magic strings or magic numbers (status codes, header names, keys, timeouts, limits, roles).
- Exception: obvious 0 and 1, and message text inside tests.

## SC-REUSE
- Do: search for an existing common function or util first. Extract repeated logic, or logic that is its own concern, into a shared function or service, one abstraction level per function.
- Don't: duplicate logic inline, or bury a separate concern inside its caller.
- Exception: none.

## SC-PATTERN
- Do: choose a pattern only when a real signal calls for it, and use one when the signal is clear. See the skill `stackcrew-pattern-guide` and the profile.
- Don't: add a pattern with no signal (speculative abstraction), or leave out an obvious one (a growing if/else on a type, copy-pasted flows).
- Exception: none. State "no pattern needed" in the note when that is the answer.

## Decision gate
Stop and ask the user before the following, presenting 2-3 options with trade-offs:
- adding new infrastructure (a message broker, integration framework, new datastore);
- using a pattern or architecture that departs from the profile;
- adding a large dependency.

After the user decides, record it as a new entry in `stackcrew.json` `decisions[]` with `id`, `area`, `decision`, `rationale` and `rejected[]` (alternatives not chosen).

## Exceptions
To waive a rule at one spot, add a comment on the same line: `stackcrew-allow: <rule-id> <reason>`. The reason is required; a marker without one does not count. Keep exceptions rare and local.
