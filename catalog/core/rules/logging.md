---
id: core-logging
title: Logging and observability
---
# Logging and observability

## Essentials

- Emit one structured event per line: a stable message plus key/value fields, never data interpolated into the message.
- Use text format locally and JSON in staging and prod, switched by config or env, never by editing call sites.
- Use levels correctly: ERROR actionable failure, WARN recoverable or degraded, INFO lifecycle and business events, DEBUG diagnostics (off in prod), TRACE verbose.
- Put requestId, traceId, spanId, correlationId, userId and username (when authenticated) on every line, set at request entry and cleared at exit.
- Forward W3C Trace Context (`traceparent`, `tracestate`) and the correlationId on every outbound HTTP and message call.
- Redact secrets, tokens, `Authorization` headers, cookies and PII in the logging layer, deeply and by default.
- Log one line per request from a single middleware: method, templated route, status, duration in ms, ids and outcome.
- Never enable full SQL or bound-parameter logging in prod; rely on slow-query logs and metrics.
- Write logs to stdout and let the platform ship them.
- Treat "no PII or secret in logs" as a release gate.

## Format and levels

- Timestamps are UTC ISO-8601. Every line carries service name, environment and version or commit.
- Level is configurable per logger or package at runtime.

## Context propagation

- Use MDC (Logback), AsyncLocalStorage (Node) or context vars so ids survive async boundaries.
- Inbound middleware reads trace headers or generates new ids, stitching logs across services into one trace.

## Deep redaction

- Deny by default: passwords, tokens, API keys, `Authorization`, cookies, and PII (email, phone, national id, full card PAN, CVV, health and financial data).
- Redact nested objects and arrays recursively, matching key-name patterns and typed annotations. Mask fully (`***`) or partially (card last 4).
- Redact stack traces and request/response bodies too. Do not log full bodies; allowlist safe fields and log ids or sizes.
- Strip or escape CR/LF in user-supplied values to prevent log injection.
- Align redaction with the project's data classification (GDPR, PCI).

## Request and response logging

- Use the templated route (not the raw path with ids) to avoid cardinality blow-up.
- Log completion at INFO (2xx/3xx), WARN (4xx), ERROR (5xx); on failure include exception type and redacted message.
- Skip or sample health checks and other noise. Emit a latency metric and error counter alongside the log.

## ORM and database logging

- Separate channels: migration (INFO), DDL (INFO, non-prod), query (DEBUG, off in prod), bound parameters (DEBUG, redacted), slow query (WARN above 200-500 ms), errors (ERROR with SQL and sanitized params).

## HTTP client and service-to-service logging

- Log each outbound call: target service, method, sanitized URL (no secrets or PII in the query string), status, duration, retry count, traceId.
- On failure log status and a sanitized response body, correlated with timeout and circuit-breaker state. Never log full bearer tokens.

## Operability gates

- Logs, traces and metrics correlate by traceId; prefer OpenTelemetry as the common signal.
- Define retention and sampling: sample high-volume DEBUG, always keep ERROR.
