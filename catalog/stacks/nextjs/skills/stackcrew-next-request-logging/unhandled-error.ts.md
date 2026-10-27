Goes to `src/shared/logging/unhandled-error.ts`.

```ts
// Default location: src/shared/logging/unhandled-error.ts
import type { Instrumentation } from 'next';
import { REQUEST_ID_HEADER, safeRequestIdOrNew } from '../context/request-context';
import { errorName } from './log-fields';
import { logger } from './logger';

const UNHANDLED_ERROR = 'unhandled_error';
const STACK_FRAME = /^\s+at /;

type OnRequestErrorArgs = Parameters<Instrumentation.onRequestError>;

/**
 * The unhandled_error line of onRequestError: the error class, its digest (the id Next.js shows in the error page),
 * where it happened (routePath, routeType) and the stack frames. Never the message or the request path's query: both
 * can carry input. Never throws.
 */
export function logUnhandledError(error: unknown, request: OnRequestErrorArgs[1], context: OnRequestErrorArgs[2]): void {
  try {
    const requestId = request.headers[REQUEST_ID_HEADER];
    logger.error({
      event: UNHANDLED_ERROR,
      error: errorName(error),
      digest: typeof error === 'object' && error !== null && 'digest' in error && typeof error.digest === 'string' ? error.digest : undefined,
      method: request.method,
      route: context.routePath,
      routeType: context.routeType,
      requestId: typeof requestId === 'string' ? safeRequestIdOrNew(requestId) : undefined,
      stack: stackFrames(error),
    }, UNHANDLED_ERROR);
  } catch (failure: unknown) {
    process.emitWarning(`${UNHANDLED_ERROR} line not written (${errorName(failure)})`);
  }
}

/** Only the "at ..." lines: the first lines of a stack repeat the message, which may span several lines. */
function stackFrames(error: unknown): string[] {
  const stack = error instanceof Error ? error.stack ?? '' : '';
  return stack.split('\n').filter((line) => STACK_FRAME.test(line)).map((line) => line.trim());
}
```
