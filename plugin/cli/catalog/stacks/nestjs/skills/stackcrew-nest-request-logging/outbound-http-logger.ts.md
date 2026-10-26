Goes to `src/common/logging/outbound-http-logger.ts`.

```ts
// Default location: src/common/logging/outbound-http-logger.ts
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger, type OnModuleInit, type Provider } from '@nestjs/common';
import { AxiosHeaders, isAxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { Readable } from 'node:stream';
import { contextLogFields } from '../context/request-context';
import {
  bodyPlaceholder, isMaskable, jsonByteLength, loadLogBodies, loadMaskOptions, maskBody, placeholderFor, serializeMasked, type MaskOptions,
} from './body-masker';
import { elapsedMs, LogEvent, writeCallLine, type CallLogLine } from './log-fields';

export const OUTBOUND_TARGET = Symbol('OUTBOUND_TARGET');
/** Request and response bodies up to this size are masked whole; larger ones log only their size, as on the inbound line. */
const CAPTURE_LIMIT_BYTES = 2_097_152; // 2 MiB

/**
 * Providers for a module that imports HttpModule.register(...). Each importing module gets its own HttpService and
 * axios instance, so list this once in every such module, never twice in one (that would log every call twice).
 */
export function outboundHttpLogging(target: string): Provider[] {
  return [{ provide: OUTBOUND_TARGET, useValue: target }, OutboundHttpLogger];
}

/** One http_out line per outbound call (and per retry attempt), from axios interceptors on this module's HttpService. */
@Injectable()
export class OutboundHttpLogger implements OnModuleInit {
  private readonly logger = new Logger(OutboundHttpLogger.name);
  private readonly opts = loadMaskOptions();
  private readonly logBodies = loadLogBodies();
  private readonly startedAt = new WeakMap<InternalAxiosRequestConfig, bigint>();

  constructor(
    private readonly http: HttpService,
    @Inject(OUTBOUND_TARGET) private readonly target: string,
  ) {}

  onModuleInit(): void {
    const axios = this.http.axiosRef;
    axios.interceptors.request.use((config) => {
      this.startedAt.set(config, process.hrtime.bigint());
      return config;
    });
    axios.interceptors.response.use(
      (response) => {
        this.write(response.config, response, undefined);
        return response;
      },
      (error: unknown) => {
        if (isAxiosError(error) && error.config !== undefined) {
          this.write(error.config, error.response, error.code ?? error.name);
        }
        return Promise.reject(error);
      },
    );
  }

  /** Runs inside axios's promise chain: through writeCallLine, so a logging failure never changes the call's result. */
  private write(config: InternalAxiosRequestConfig, response: AxiosResponse | undefined, error: string | undefined): void {
    const started = this.startedAt.get(config);
    const url = this.urlOf(config);
    const minimal = (): CallLogLine => ({
      event: LogEvent.HTTP_OUT,
      target: this.target,
      method: (config.method ?? 'get').toUpperCase(),
      url,
      status: response?.status,
      durationMs: started === undefined ? undefined : elapsedMs(started),
      error,
    });
    writeCallLine(this.logger, () => ({
      ...minimal(),
      ...contextLogFields(),
      ...(this.logBodies ? { reqBody: requestBody(config, this.opts), resBody: response && responseBody(response, this.opts) } : {}),
    }), minimal);
  }

  private urlOf(config: InternalAxiosRequestConfig): string | undefined {
    try {
      return sanitizeUrl(this.http.axiosRef.getUri(config));
    } catch {
      return undefined; // a config axios cannot turn into a URL: the line goes out without it
    }
  }
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

/** By the time a response arrives, axios has serialized config.data (a JSON or form string); streams are never read. */
function requestBody(config: InternalAxiosRequestConfig, opts: MaskOptions): string | undefined {
  const contentType = header(config.headers, 'content-type');
  const data: unknown = config.data;
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    return cappedBody(data, contentType, opts);
  }
  return declaredSize(contentType, header(config.headers, 'content-length'));
}

/**
 * Chosen by the response content type: never maskValue on a string, so XML or text only ever logs its size. Like the
 * request body and the inbound line, a body over CAPTURE_LIMIT_BYTES logs only `<CT N bytes>` with its known size (the
 * Content-Length, or the size of the data axios returned) and is never masked or serialized again for the line.
 */
function responseBody(response: AxiosResponse, opts: MaskOptions): string | undefined {
  const contentType = header(response.headers, 'content-type');
  const declared = Number(header(response.headers, 'content-length') ?? 0);
  const data: unknown = response.data;
  if (data instanceof Readable) {
    return declaredSize(contentType, header(response.headers, 'content-length'));
  }
  if (data === undefined || data === null || data === '') {
    return undefined;
  }
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    return cappedBody(data, contentType, opts);
  }
  if (data instanceof ArrayBuffer) {
    return cappedBody(Buffer.from(data), contentType, opts);
  }
  // axios parsed it as JSON. Over the cap by Content-Length: its size, without serializing it again
  if (declared > CAPTURE_LIMIT_BYTES) {
    return bodyPlaceholder(contentType, declared);
  }
  const size = jsonByteLength(data); // no Content-Length (chunked, or decompressed): the size of its JSON text
  if (size === undefined) {
    return placeholderFor(data, contentType, opts); // JSON.stringify throws: the size is unknown
  }
  // masked only when the response declares JSON or form and the body is within the cap; else its size
  return isMaskable(contentType) && size <= CAPTURE_LIMIT_BYTES ? serializeMasked(data, opts, contentType) : bodyPlaceholder(contentType, size);
}

/** A raw body within the capture cap is masked; a larger one logs only its size. */
function cappedBody(raw: string | Buffer, contentType: string | undefined, opts: MaskOptions): string | undefined {
  const size = Buffer.byteLength(raw);
  return size <= CAPTURE_LIMIT_BYTES ? maskBody(raw, contentType, opts) : bodyPlaceholder(contentType, size);
}

function declaredSize(contentType: string | undefined, contentLength: string | undefined): string | undefined {
  const size = Number(contentLength ?? 0);
  return size > 0 ? bodyPlaceholder(contentType, size) : undefined;
}

function header(headers: InternalAxiosRequestConfig['headers'] | AxiosResponse['headers'], name: string): string | undefined {
  const value = headers instanceof AxiosHeaders ? headers.get(name) : undefined;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}
```
