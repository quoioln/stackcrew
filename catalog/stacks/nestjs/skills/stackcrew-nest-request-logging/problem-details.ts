// Default location: src/common/errors/problem-details.ts
import { BadRequestException, HttpException, HttpStatus, type ValidationError } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { CrossTenantDeniedError } from '../context/request-context';

/** RFC 7807 body (application/problem+json). `detail` is always a constant, safe text: never an exception message. */
export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors?: readonly FieldError[];
};

export type FieldError = { field: string; messages: readonly string[] };

const ABOUT_BLANK = 'about:blank';
const CLIENT_ERROR_MIN = 400;
const CLIENT_ERROR_MAX = 499;
export const ProblemText = {
  INVALID_REQUEST: 'The request is invalid.',
  REQUEST_FAILED: 'The request could not be processed.',
  UNEXPECTED: 'An unexpected error occurred.',
} as const;

/** A domain error with its HTTP status and a constant detail. Feature code throws subclasses; the filter maps them. */
export abstract class ProblemError extends Error {
  abstract readonly status: HttpStatus;
  abstract readonly detail: string;

  constructor() {
    super();
    this.name = new.target.name; // the http_in line's `error` names the subclass
  }
}

/** Thrown by the global ValidationPipe (exceptionFactory below): the fields and the class-validator messages. */
export class RequestValidationError extends BadRequestException {
  constructor(readonly fieldErrors: readonly FieldError[]) {
    super(ProblemText.INVALID_REQUEST);
  }
}

/** ValidationPipe({ ..., exceptionFactory: requestValidationError }). Messages name the rule, never the value. */
export function requestValidationError(errors: ValidationError[]): RequestValidationError {
  return new RequestValidationError(flatten(errors, ''));
}

export function toProblem(exception: unknown): ProblemDetails {
  if (exception instanceof RequestValidationError) {
    return { ...problem(HttpStatus.BAD_REQUEST, ProblemText.INVALID_REQUEST), errors: exception.fieldErrors };
  }
  if (exception instanceof ProblemError) {
    return problem(exception.status, exception.detail);
  }
  if (exception instanceof CrossTenantDeniedError) {
    return problem(HttpStatus.NOT_FOUND, STATUS_CODES[HttpStatus.NOT_FOUND] ?? ProblemText.REQUEST_FAILED); // as for a missing row
  }
  if (exception instanceof HttpException) {
    return problem(exception.getStatus(), STATUS_CODES[exception.getStatus()] ?? ProblemText.REQUEST_FAILED);
  }
  const clientStatus = bodyParserStatus(exception);
  if (clientStatus !== undefined) {
    return problem(clientStatus, STATUS_CODES[clientStatus] ?? ProblemText.REQUEST_FAILED);
  }
  return problem(HttpStatus.INTERNAL_SERVER_ERROR, ProblemText.UNEXPECTED);
}

function problem(status: number, detail: string): ProblemDetails {
  return { type: ABOUT_BLANK, title: STATUS_CODES[status] ?? String(status), status, detail };
}

/** body-parser errors (413 entity.too.large, 415 unsupported charset...) carry a 4xx `status` and a `type`. */
function bodyParserStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null || !('type' in exception) || !('status' in exception)) {
    return undefined;
  }
  const { status } = exception;
  return typeof status === 'number' && status >= CLIENT_ERROR_MIN && status <= CLIENT_ERROR_MAX ? status : undefined;
}

function flatten(errors: readonly ValidationError[], prefix: string): FieldError[] {
  return errors.flatMap((error) => {
    const field = prefix === '' ? error.property : `${prefix}.${error.property}`;
    const own = error.constraints === undefined ? [] : [{ field, messages: Object.values(error.constraints) }];
    return [...own, ...flatten(error.children ?? [], field)];
  });
}
