Goes to `src/shared/logging/http-client.ts`.

```ts
// Default location: src/shared/logging/http-client.ts
import 'server-only';
import { contextLogFields } from '../context/request-context';
import { bodyPlaceholder, loadLogBodies, loadMaskOptions, maskBody, type MaskOptions } from './body-masker';
import { elapsedMs, errorName, LogEvent, writeCallLine, type CallLogLine } from './log-fields';
import { logger } from './logger';
import { capturedBody, contentTypeOf, shouldCapture, uncapturedBody } from './web-body';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_METHOD = 'GET';
const FORM_TYPE = 'application/x-www-form-urlencoded';

/**
 * The one HTTP client for outbound calls (core-logging): `await httpClient.fetch('kyc-provider', `${env.KYC_URL}/verify`,
 * { method: 'POST', headers, body: JSON.stringify(request) })`. It is fetch plus one http_out line per call: target,
 * method, url (no query string, no user info), status, durationMs, error (when no response came), and both bodies
 * through the masker. The response is returned at once; a JSON or form reply is read from a clone() for the line.
 * Without a signal in init, the call is bounded by DEFAULT_TIMEOUT_MS. Never call fetch directly for another service.
 */
export const httpClient = {
  async fetch(target: string, input: string, init?: RequestInit): Promise<Response> {
    const started = process.hrtime.bigint();
    const method = (init?.method ?? DEFAULT_METHOD).toUpperCase();
    const url = sanitizeUrl(input);
    const ids = contextLogFields();
    const logBodies = loadLogBodies();
    const opts = loadMaskOptions();
    const reqBody = logBodies ? requestBody(init, opts) : undefined;
    let response: Response;
    try {
      response = await fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
    } catch (failure: unknown) {
      writeOutLine(() => ({ event: LogEvent.HTTP_OUT, target, method, url, durationMs: elapsedMs(started), error: failureCode(failure) }), ids, reqBody, undefined);
      throw failure;
    }
    const minimal = (): CallLogLine => ({ event: LogEvent.HTTP_OUT, target, method, url, status: response.status, durationMs: elapsedMs(started) });
    if (!logBodies || !shouldCapture(response)) {
      writeOutLine(minimal, ids, reqBody, logBodies ? uncapturedBody(response.headers) : undefined);
      return response;
    }
    const copy = response.clone().body;
    const resBody = copy === null ? Promise.resolve(undefined) : capturedBody(copy, contentTypeOf(response.headers), opts);
    void resBody.then(
      (body) => writeOutLine(minimal, ids, reqBody, body),
      (failure: unknown) => writeOutLine(() => ({ ...minimal(), error: failureCode(failure) }), ids, reqBody, undefined), // the reply broke mid-read
    );
    return response;
  },
};

function writeOutLine(minimal: () => CallLogLine, ids: Partial<CallLogLine>, reqBody: string | undefined, resBody: string | undefined): void {
  writeCallLine(logger, () => ({ ...minimal(), ...ids, reqBody, resBody }), minimal);
}

/** A string body is masked as its declared content type; URLSearchParams as a form; anything else logs its size or nothing. */
function requestBody(init: RequestInit | undefined, opts: MaskOptions): string | undefined {
  const body = init?.body;
  const contentType = new Headers(init?.headers).get('content-type') ?? undefined;
  if (typeof body === 'string') {
    return maskBody(body, contentType, opts);
  }
  if (body instanceof URLSearchParams) {
    return maskBody(body.toString(), FORM_TYPE, opts);
  }
  if (body instanceof Blob) {
    return bodyPlaceholder(contentType ?? body.type, body.size);
  }
  return undefined; // a stream or FormData: not read for the line
}

/** Scheme, host, port and path: the query string, fragment and user info can carry secrets or PII. */
function sanitizeUrl(uri: string): string {
  try {
    const url = new URL(uri);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return uri.split(/[?#]/)[0];
  }
}

/** The network error code (ECONNREFUSED, UND_ERR_SOCKET), or the error class (TimeoutError); never a message. */
function failureCode(failure: unknown): string {
  const cause: unknown = failure instanceof Error ? failure.cause : undefined;
  const code: unknown = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
  return typeof code === 'string' ? code : errorName(failure);
}
```
