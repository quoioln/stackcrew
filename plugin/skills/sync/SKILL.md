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
- `--wire`: also wire the stack's integration. Java: the ArchUnit test and the build-file changes (`pom.xml` or `build.gradle(.kts)`). TypeScript (NestJS, Next.js): the stackcrew rules in the ESLint config (`eslint.config.*` for ESLint 9 and later; `.eslintrc.json` or the `eslintConfig` key of `package.json` for ESLint 8), creating `eslint.config.mjs` and adding the ESLint devDependencies in `package.json` when the project has no ESLint. Without it, build and lint config files are never edited.
- `--dry-run`: print what would change and write nothing.

Exit codes: 0 means done (or nothing to change). 1 means it did not finish: a hand-edited file was skipped, `stackcrew.json` is missing or invalid, or an error was printed. With `--wire`, exit 1 also means: the stack is neither Java nor TypeScript; for Java, `java.basePackage` is empty in `stackcrew.json`, or there is no build file (`pom.xml`, `build.gradle(.kts)`) or it has no dependencies section, in which case a dependency snippet is printed; for TypeScript, `package.json` is missing or invalid, or the ESLint config has a shape that cannot be edited automatically (for example `eslint.config.cjs`, two `export default` lines, a YAML or JSONC legacy config), in which case an ESLint config snippet is printed and no file is changed. After a TypeScript wire that added dependencies, tell the user to run their package manager's install. Show that message and snippet to the user; do not retry blindly. Read the output, tell the user what it says, and stop; do not retry with `--force` unless the user asks.
