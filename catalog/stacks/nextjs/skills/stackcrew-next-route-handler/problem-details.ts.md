Goes to `src/shared/http/problem-details.ts`.

```ts
// Default location: src/shared/http/problem-details.ts
import 'server-only';
import { STATUS_CODES } from 'node:http';
import { NextResponse } from 'next/server';
import { ACTION_ERROR_STATUS, type ActionError, type ActionErrorCode } from '../action-result';
import { CrossTenantDeniedError } from '../context/request-context';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
const ABOUT_BLANK = 'about:blank';

/** The statuses route handlers answer, by name. */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNSUPPORTED_MEDIA_TYPE: 415,
} as const;

/** RFC 7807 body (application/problem+json), the shape of the NestJS AllExceptionsFilter: `detail` is constant text. */
export type ProblemDetails = { type: string; title: string; status: number; detail: string; errors?: readonly FieldError[] };
export type FieldError = { field: string; messages: readonly string[] };

/** Every detail is one of these: never an exception message, a value from the request or a provider's words. */
export const ProblemText = {
  INVALID_REQUEST: 'The request is invalid.',
  MALFORMED_JSON: 'The request body is not valid JSON.',
  UNSUPPORTED_MEDIA_TYPE: 'The request body must be application/json.',
  UNAUTHENTICATED: 'Sign in to use this resource.',
  FORBIDDEN: 'You are not allowed to do this.',
  NOT_FOUND: 'The resource does not exist.',
  CONFLICT: 'The request conflicts with the current state of the resource.',
} as const;

const REFUSAL_TEXT: Readonly<Record<ActionErrorCode, string>> = {
  VALIDATION: ProblemText.INVALID_REQUEST,
  UNAUTHENTICATED: ProblemText.UNAUTHENTICATED,
  FORBIDDEN: ProblemText.FORBIDDEN,
  NOT_FOUND: ProblemText.NOT_FOUND,
  CONFLICT: ProblemText.CONFLICT,
};

export function problemResponse(status: number, detail: string, errors?: readonly FieldError[]): NextResponse<ProblemDetails> {
  const body: ProblemDetails = { type: ABOUT_BLANK, title: STATUS_CODES[status] ?? String(status), status, detail, ...(errors === undefined ? {} : { errors }) };
  return NextResponse.json(body, { status, headers: { 'content-type': PROBLEM_CONTENT_TYPE } });
}

/**
 * A typed refusal of a shared function (the ActionResult a server action returns too) as a problem: the status its code
 * stands for (ACTION_ERROR_STATUS, the same table the action's log line uses) and the field errors as `errors`.
 */
export function problemForRefusal(error: ActionError): NextResponse<ProblemDetails> {
  const errors = error.fieldErrors === undefined ? undefined : toFieldErrors(error.fieldErrors);
  return problemResponse(ACTION_ERROR_STATUS[error.code], REFUSAL_TEXT[error.code], errors);
}

/** zod's `flatten().fieldErrors` (`{ field: [messages] }`) as the problem's `errors` (`[{ field, messages }]`). */
export function toFieldErrors(fieldErrors: Partial<Record<string, string[]>>): FieldError[] {
  return Object.entries(fieldErrors).flatMap(([field, messages]) => (messages === undefined || messages.length === 0 ? [] : [{ field, messages }]));
}

/**
 * For the catch of a handler that reads across tenants (runCrossTenant): a denied caller gets 404, exactly like a
 * missing row, so no one can probe for another tenant's ids. Anything else is rethrown unchanged: withRouteLogging logs
 * it as a 500 with its class, onRequestError logs its stack, and Next.js answers 500.
 */
export function notFoundIfCrossTenantDenied(failure: unknown): NextResponse<ProblemDetails> {
  if (failure instanceof CrossTenantDeniedError) {
    return problemResponse(HTTP_STATUS.NOT_FOUND, ProblemText.NOT_FOUND);
  }
  throw failure;
}
```
