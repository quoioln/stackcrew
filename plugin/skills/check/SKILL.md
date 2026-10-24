---
name: check
description: "Use only when the user runs /stackcrew:check to scan the changed lines of this project for violations of the stackcrew guard rules."
disable-model-invocation: true
---
# stackcrew check

Run this from the project root:

```
node "${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js" check $ARGUMENTS
```

`check` scans only the lines added in the diff against the guard rules in `.stackcrew/guard.json`. Existing code is not reported.

Flags (all optional):
- `--base <ref>`: compare against this git ref (for example `origin/main`). Without it, the working tree is compared with HEAD, untracked files included.
- `--staged`: scan only what is staged for commit.

Exit codes:
- 0: clean, no violations.
- 1: violations found. Each one prints the file, line, rule id and message. Report them to the user; fix them only if the user asks.
- 2: the check could not run (not a git repository, missing base ref, or not initialized because `.stackcrew/guard.json` is missing). This is not a pass. Tell the user the message that was printed.
