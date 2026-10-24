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
- `--wire`: also wire the stack's build integration (for Java, the ArchUnit test and the build-file changes). Without it, build files are never edited.
- `--dry-run`: print what would change and write nothing.

Exit codes: 0 means done (or nothing to change). 1 means it did not finish: a hand-edited file was skipped, `stackcrew.json` is missing or invalid, or an error was printed. Read the output, tell the user what it says, and stop; do not retry with `--force` unless the user asks.
