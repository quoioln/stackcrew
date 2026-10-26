---
id: core-logging
title: Logging and observability
---
# Logging and observability

## Essentials

- Bodies are logged only through the one shared masker, never by hand in a service: secret keys are always masked, PII keys come from config (`LOG_MASK_FIELDS` or `app.logging.mask-fields`), keys match by whole word runs with no substring matching, bodies are capped at 16 KB, base64 and binary become size placeholders, non-JSON bodies become a placeholder, and a value that cannot be masked logs `<CT N+ bytes>` when its size is unknown.
- Redact secrets, tokens, `Authorization` headers, cookies and PII in the logging layer, deeply and by default. Log only the headers `content-type`, `content-length` and `user-agent`.
- Log one line per HTTP call, inbound and outbound, from one place each (never from services): method, templated route or sanitized URL, status, `durationMs`, ids, and the request and response bodies after the shared masker.
- Emit one structured event per line: a stable message plus key/value fields, never data interpolated into the message.
- Use text format locally and JSON in staging and prod, switched by config or env, never by editing call sites.
- Use levels correctly: ERROR actionable failure, WARN recoverable or degraded, INFO lifecycle and business events, DEBUG diagnostics (off in prod), TRACE verbose.
- Put requestId, traceId, spanId, correlationId, userId and username (when authenticated) on every line, set at request entry and cleared at exit.
- Forward W3C Trace Context (`traceparent`, `tracestate`) and the correlationId on every outbound HTTP and message call.
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
- Redact nested objects and arrays recursively, matching key names by word run (see the body masker) and typed annotations. Replace every masked value with `"***"`; never partially mask.
- Redact stack traces too. Bodies are logged only through the shared masker (see Request and response logging), never by hand.
- Strip or escape CR/LF in user-supplied values to prevent log injection.
- Align redaction with the project's data classification (GDPR, PCI).

## Request and response logging

One JSON line per call. Fields: `event` (`http_in`, `http_out` or `message_in`), `method`, `route` (inbound, templated) or `url` (outbound, sanitized), `target` (outbound service name), `status`, `durationMs`, `reqBody`, `resBody` (absent when body logging is off), and the context ids `requestId`, `traceId`, `userId`, `tenantId`.

- Log inbound calls in one place (a filter, interceptor or wrapper) and outbound calls in one shared HTTP client or client interceptor. Services, adapters and controllers never log bodies themselves.
- Use the templated route (not the raw path with ids) to avoid cardinality blow-up.
- Log completion at INFO (2xx/3xx), WARN (4xx), ERROR (5xx); on failure include exception type and redacted message. The error path logs through the same writer as the success path.
- Skip health checks, metrics and streaming (SSE) responses. Emit a latency metric and error counter alongside the log.
- Message consumers log a `message_in` line with the payload in `reqBody`, through the same masker.
- Log only the headers `content-type`, `content-length` and `user-agent`. `Authorization` and cookies never appear.

### Body masker

One masker, shared by inbound, outbound and consumers. Behavior (the same in every stack):

- **Keys:** split a key into words on camelCase boundaries, `_`, `-` and spaces, lowercase them, and compare to the list with list entries normalized the same way and joined without a separator (`accessToken` becomes `accesstoken`). A key is masked when any contiguous run of its words, joined, is in the list. So `newPassword`, `customerEmail` and `national_id` are masked, while `shipping`, `company` and `spanId` are not. There is no substring matching.
- **Lists:** the secret list is always masked and cannot be turned off: password, passwd, secret, token, accessToken, refreshToken, idToken, apiKey, clientSecret, privateKey, authorization, cookie, setCookie, otp, pin, cvv, cvc. The PII list is configured (`LOG_MASK_FIELDS`, comma-separated, or `app.logging.mask-fields`) and replaces the default list: email, phone, phoneNumber, mobile, fullName, dob, dateOfBirth, address, nationalId, idNumber, cccd, cmnd, passport, passportNumber, cardNumber, pan, accountNumber. When the setting is unset or empty, the default list is used.
- **Masking:** replace the value of a masked key, of any type, with `"***"`. Recurse into objects and arrays.
- **Base64:** a string longer than 1024 characters that is base64 (optionally a `data:` URI) becomes `<base64 N bytes>` with N the decoded size.
- **Size:** serialize compactly. Above 16 KB (`LOG_MAX_BODY_BYTES` or `app.logging.max-body-bytes`, default 16384) keep the first bytes, cut at a character boundary, and append `...[truncated T bytes]` with T the full size.
- **Content types:** parse and mask `application/json` (and `*+json`) and `application/x-www-form-urlencoded`. `multipart/*`, `application/octet-stream`, `image/*` and `application/pdf` log the placeholder `<binary CT N bytes>`, where CT is the content type and N the size in bytes. Everything else (XML, SOAP, `text/*`, a missing content type, JSON that does not parse) logs only the placeholder `<CT N bytes>` (content type, or `unknown` when missing, and size in bytes); the content is not logged.
- **Nesting:** a body nested deeper than 64 objects or arrays logs only `<CT N bytes>`, or `<CT N+ bytes>` (N = the body cap) when masking failed and the size is unknown (the value cannot be serialized at all: a cycle, a BigInt, a throwing getter, or nesting deep enough to overflow serialization). The masker walks at most 64 levels; it never recurses without a bound, so a crafted body of brackets cannot exhaust the stack.
- **Logging never throws:** if masking or writing a line fails, the one line is still written with size-only bodies, and the request, the outbound call or the message keeps its result. A log line is never the reason a call fails.
- **Switch:** `LOG_BODIES` or `app.logging.log-bodies` (default on). Off drops `reqBody` and `resBody` and keeps the one-line log.
- Strip or escape CR and LF in logged values.

## ORM and database logging

- Separate channels: migration (INFO), DDL (INFO, non-prod), query (DEBUG, off in prod), bound parameters (DEBUG, redacted), slow query (WARN above 200-500 ms), errors (ERROR with SQL and sanitized params).

## HTTP client and service-to-service logging

- Log each outbound call as an `http_out` line, from the one shared client: target service, method, sanitized URL (no secrets or PII in the query string), status, duration, retry count, traceId, and the bodies through the shared masker.
- On failure log status, correlated with timeout and circuit-breaker state. Never log full bearer tokens.

## Operability gates

- Logs, traces and metrics correlate by traceId; prefer OpenTelemetry as the common signal.
- Define retention and sampling: sample high-volume DEBUG, always keep ERROR.
