---
id: core-error-handling
title: Error handling
---
# Error handling

## Essentials

- Never swallow an error (empty catch); log it with context or rethrow, and never lose the original cause.
- Classify errors: expected business errors map to 4xx with no stack trace (WARN or INFO), unexpected errors map to 5xx with the full stack (ERROR).
- Return one consistent error response shape (problem+json) for both classes.
- Validate input at the API boundary and fail fast with a clear message.
- Make critical write operations idempotent wherever a retry is possible.

## Detail

- Wrap with cause: a rethrown error keeps the original as its cause.
- Do not leak internals (stack traces, SQL, hostnames) in responses; log them instead.
- Error responses carry a stable machine-readable code plus a human message, and the request or trace id.
