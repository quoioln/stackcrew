Goes to `src/common/api/api-error.ts`.

```ts
// Default location: src/common/api/api-error.ts
import { HttpStatus } from '@nestjs/common';
import type { ErrorDetail, ErrorPayload } from './api-response';
import { CommonError, errorForStatus, type ErrorDefinition } from './error-codes';

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

/**
 * @deprecated Kept only while older domain errors still declare `status` and `detail`; extend ApiError with an
 * ErrorDefinition instead. The detail is ignored: the body carries the table summary of the row the status stands for.
 */
export abstract class ProblemError extends ApiError {
  abstract readonly status: HttpStatus;
  abstract readonly detail: string;

  constructor() {
    super(CommonError.INTERNAL_ERROR);
    // the subclass's status does not exist yet: the row is looked up when the filter reads it
    Object.defineProperty(this, 'definition', { get: () => problemDefinition(this) });
  }
}

const PROBLEM_ROWS: ReadonlyMap<number, ErrorDefinition> = new Map<number, ErrorDefinition>([
  [HttpStatus.NOT_FOUND, CommonError.RESOURCE_NOT_FOUND],
  [HttpStatus.BAD_GATEWAY, CommonError.BAD_GATEWAY],
  [HttpStatus.SERVICE_UNAVAILABLE, CommonError.DEPENDENCY_UNAVAILABLE],
]);

/** @deprecated The row a ProblemError's status stands for: a missing row, a conflict, a provider failure. */
function problemDefinition(error: ProblemError): ErrorDefinition {
  return PROBLEM_ROWS.get(error.status) ?? errorForStatus(error.status);
}
```
