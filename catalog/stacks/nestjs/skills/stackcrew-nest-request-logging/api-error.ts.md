Goes to `src/common/api/api-error.ts`.

```ts
// Default location: src/common/api/api-error.ts
import type { ErrorDetail, ErrorPayload } from './api-response';
import type { ErrorDefinition } from './error-codes';

/**
 * The one error a service, guard or pipe throws on purpose: a row of an error table and optional details.
 * AllExceptionsFilter answers it with that row's status, errorNumber, code and summary. A domain error is a subclass
 * with its own row (`super(CUSTOMER_PROFILE_NOT_FOUND)`), so the http_in line's `error` names it.
 */
export class ApiError extends Error {
  constructor(readonly definition: ErrorDefinition, readonly details: readonly ErrorDetail[] = []) {
    super(definition.code); // the code only: an Error's text can reach a log line
    this.name = new.target.name;
  }
}

/**
 * Another internal service answered with an error envelope (stackcrew-nest-outbound-client, internal-service mode).
 * The filter passes its payload on unchanged, errorNumber included, with this status (the upstream's 4xx, or 502 for
 * its 5xx) and the upstream's summary; supportCode, requestId and timestamp are this service's own.
 */
export class UpstreamApiError extends Error {
  constructor(readonly status: number, readonly payload: ErrorPayload, readonly summary: string) {
    super(payload.errorCode);
    this.name = new.target.name;
  }
}
```
