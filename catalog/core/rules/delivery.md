---
id: core-delivery
title: Delivery, dependencies and documentation
---
# Delivery, dependencies and documentation

## Essentials

- Meet the Definition of Done before opening a PR: tests pass with every branch of changed code covered; lint, formatter and type-check at zero warnings.
- Leave no `TODO`/`FIXME`, dead code, commented-out blocks or debug prints behind.
- Self-review your diff before requesting review.
- Use Conventional Commits and atomic commits; keep a PR to roughly 400 lines of diff or fewer.
- Map each PR to one issue or story, and never mix refactor and feature in one PR.
- Do not merge while CI is red; squash to keep history clean.
- Pin dependency versions and commit the lockfile; dependency audit blocks High and Critical findings.
- Do not add a dependency for something small you can write, and remove unused ones.
- Document public functions and classes (purpose, params, return, throws), and update the README and decision records when behavior or technical direction changes.

## Definition of Done

- [ ] Tests pass locally; branch coverage on changed code.
- [ ] Lint, formatter and type-check show 0 warnings.
- [ ] No leftover TODO, dead code or debug output.
- [ ] Public API and technical-decision changes reflected in docs or a decision record.
- [ ] Author has self-reviewed the diff.

## Documentation

- The README and setup steps must work from scratch.
