Goes to `src/common/errors/all-exceptions.filter.ts`.

```ts
// Default location: src/common/errors/all-exceptions.filter.ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestContextOf } from '../context/request-context';
import { recordFailure } from '../logging/http-logging.middleware';
import { toProblem } from './problem-details';

const PROBLEM_JSON = 'application/problem+json';
const UNHANDLED_ERROR = 'unhandled_error';
const NEWLINE = '\n';

/**
 * Global (APP_FILTER): every exception becomes an RFC 7807 response with a constant detail (core-backend-api). Guard
 * rejections, unknown routes, body-parser and validation errors pass through here too. It writes no http_in line: it
 * records the exception class for the line the logging middleware writes, and logs the stack of unexpected errors.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const problem = toProblem(exception);
    const errorName = exception instanceof Error ? exception.name : typeof exception;
    recordFailure(res, errorName);
    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR && !(exception instanceof HttpException)) {
      const ctx = requestContextOf(req);
      // the frames only: a message (or a driver error's detail) can carry values from the request
      this.logger.error({ event: UNHANDLED_ERROR, error: errorName, requestId: ctx?.requestId, stack: stackFrames(exception) }, UNHANDLED_ERROR);
    }
    if (res.headersSent) {
      res.end(); // a stream failed half-way: the status is gone, close the response
      return;
    }
    res.status(problem.status).type(PROBLEM_JSON).send(JSON.stringify(problem));
  }
}

function stackFrames(exception: unknown): string | undefined {
  return exception instanceof Error ? exception.stack?.split(NEWLINE).slice(1).map((frame) => frame.trim()).join(NEWLINE) : undefined;
}
```
