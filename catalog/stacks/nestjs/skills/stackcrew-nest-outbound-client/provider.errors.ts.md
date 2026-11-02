Goes to `src/common/providers/provider.errors.ts`.

```ts
// Default location: src/common/providers/provider.errors.ts
import { ApiError } from '../api/api-error';
import { CommonError } from '../api/error-codes';

/**
 * Typed outcomes of a failed third-party call, so the retry policy, the circuit breaker and the API answer can tell
 * them apart. They are ApiErrors on this service's own group-80 rows: AllExceptionsFilter answers 503 or 502 with the
 * row's fixed summary, never the provider's message or code. They carry no cause: a provider error can quote the
 * request, PII included.
 */
export abstract class ProviderError extends ApiError {}

/**
 * Timeout, connection refused or reset, 5xx, 429, a 409 (the idempotency key is still in use), a 401 or 403 (our
 * credential or its permissions), an open circuit or a full bulkhead: a later call with the same key may succeed.
 * DEPENDENCY_UNAVAILABLE, 503.
 */
export class ProviderUnavailableError extends ProviderError {
  constructor() {
    super(CommonError.DEPENDENCY_UNAVAILABLE);
  }
}

/**
 * Any other 4xx (400, 404, 422, …) or a 3xx (redirects are off): the provider refused this request, and the same key
 * would be refused again. BAD_GATEWAY, 502, unless a feature catches it and throws its own domain error.
 */
export class ProviderRejectedError extends ProviderError {
  constructor() {
    super(CommonError.BAD_GATEWAY);
  }
}

/** A reply that is not JSON, misses a field, or carries a result code the mapper does not know. BAD_GATEWAY, 502. */
export class ProviderProtocolError extends ProviderError {
  constructor() {
    super(CommonError.BAD_GATEWAY);
  }
}
```
