---
id: core-type-safety
title: Type safety and static analysis
---
# Type safety and static analysis

Types are the cheapest tests. Keep them strict and keep untyped data at the edge.

## Essentials

- Enable the strictest compiler, type-checker and linter settings the language offers, and keep them at zero warnings.
- Never use an escape hatch (`any`, `@ts-ignore`, unchecked casts, `@SuppressWarnings`) without an inline justification and an issue id.
- Model every payload as a named type; see SC-TYPE.
- Validate untrusted input at the boundary and convert it to typed data once.
- Run static analysis (SAST such as Semgrep or SonarQube) in CI and block on any High finding.

## Detail

- Strict mode maxed out: TypeScript `strict`, mypy `--strict`, Java `-Xlint:all -Werror`, and the equivalent elsewhere.
- Suppressions are rare, local and traceable: justification plus issue id on the same line.
- A suppression that no longer applies is removed.
