---
name: sync
description: "Use only when the user runs /stackcrew:sync to regenerate this project's stackcrew rules, skills, agents and lint files from stackcrew.json."
disable-model-invocation: true
---
# stackcrew sync

Run this from the project root:

```
node "${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js" sync $ARGUMENTS
```

`sync` re-renders everything stackcrew owns from `stackcrew.json`. It never touches text outside the stackcrew marked blocks in `CLAUDE.md` and `AGENTS.md`.

Flags (all optional):
- `--force`: overwrite owned files that were edited by hand. Without it, hand-edited files are left intact and reported.
- `--wire`: also wire the stack's integration. Java: the ArchUnit test and the build-file changes (`pom.xml` or `build.gradle(.kts)`). TypeScript (NestJS, Next.js): the stackcrew rules in the ESLint config (`eslint.config.js|mjs|ts|mts` for ESLint 9 and later; `.eslintrc.json` or the `eslintConfig` key of `package.json` for ESLint 8), creating `eslint.config.mjs` and adding the ESLint devDependencies in `package.json` when the project has no ESLint. Without it, build and lint config files are never edited.
- `--dry-run`: print what would change and write nothing.

Exit codes: 0 means done (or nothing to change). 1 means it did not finish: a hand-edited file was skipped, `stackcrew.json` is missing or invalid, or an error was printed.

With `--wire`, exit 1 also means the integration could not be wired:
- The stack is neither Java nor TypeScript.
- Java: `java.basePackage` is empty in `stackcrew.json`, or there is no build file (`pom.xml`, `build.gradle(.kts)`), or it has no dependencies section. A dependency snippet is printed.
- TypeScript: `package.json` is missing or invalid.
- TypeScript: an ESLint config exists but `package.json` has no `eslint` dependency.
- TypeScript: the `eslint` version is older than 8 or cannot be read.
- TypeScript: ESLint 9 or later with only a legacy `.eslintrc*` file (ESLint 9 reads flat config only).
- TypeScript: ESLint 8 with no ESLint config (no `.eslintrc*` file and no `eslintConfig` key in `package.json`).
- TypeScript: the ESLint config has a shape that cannot be edited automatically (for example `eslint.config.cjs`, two `export default` lines, a YAML or JSONC legacy config).

For TypeScript, an ESLint config snippet is printed in every one of these cases. In those cases `package.json` and the ESLint config files are left untouched and `node.wired` stays false; the rest of `sync` still writes its owned files (rules, skills, agents and the lint files under `.stackcrew/`).

After a TypeScript wire that added dependencies, tell the user to run their package manager's install. A wire that created or wrapped an ESLint 9 config may also print a note that the packages it needs (`@eslint/js`, `typescript-eslint`) are not declared in `package.json`; the wire still succeeded, so relay the note. Show the message and snippet to the user; do not retry blindly. Read the output, tell the user what it says, and stop; do not retry with `--force` unless the user asks.
