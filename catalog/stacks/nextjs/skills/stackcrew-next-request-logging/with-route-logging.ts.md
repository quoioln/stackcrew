Goes to `src/shared/logging/with-route-logging.ts`.

```ts
// Default location: src/shared/logging/with-route-logging.ts
import 'server-only';
import type { NextRequest } from 'next/server';
import { contextLogFields, runWithRequestContext, type RequestContext } from '../context/request-context';
import { contextOfRequest } from '../context/session-context';
import { loadLogBodies, loadMaskOptions } from './body-masker';
import { elapsedMs, errorName, LogEvent, writeCallLine, type CallLogLine } from './log-fields';
import { logger } from './logger';
import { nextControlFlow } from './next-control-flow';
import { capturedBody, contentTypeOf, shouldCapture, uncapturedBody } from './web-body';

const SERVER_ERROR_STATUS = 500;

/** What a route handler file exports: Next.js passes the request and `{ params }` (RouteContext<'/path/[id]'>). */
export type RouteHandler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/**
 * Wraps a route handler: `export const GET = withRouteLogging('/api/v1/customer-profiles/[id]', async (req, ctx:
 * RouteContext<'/api/v1/customer-profiles/[id]'>) => ...)`. The route is the template of the file's path (constant,
 * low-cardinality), never the requested path. Each call runs inside the request context and writes exactly one
 * http_in line with the masked request and response bodies. The response is returned at once and never held back: a
 * JSON or form body is read from a clone() (at most CAPTURE_LIMIT_BYTES) and the line is written when that copy is
 * read; streams, SSE and files are never copied and log their declared size only.
 * Errors and Next.js control flow (redirect(), notFound()) are rethrown unchanged.
 */
export function withRouteLogging<C>(route: string, handler: RouteHandler<C>): RouteHandler<C> {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    const started = process.hrtime.bigint();
    const logBodies = loadLogBodies();
    const reqBody = logBodies ? requestBody(req) : Promise.resolve(undefined);
    let context: RequestContext;
    try {
      context = await contextOfRequest();
    } catch (failure: unknown) {
      writeRouteLine(req.method, route, started, reqBody, { failure });
      throw failure;
    }
    return runWithRequestContext(context, async () => {
      let response: Response;
      try {
        response = await handler(req, ctx);
      } catch (failure: unknown) {
        writeRouteLine(req.method, route, started, reqBody, { failure });
        throw failure;
      }
      const resBody = logBodies ? responseBody(response) : Promise.resolve(undefined);
      writeRouteLine(req.method, route, started, reqBody, { response, resBody });
      return response;
    });
  };
}

/** The masked request body, read from a clone taken before the handler reads the original. */
function requestBody(req: NextRequest): Promise<string | undefined> {
  if (!shouldCapture(req)) {
    return Promise.resolve(uncapturedBody(req.headers));
  }
  const copy = req.clone().body;
  return copy === null ? Promise.resolve(undefined) : capturedBody(copy, contentTypeOf(req.headers), loadMaskOptions());
}

/** The masked response body, read from a clone while Next.js streams the original to the client. */
function responseBody(response: Response): Promise<string | undefined> {
  if (!shouldCapture(response)) {
    return Promise.resolve(uncapturedBody(response.headers));
  }
  const copy = response.clone().body;
  return copy === null ? Promise.resolve(undefined) : capturedBody(copy, contentTypeOf(response.headers), loadMaskOptions());
}

type RouteOutcome = { response: Response; resBody: Promise<string | undefined> } | { failure: unknown };

/** Writes the line once both bodies are read (never before the response is returned). Never throws or rejects. */
function writeRouteLine(method: string, route: string, started: bigint, reqBody: Promise<string | undefined>, outcome: RouteOutcome): void {
  const control = 'failure' in outcome ? nextControlFlow(outcome.failure) : undefined;
  if (control !== undefined && control.status === undefined) {
    return; // a rendering bailout while `next build` prerenders a GET handler: not a request
  }
  const ids = contextLogFields(); // read now, inside the request context
  const minimal = (durationMs: number): CallLogLine => ('failure' in outcome
    ? { event: LogEvent.HTTP_IN, method, route, durationMs, status: control?.status ?? SERVER_ERROR_STATUS, error: control?.name ?? errorName(outcome.failure) }
    : { event: LogEvent.HTTP_IN, method, route, durationMs, status: outcome.response.status });
  const resBody = 'failure' in outcome ? Promise.resolve(undefined) : outcome.resBody;
  const write = (bodies: { reqBody?: string; resBody?: string }): void => {
    const durationMs = elapsedMs(started);
    writeCallLine(logger, () => ({ ...minimal(durationMs), ...ids, ...bodies }), () => minimal(durationMs));
  };
  void Promise.all([reqBody, resBody]).then(
    ([req, res]) => write({ reqBody: req, resBody: res }),
    () => write({}), // a body stream failed: the line is written without bodies
  );
}

```
