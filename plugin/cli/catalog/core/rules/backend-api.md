---
id: core-backend-api
title: Backend API and data services
categories: [backend, fullstack]
---
# Backend API and data services

## Essentials

- Version the API (`/v1`); never ship a breaking change without a version bump, and give deprecations a `Sunset` header and timeline.
- Return errors as RFC 7807 `application/problem+json` with semantically correct status codes (404 vs 403 vs 409 vs 422).
- Bind requests through DTOs or field allowlists; never map a request body straight onto an entity (mass assignment).
- Require an Idempotency-Key on non-idempotent endpoints such as creation and payments.
- Call downstreams with a timeout, retry with exponential backoff and jitter, a circuit breaker and a bulkhead.
- Shut down gracefully (drain in-flight requests, close pools) and expose separate liveness, readiness and health probes.
- Set explicit transaction boundaries with the right isolation level, and guard races with optimistic or pessimistic locking.
- Make migrations zero-downtime (expand/contract) and reversible, and never edit an applied migration.
- Store money as integer minor units or decimal (never float) and timestamps in UTC.
- Add rate limiting and request body size limits; size connection pools and set a query timeout on every query.
- Cache with an explicit TTL and invalidation strategy; support ETag or conditional requests where useful.
- With a message bus, use the outbox pattern, idempotent consumers and a dead-letter queue, and assume at-least-once delivery.

## API contract and compatibility

- For a public API, add consumer-driven contract tests so clients do not break on change.

## Eventing and async

- Keep the database and events consistent with transactional messaging (outbox), not dual writes.
- Consumers tolerate duplicates and reordering.

## Data integrity

- Forward-only migrations in prod; test them against a real database.
