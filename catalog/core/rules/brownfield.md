---
id: core-brownfield
title: Working in existing code (brownfield)
---
# Working in existing code (brownfield)

## Essentials

- Hold new and changed code to the full bar, and do not block on pre-existing debt.
- Enforce coverage on changed lines (diff coverage), not on the whole legacy repo.
- Ratchet, do not regress: coverage, lint and security findings may only improve; a gate fails on regression, not on legacy debt.
- Apply the Boy Scout rule: leave each touched file a little better, scoped to your change.
- Write characterization tests before refactoring untested legacy code.
- Replace old paths with the strangler-fig approach: wrap, divert incrementally, retire; no big-bang rewrites.
- Do not rewrite working code just to apply a pattern or to chase coverage on untouched legacy.
- Record as-is decisions retroactively so future work has context.
