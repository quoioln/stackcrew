Goes to `src/common/api/error-codes.ts`.

```ts
// Default location: src/common/api/error-codes.ts
import { HttpStatus } from '@nestjs/common';

/** One row of an error table. errorNumber = service number + category (2 digits) + seq (3 digits): SSCCNNN. */
export type ErrorDefinition = {
  readonly category: number;
  readonly seq: number;
  /** The translation key for the frontend, UPPER_SNAKE_CASE; several services may use the same one. */
  readonly code: string;
  readonly status: number;
  /** The fixed English text the body carries as `message`; never an exception's text. */
  readonly summary: string;
};

/**
 * The common error table, identical in every stack (seq 1-99). A domain error is its own ErrorDefinition with seq
 * 100-999 in its feature folder: it may reuse a common code and status (category 30, code RESOURCE_NOT_FOUND, with the
 * same summary) or define a new code with its own summary.
 */
export const CommonError = {
  VALIDATION_FAILED: { category: 10, seq: 1, code: 'VALIDATION_FAILED', status: 400, summary: 'Request validation failed' },
  MALFORMED_REQUEST: { category: 11, seq: 1, code: 'MALFORMED_REQUEST', status: 400, summary: 'The request body is malformed' },
  METHOD_NOT_ALLOWED: { category: 11, seq: 2, code: 'METHOD_NOT_ALLOWED', status: 405, summary: 'The HTTP method is not supported' },
  UNSUPPORTED_MEDIA_TYPE: { category: 11, seq: 3, code: 'UNSUPPORTED_MEDIA_TYPE', status: 415, summary: 'The content type is not supported' },
  INVALID_PARAMETER: { category: 11, seq: 4, code: 'INVALID_PARAMETER', status: 400, summary: 'A query or path parameter is invalid' },
  PAYLOAD_TOO_LARGE: { category: 11, seq: 5, code: 'PAYLOAD_TOO_LARGE', status: 413, summary: 'The request body is too large' },
  ENDPOINT_NOT_FOUND: { category: 11, seq: 6, code: 'ENDPOINT_NOT_FOUND', status: 404, summary: 'The endpoint does not exist' },
  UNAUTHENTICATED: { category: 20, seq: 1, code: 'UNAUTHENTICATED', status: 401, summary: 'Authentication is required' },
  ACCESS_DENIED: { category: 21, seq: 1, code: 'ACCESS_DENIED', status: 403, summary: 'You are not allowed to do this' },
  RESOURCE_NOT_FOUND: { category: 30, seq: 1, code: 'RESOURCE_NOT_FOUND', status: 404, summary: 'The resource does not exist' },
  BUSINESS_CONFLICT: { category: 40, seq: 1, code: 'BUSINESS_CONFLICT', status: 409, summary: 'The request conflicts with the current state' },
  BUSINESS_RULE_VIOLATION: { category: 41, seq: 1, code: 'BUSINESS_RULE_VIOLATION', status: 422, summary: 'The request violates a business rule' },
  RATE_LIMIT_EXCEEDED: { category: 50, seq: 1, code: 'RATE_LIMIT_EXCEEDED', status: 429, summary: 'Too many requests' },
  DEPENDENCY_UNAVAILABLE: { category: 80, seq: 1, code: 'DEPENDENCY_UNAVAILABLE', status: 503, summary: 'A required service is unavailable' },
  BAD_GATEWAY: { category: 80, seq: 2, code: 'BAD_GATEWAY', status: 502, summary: 'An upstream service returned an invalid response' },
  GATEWAY_TIMEOUT: { category: 80, seq: 3, code: 'GATEWAY_TIMEOUT', status: 504, summary: 'An upstream service did not respond in time' },
  INTERNAL_ERROR: { category: 90, seq: 1, code: 'INTERNAL_ERROR', status: 500, summary: 'An unexpected error occurred' },
} as const satisfies Record<string, ErrorDefinition>;

/** details[].code, identical in every stack so the frontend can translate per field. Anything unmapped is INVALID_VALUE. */
export const DetailCode = {
  REQUIRED: 'REQUIRED',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_TYPE: 'INVALID_TYPE',
  TOO_SHORT: 'TOO_SHORT',
  TOO_LONG: 'TOO_LONG',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  INVALID_VALUE: 'INVALID_VALUE',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
} as const;
export type DetailCode = (typeof DetailCode)[keyof typeof DetailCode];

const CATEGORY_DIGITS = 2;
const SEQ_DIGITS = 3;
const MAX_CATEGORY = 99;
const MAX_SEQ = 999;

/** SSCCNNN, always a string: "0710001" keeps its leading zero. */
export function formatErrorNumber(serviceNumber: string, def: ErrorDefinition): string {
  const validCategory = Number.isInteger(def.category) && def.category >= 0 && def.category <= MAX_CATEGORY;
  const validSeq = Number.isInteger(def.seq) && def.seq >= 1 && def.seq <= MAX_SEQ;
  if (!validCategory || !validSeq) {
    throw new RangeError(`category must be 0-99 and seq 1-999: ${def.code}`); // a wrong table row, found by the first test that throws it
  }
  return `${serviceNumber}${String(def.category).padStart(CATEGORY_DIGITS, '0')}${String(def.seq).padStart(SEQ_DIGITS, '0')}`;
}

const BY_STATUS: ReadonlyMap<number, ErrorDefinition> = new Map<number, ErrorDefinition>([
  [HttpStatus.UNAUTHORIZED, CommonError.UNAUTHENTICATED],
  [HttpStatus.FORBIDDEN, CommonError.ACCESS_DENIED],
  [HttpStatus.NOT_FOUND, CommonError.ENDPOINT_NOT_FOUND],
  [HttpStatus.METHOD_NOT_ALLOWED, CommonError.METHOD_NOT_ALLOWED],
  [HttpStatus.CONFLICT, CommonError.BUSINESS_CONFLICT],
  [HttpStatus.PAYLOAD_TOO_LARGE, CommonError.PAYLOAD_TOO_LARGE],
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE, CommonError.UNSUPPORTED_MEDIA_TYPE],
  [HttpStatus.UNPROCESSABLE_ENTITY, CommonError.BUSINESS_RULE_VIOLATION],
  [HttpStatus.TOO_MANY_REQUESTS, CommonError.RATE_LIMIT_EXCEEDED],
]);

/**
 * The one status-to-code mapping for errors that carry only an HTTP status: Nest's HttpExceptions (a 404 for an unknown
 * route, a guard's 401 or 403, a Parse*Pipe's 400) and body-parser errors. Any other 4xx is INVALID_PARAMETER,
 * anything else INTERNAL_ERROR.
 */
export function errorForStatus(status: number): ErrorDefinition {
  const clientError = status >= HttpStatus.BAD_REQUEST && status < HttpStatus.INTERNAL_SERVER_ERROR;
  return BY_STATUS.get(status) ?? (clientError ? CommonError.INVALID_PARAMETER : CommonError.INTERNAL_ERROR);
}
```
