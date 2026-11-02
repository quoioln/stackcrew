Goes to `src/common/api/api-response.ts`.

```ts
// Default location: src/common/api/api-response.ts
import { HttpException, HttpStatus } from '@nestjs/common';
import { CrossTenantDeniedError } from '../context/request-context';
import { ApiError, UpstreamApiError } from './api-error';
import { CommonError, errorForStatus, formatErrorNumber, type ErrorDefinition } from './error-codes';

/**
 * The one body shape of every API response (core rule backend-api). TransformInterceptor builds the success,
 * AllExceptionsFilter the failure; a controller returns its data or throws, and never builds an envelope.
 * The HTTP status is on the status line only. timestamp is ISO-8601 UTC with milliseconds.
 */
export type ApiSuccess<T> = { success: true; timestamp: string; supportCode: string; requestId: string; data: T };

/** One per (field, constraint). field is a dotted path with [index] for array items, or null; message never holds the submitted value. */
export type ErrorDetail = { field: string | null; code: string; message: string };

/** errorNumber is SSCCNNN of the service that raised the error; an upstream error keeps the upstream's number. details is [] when empty. */
export type ErrorPayload = { errorNumber: string; errorCode: string; details: readonly ErrorDetail[] };

/** message is the error table's summary for errorCode, never an exception's text. */
export type ApiFailure = {
  success: false;
  message: string;
  timestamp: string;
  supportCode: string;
  requestId: string;
  error: ErrorPayload;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** page is 0-based. totalPages is 0 for an empty result; a page past the last one has items [] and hasNext false. */
export type Pagination = { page: number; size: number; totalElements: number; totalPages: number; hasNext: boolean; hasPrevious: boolean };

/** The data of a paged list. A list that is not paged is a plain array, [] when empty, never null. */
export type PageData<T> = { items: readonly T[]; pagination: Pagination };

/** The ids the logging middleware bound to the request: the same values as the x-support-code and x-request-id headers. */
export type CorrelationIds = { supportCode: string; requestId: string };

/** What an exception becomes: the status and the body without the correlation fields, which the filter adds. */
export type Failure = { status: number; body: Omit<ApiFailure, 'timestamp' | 'supportCode' | 'requestId'> };

type Classified = { definition: ErrorDefinition; details: readonly ErrorDetail[] };

/** A handler that returns nothing (undefined, a void delete) gives data: null; the data key is always there. */
export function successEnvelope<T>(data: T | undefined, ids: CorrelationIds): ApiSuccess<T | null> {
  return { success: true, timestamp: new Date().toISOString(), supportCode: ids.supportCode, requestId: ids.requestId, data: data === undefined ? null : data };
}

export function failureEnvelope({ message: summary, error }: Failure['body'], ids: CorrelationIds): ApiFailure {
  return {
    success: false,
    message: summary,
    timestamp: new Date().toISOString(),
    supportCode: ids.supportCode,
    requestId: ids.requestId,
    error,
  };
}

/** A page of a list, built in the service or controller from the rows and the total count. */
export function toPageData<T>(items: readonly T[], page: number, size: number, totalElements: number): PageData<T> {
  if (size < 1) {
    throw new RangeError('size must be at least 1');
  }
  const totalPages = totalElements === 0 ? 0 : Math.ceil(totalElements / size);
  return { items, pagination: { page, size, totalElements, totalPages, hasNext: page + 1 < totalPages, hasPrevious: page > 0 } };
}

/**
 * The NestJS column of the contract's exception table. Status, code and summary come from the table, never from the
 * exception: body-parser and JSON parse errors quote the request, and driver errors carry values.
 */
export function toFailure(exception: unknown, serviceNumber: string): Failure {
  if (exception instanceof UpstreamApiError) {
    return { status: exception.status, body: { success: false, message: exception.summary, error: exception.payload } };
  }
  const { definition, details } = classify(exception);
  const error: ErrorPayload = { errorNumber: formatErrorNumber(serviceNumber, definition), errorCode: definition.code, details };
  return { status: definition.status, body: { success: false, message: definition.summary, error } };
}

function classify(exception: unknown): Classified {
  if (exception instanceof ApiError) { // RequestValidationError too: VALIDATION_FAILED with its details
    return { definition: exception.definition, details: exception.details };
  }
  if (exception instanceof CrossTenantDeniedError) {
    return { definition: CommonError.RESOURCE_NOT_FOUND, details: [] }; // as for a missing row, so no one can probe ids
  }
  if (exception instanceof HttpException) { // unknown route 404, guard 401/403, Parse*Pipe 400: features never throw these
    return { definition: errorForStatus(exception.getStatus()), details: [] };
  }
  const status = bodyParserStatus(exception);
  if (status !== undefined) {
    return { definition: status === HttpStatus.BAD_REQUEST ? CommonError.MALFORMED_REQUEST : errorForStatus(status), details: [] };
  }
  return { definition: CommonError.INTERNAL_ERROR, details: [] };
}

/** body-parser errors (400 entity.parse.failed, 413 entity.too.large, 415 charset.unsupported...) carry a 4xx `status` and a `type`. */
function bodyParserStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null || !('type' in exception) || !('status' in exception)) {
    return undefined;
  }
  const { status } = exception;
  return typeof status === 'number' && status >= HttpStatus.BAD_REQUEST && status < HttpStatus.INTERNAL_SERVER_ERROR ? status : undefined;
}
```
