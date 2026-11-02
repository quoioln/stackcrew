Goes to `src/common/errors/all-exceptions.filter.ts`.

```ts
// Default location: src/common/errors/all-exceptions.filter.ts
import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { ApiEnv } from '../../config/env';
import { ApiError, UpstreamApiError } from '../api/api-error';
import { failureEnvelope, toFailure, type Failure } from '../api/api-response';
import { CommonError } from '../api/error-codes';
import { isRawRequest } from '../api/raw-response.decorator';
import { REQUEST_ID_HEADER, requestIdsOf, SUPPORT_CODE_HEADER } from '../context/request-context';
import { recordFailure, routeMatched } from '../logging/http-logging.middleware';

const UNHANDLED_ERROR = 'unhandled_error';
const NEWLINE = '\n';

/**
 * Global (APP_FILTER): every exception becomes the error envelope (core-backend-api), with status, errorNumber, code and
 * summary from the error table (toFailure) and the request's supportCode and requestId. Guard rejections, unknown
 * routes, body-parser and validation errors pass through here too. It writes no http_in line: it records the exception
 * class for the line the logging middleware writes, and logs the stack of unexpected errors only.
 *
 * A filter must never throw: if the envelope cannot be built (toFailure throws, say formatErrorNumber's RangeError for a
 * wrong domain row), the answer is the INTERNAL_ERROR envelope and the failure is logged. An HttpException thrown by a
 * @RawResponse() handler (terminus's 503 with its details) is answered with its own status and body.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly serviceNumber: string;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.serviceNumber = config.get('SERVICE_NUMBER', { infer: true });
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const ids = requestIdsOf(req);
    recordFailure(res, exception instanceof Error ? exception.name : typeof exception);
    if (isRawRequest(req) && exception instanceof HttpException) {
      this.sendRaw(res, exception, ids);
      return;
    }
    const { failure, cause } = this.failureOf(req, exception);
    if (failure.status >= HttpStatus.INTERNAL_SERVER_ERROR && !isExpected(cause)) {
      // the frames only: a message (or a driver error's detail) can carry values from the request
      this.logger.error({
        event: UNHANDLED_ERROR, error: cause instanceof Error ? cause.name : typeof cause, requestId: ids.requestId, supportCode: ids.supportCode, stack: stackFrames(cause),
      }, UNHANDLED_ERROR);
    }
    if (res.headersSent) {
      res.end(); // a stream failed half-way: the status is gone, close the response
      return;
    }
    setCorrelationHeaders(res, ids);
    res.status(failure.status).json(failureEnvelope(failure.body, ids));
  }

  /** The table row of the exception; if building it throws, INTERNAL_ERROR, with the thrown error as the cause to log. */
  private failureOf(req: Request, exception: unknown): { failure: Failure; cause: unknown } {
    try {
      return { failure: toFailure(malformedBody(req, exception) ? new ApiError(CommonError.MALFORMED_REQUEST) : exception, this.serviceNumber), cause: exception };
    } catch (broken: unknown) {
      return { failure: toFailure(new ApiError(CommonError.INTERNAL_ERROR), this.serviceNumber), cause: broken };
    }
  }

  /** A raw handler (health) owns its error body too: the HttpException's status and response, unchanged. */
  private sendRaw(res: Response, exception: HttpException, ids: { requestId: string; supportCode: string }): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    setCorrelationHeaders(res, ids);
    const body = exception.getResponse();
    if (typeof body === 'string') {
      res.status(exception.getStatus()).send(body);
    } else {
      res.status(exception.getStatus()).json(body);
    }
  }
}

function setCorrelationHeaders(res: Response, ids: { requestId: string; supportCode: string }): void {
  res.setHeader(REQUEST_ID_HEADER, ids.requestId); // the middleware set them already; a skipped path gets them here
  res.setHeader(SUPPORT_CODE_HEADER, ids.supportCode);
}

/**
 * Nest turns body-parser's JSON SyntaxError into a plain BadRequestException (RoutesResolver.mapExternalException), so
 * the exception alone looks like a Parse*Pipe 400. It is the one 400 raised before any route matched on a request
 * that carries a body: MALFORMED_REQUEST, not INVALID_PARAMETER.
 *
 * Known false positives, both answered MALFORMED_REQUEST where the 400 is not a body problem: a URIError from a malformed
 * route parameter (`/v1/x/%FF`) on a request that has a body (without a body it is INVALID_PARAMETER), and a
 * BadRequestException thrown by a middleware registered through MiddlewareConsumer (a parser or a check of its own): it
 * runs before any guard, so no route is recorded as matched. The status is 400 either way.
 */
function malformedBody(req: Request, exception: unknown): boolean {
  const hasBody = Number(req.header('content-length') ?? 0) > 0 || req.header('transfer-encoding') !== undefined;
  return exception instanceof BadRequestException && hasBody && !routeMatched(req);
}

/** Thrown on purpose (a provider failure is DEPENDENCY_UNAVAILABLE or BAD_GATEWAY) or by Nest itself: no stack line. */
function isExpected(exception: unknown): boolean {
  return exception instanceof ApiError || exception instanceof UpstreamApiError || exception instanceof HttpException;
}

function stackFrames(exception: unknown): string | undefined {
  return exception instanceof Error ? exception.stack?.split(NEWLINE).slice(1).map((frame) => frame.trim()).join(NEWLINE) : undefined;
}
```
