// Default location: src/common/logging/http-logging.middleware.ts
import { Logger, type RawBodyRequest } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { bindRequestContext, requestContextOf, REQUEST_ID_HEADER, safeRequestIdOrNew } from '../context/request-context';
import { bodyPlaceholder, isMaskable, loadLogBodies, loadMaskOptions, maskBody, type MaskOptions } from './body-masker';
import { elapsedMs, levelFor, LogEvent, type CallLogLine } from './log-fields';

/** JSON and form bodies up to this size are masked whole (so a base64 image shrinks to its size); larger ones log their size. */
const CAPTURE_LIMIT_BYTES = 2 * 1024 * 1024;
const UNMATCHED_ROUTE = 'UNMATCHED';
const CLIENT_ABORT = 'ClientAbort';
/** Health checks and metrics get no line. Adjust to the project's paths. */
const SKIPPED_PATH_PREFIXES = ['/health', '/metrics'];

type ResponseTee = { bytes: number; streamed: boolean; captured?: string | Buffer };

const failures = new WeakMap<object, string>();
const routeTemplates = new WeakMap<object, string>();

/** AllExceptionsFilter records the exception class of a failed request; the line carries it as `error`. */
export function recordFailure(res: object, error: string): void {
  failures.set(res, error);
}

/**
 * RouteTemplateGuard records the matched handler's Express route (/v1/customer-profiles/:id) before any other guard runs.
 * req.route alone is not enough: on an unknown path it holds the "/*" route Nest mounts its middleware on.
 */
export function recordRouteTemplate(req: Request): void {
  const route: unknown = req.route;
  if (typeof route === 'object' && route !== null && 'path' in route && typeof route.path === 'string') {
    routeTemplates.set(req, route.path);
  }
}

/**
 * One http_in line per request (core-logging), written once when the response finishes or the connection closes.
 * Register it in setupApp with app.use(), before app.init(): it then runs ahead of Nest's body parsers, CORS and every
 * route, so malformed bodies, 401 and 403 from guards, 404s and validation failures get their line too.
 * The response is never held back: every byte goes straight to the client. Only a JSON or form body sent in one piece
 * (res.json, res.send) is kept, by reference, for masking; streams, SSE and files are only counted.
 */
export function httpLoggingMiddleware(): RequestHandler {
  const logger = new Logger('HttpLogging');
  const opts = loadMaskOptions();
  const logBodies = loadLogBodies();
  return (req: RawBodyRequest<Request>, res: Response, next: NextFunction): void => {
    if (SKIPPED_PATH_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
      next();
      return;
    }
    const started = process.hrtime.bigint();
    const requestId = safeRequestIdOrNew(req.header(REQUEST_ID_HEADER));
    bindRequestContext(req, { requestId, roles: [] });
    const tee = teeResponse(res);
    let written = false;
    const writeLine = (): void => {
      if (written) {
        return;
      }
      written = true;
      const ctx = requestContextOf(req); // read now: authentication may have bound the user after this middleware ran
      const line: CallLogLine = {
        event: LogEvent.HTTP_IN,
        method: req.method,
        route: routeTemplates.get(req) ?? UNMATCHED_ROUTE,
        status: res.statusCode,
        durationMs: elapsedMs(started),
        error: failures.get(res) ?? (res.writableFinished ? undefined : CLIENT_ABORT),
        requestId,
        userId: ctx?.userId, // set explicitly, even when undefined, so a log mixin cannot fill them from another context
        tenantId: ctx?.tenantId,
        ...(logBodies ? { reqBody: requestBody(req, opts), resBody: responseBody(res, tee, opts) } : {}),
      };
      logger[levelFor(line.status)](line, LogEvent.HTTP_IN);
    };
    res.once('finish', writeLine);
    res.once('close', writeLine);
    next();
  };
}

/** Nest keeps the raw bytes of JSON and form bodies (NestFactory.create(..., { rawBody: true })); nothing else is buffered. */
function requestBody(req: RawBodyRequest<Request>, opts: MaskOptions): string | undefined {
  const contentType = req.header('content-type');
  const raw = req.rawBody;
  if (raw !== undefined && raw.length > 0) {
    return raw.length <= CAPTURE_LIMIT_BYTES ? maskBody(raw, contentType, opts) : bodyPlaceholder(contentType, raw.length);
  }
  const declared = Number(req.header('content-length') ?? 0);
  return declared > 0 ? bodyPlaceholder(contentType, declared) : undefined;
}

function responseBody(res: Response, tee: ResponseTee, opts: MaskOptions): string | undefined {
  const contentType = headerText(res.getHeader('content-type'));
  if (tee.captured !== undefined) {
    return maskBody(tee.captured, contentType, opts);
  }
  return tee.bytes > 0 ? bodyPlaceholder(contentType, tee.bytes) : undefined;
}

/** Write-through: counts every byte; keeps a reference to a maskable body that res.end receives in one piece. */
function teeResponse(res: Response): ResponseTee {
  const tee: ResponseTee = { bytes: 0, streamed: false };
  const write = res.write;
  const end = res.end;
  res.write = function teeWrite(this: Response, ...args: unknown[]): boolean {
    tee.streamed = true; // a body written in pieces (stream, SSE, file) is only counted, never kept
    tee.captured = undefined;
    tee.bytes += chunkBytes(args[0], args[1]);
    return Reflect.apply(write, this, args) === true;
  } as Response['write'];
  res.end = function teeEnd(this: Response, ...args: unknown[]): Response {
    const chunk = typeof args[0] === 'function' ? undefined : args[0];
    const size = chunkBytes(chunk, args[1]);
    tee.bytes += size;
    const oneMaskablePiece = !tee.streamed && size > 0 && size <= CAPTURE_LIMIT_BYTES && isMaskable(headerText(this.getHeader('content-type')));
    if (oneMaskablePiece && (typeof chunk === 'string' || Buffer.isBuffer(chunk))) {
      tee.captured = chunk;
    }
    Reflect.apply(end, this, args);
    return this;
  } as Response['end'];
  return tee;
}

function chunkBytes(chunk: unknown, encoding: unknown): number {
  if (typeof chunk === 'string') {
    return Buffer.byteLength(chunk, typeof encoding === 'string' && Buffer.isEncoding(encoding) ? encoding : 'utf8');
  }
  return chunk instanceof Uint8Array ? chunk.byteLength : 0;
}

function headerText(value: number | string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
