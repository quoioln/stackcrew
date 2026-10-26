Goes to `src/common/providers/provider.errors.ts`.

```ts
// Default location: src/common/providers/provider.errors.ts
import { HttpStatus } from '@nestjs/common';
import { ProblemError } from '../errors/problem-details';

/**
 * Typed outcomes of a failed third-party call, so the retry policy, the circuit breaker and the API answer can tell
 * them apart. They extend ProblemError: AllExceptionsFilter answers 503 or 502 with a constant detail, never the
 * provider's message or code. They carry no cause: a provider error can quote the request, PII included.
 */
export abstract class ProviderError extends ProblemError {}

/** Timeout, connection refused or reset, 5xx, 429, an open circuit or a full bulkhead: a later call may succeed. */
export class ProviderUnavailableError extends ProviderError {
  readonly status = HttpStatus.SERVICE_UNAVAILABLE;
  readonly detail = 'A downstream provider is unavailable. Try again later.';
}

/** Any other 4xx (or 3xx: redirects are off): the provider refused this request, and sending it again will not help. */
export class ProviderRejectedError extends ProviderError {
  readonly status = HttpStatus.BAD_GATEWAY;
  readonly detail = 'A downstream provider rejected the request.';
}

/** A reply that is not JSON, misses a field, or carries a result code the mapper does not know. */
export class ProviderProtocolError extends ProviderError {
  readonly status = HttpStatus.BAD_GATEWAY;
  readonly detail = 'A downstream provider sent an invalid response.';
}
```
