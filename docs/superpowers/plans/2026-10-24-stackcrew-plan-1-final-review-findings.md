# Final whole-branch review: one fix wave

Source: the opus final review of `c1cfc93..1b57e41`. Verdict: "With fixes". No Critical issues.

Every item needs a regression test unless marked docs-only.

Reproduction files from the reviewer, in the scratchpad (copy anything you need into proper tests; don't depend on these paths):
- `exp1`–`exp4`
- `crlf5.mjs`

Scratchpad: `C:\Users\quoi.vo\AppData\Local\Temp\claude\C--Working-Projects-SDLC-SourceCode-SDLC\868f2ee8-8b6e-4400-ac65-3b1c54234f7d\scratchpad\`

## Important (all must be fixed)

### I1. `sync --wire` writes before render/apply can fail
- **Where:** `src/commands/run-sync.js` ~36-57.
- **What happens:** wiring edits and `writeProfile` (`wired: true`) run BEFORE `renderProject`/`applyOps`. Seen in exp1: with a half-marker `AGENTS.md`, sync exits 1 and prints "nothing was written", yet `pom.xml` got the ArchUnit block and `stackcrew.json` flipped to `wired: true`. That breaks Review Focus 4.
- **Fix:**
  1. Build the would-be wired profile in memory.
  2. Run `buildContext` → `renderProject` → `applyOps(..., { dryRun: true })` first. The dry run already runs the path/MARKER validation phase, so BUDGET, TEMPLATE, RENDER and MARKER errors surface before anything is written.
  3. Only then write the build-file edits and the profile, then call the real `applyOps`.
- **Test:** `sync --wire` with a half-marker `AGENTS.md` on a wired-able fixture → exit 1; `pom.xml` byte-unchanged; profile `java.wired` still false.

### I2. `--wire` is a silent no-op on multi-module Maven
- **Where:** `src/wire/java.js` ~50-89, `run-sync.js` ~106-135.
- **What happens:** an aggregator root pom (`<packaging>pom</packaging>` or `<modules>`) gets the dependency and a root `src/test/java` test, which never runs. Sync still reports "wired".
- **Fix:** when the root pom has `<packaging>pom</packaging>` (after masking comments) or a `<modules>` element, `planPom` returns NO edit and a note: "multi-module Maven: wire ArchUnit in the module that holds the application classes (stackcrew wires single-module builds only)". It must not count as carrying ArchUnit. The existing R16 path then exits 1 with the snippet.
- **Docs:** add a README limitation.
- **Tests:** a `planJavaWiring` unit test for a packaging-pom and a modules pom, plus an e2e test (exit 1, pom unchanged, `wired` stays false).

### I3. Cursor sees agents twice when cursor + codex are both selected
- **What happens:** cursor+codex writes `.cursor/agents/*.md` + `.codex/agents/*.toml`; claude+cursor+codex writes `.claude/agents/*.md` + `.codex/agents/*.toml`. Spec §9.1 says Cursor reads all three folders.
- **Fix (cheap and safe for now):**
  - Extend the duplicate warning: when cursor and codex are both selected, emit `cursor-duplicate-agents: Cursor reads .codex/agents as well as .claude/.cursor agents, so stackcrew role agents may appear twice in Cursor.` Put it in `planSkillDirs`, or alongside it, whichever is cleaner; keep `renderProject` warnings flowing.
  - Add a manual-checklist row to confirm whether Cursor actually parses `.codex/agents/*.toml`. Plan 3 decides whether to skip.
  - Do not change which files are written.
- **Test:** the warning appears for cursor+codex and for claude+cursor+codex, and not for other combinations.

### I4. Creating `CLAUDE.md` can silently stop Claude Code from loading an existing `AGENTS.md`
- **Background:** Claude Code v2.1.277+ with the default `claude-md-or-agents-md` setting reads `AGENTS.md` only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists.
- **Fix:** before writing, detect the case where claude is selected, NONE of those three files existed before the run, and `AGENTS.md` exists with content outside the stackcrew block. In that case emit the warning: `claude-md-shadows-agents-md: creating CLAUDE.md makes recent Claude Code versions stop reading your existing AGENTS.md; add "@AGENTS.md" to CLAUDE.md yourself if you want both (stackcrew does not, to avoid loading its own rules twice).`
  - This needs filesystem knowledge, so do it in the command layer (`run-sync`), not in the pure renderer.
  - Do NOT add `@AGENTS.md` automatically.
- **Docs:** add a README note.
- **Tests:**
  - a repo with only an `AGENTS.md` that has team rules → warning present;
  - an SDLC-style repo with `.claude/CLAUDE.md` → no warning;
  - no `AGENTS.md` → no warning.

### I5. The no-plugin Claude Code path is undocumented and the hint is wrong
- **Where:** `src/commands/init.js` ~102-103.
- **What happens:** with tools=claude only, no `stackcrew-init` skill lands in the project, yet `init` prints "run /stackcrew:init".
- **Fix:** reword the hint to `next: with the stackcrew Claude Code plugin installed, run /stackcrew:init for the architecture interview (without the plugin, Claude Code has no interview skill; see README)`.
- **Docs:** add a README paragraph on what you lose without the plugin: the `/stackcrew:*` commands, the init interview and the guard hook (L2). Rules, skills and agents still work.
- **Test:** the CLI output contains the new hint.

### I6. The hook on CRLF files always falls back to the fragment diff
- **Where:** `src/guard/hook.js` ~31-37, 57-63. This also closes ledger minor L114.
- **What happens:** an LF multi-line `old_string` against a CRLF file never matches, so the hook falls back to `~` line numbers and gives false positives. A demonstrated case: a mid-line edit to an import is blocked on CRLF but allowed on LF.
- **Fix:** LF-normalize the current text, `old_string` and `new_string` before `applyEdits`/the full-file diff. `splitLines` already strips `\r`.
- **Tests:**
  - a CRLF current file with an LF `old_string` → exact line numbers (no `~`);
  - the import-edit case is allowed, matching the LF behaviour;
  - a real new violation on CRLF still blocks.

## Cheap user-facing items folded in (controller ruling: correctness or documentation the user will hit)
- **M1.** `catalog/skills/stackcrew-init/SKILL.md` ~33: on the first run, the pattern-guide and messaging-choice files aren't in the project yet. Add one sentence: if they are absent, read them from the plugin bundle (`${CLAUDE_PLUGIN_ROOT}/cli/catalog/skills/...`) or run the interview with the general guidance and re-check after the first sync. Only `{{sc:cli}}`/`{{sc:version}}` placeholders are allowed in command skills. `${CLAUDE_PLUGIN_ROOT}` is not a `{{sc:}}` placeholder, so it's fine. In project-rendered copies it simply won't resolve, so word it as "if available".
- **M2.** `src/cli.js` ~15: the help text says "Add a stack or addon". Change it to "Add add-on(s) to the profile and re-sync".
- **M3.** `src/fs/apply.js` ~117 + `run-sync.js` ~61: "N block(s) updated" counts unchanged blocks. Count only changed blocks. Either report `blocks` only when they changed, or add `blocksUnchanged`; keep the `ApplyReport` shape compatible and update the tests.
- **M5.** `src/profile.js` `validateProfile`: reject duplicate `addons` or `tools` with a field-path error (`addons: duplicate "kafka"`).
- **M9.** README: add a "Commit những gì" section listing `stackcrew.json`, `.stackcrew/` (`guard.json` for Jenkins check, `manifest.json`, `lint/`, `ci/`), the generated rule/skill/agent folders, `docs/stackcrew/`, and `archunit_store/` when wired.
- **M10.** `docs/manual-checklist.md`, add rows for:
  - the claude+cursor+antigravity combination (`.agent/skills` legacy + `.cursor/skills`), §9.2(a);
  - Cursor only (`.cursor/agents`);
  - the no-plugin Claude path (§9.2(d));
  - the CLAUDE.md/AGENTS.md interplay (I4);
  - the Cursor duplicate agents (I3);
  - CRLF Edit behaviour on Windows (I6).
- **M11.** Add a `LICENSE` file (MIT, "Copyright (c) 2026 stackcrew contributors"; the user can change the holder). Add `"license": "MIT"` to the generated `plugin.json` (`src/plugin/build.js`). Leave `author` absent, since the user decides. Make sure `npm pack` still lists only the intended files: npm always includes LICENSE, which is fine.
- **M12.** README Jenkins section: note that the snippet uses `sh` (use `bat` on Windows agents) and defaults to `main` when `CHANGE_TARGET` is unset.
- **M13.** `catalog/core/always-on.md` (Decision gate) and the roles: after recording a decision in `stackcrew.json`, ask the user to re-sync so `docs/stackcrew/architecture-profile.md` is updated. Keep always-on ≤ 6000 bytes.

## Process
1. Use TDD for the code items: RED first, then GREEN.
2. Run `npm test`, then `node bin/stackcrew.js plugin`, then `npm test` again. Everything must pass.
3. Commit in logical commits (e.g. one per Important item plus one for docs and minors). Every message ends with the Co-Authored-By trailer.
4. Write the report to `final-fix-report.md` in this folder. Include the RED/GREEN evidence per item, plus the commands and raw output.
