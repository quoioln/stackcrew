---
id: core-error-handling
title: Error handling
---
# Error handling

## Essentials

- Never swallow an error (empty catch); log it with context or rethrow, and never lose the original cause.
- Classify errors: expected business errors map to 4xx with no stack trace (WARN or INFO), unexpected errors map to 5xx with the full stack (ERROR).
- Return one error envelope for both classes (4xx and 5xx): `message` is a constant summary per `errorCode`, `error.errorNumber` (`SSCCNNN`: service, category, sequence) names the origin service, and `errorCode` is the frontend's translation key.
- Every response carries `supportCode` and `requestId`, repeated in the `x-support-code` and `x-request-id` headers.
- Validate input at the API boundary and fail fast with a clear message.
- Make critical write operations idempotent wherever a retry is possible.

## Detail

- Wrap with cause: a rethrown error keeps the original as its cause.
- Do not leak internals (stack traces, SQL, hostnames) in responses; log them instead.
- Error responses carry a stable `errorCode` plus the constant summary `message`, and the `requestId`; the `supportCode` lets a user quote one error to support.
