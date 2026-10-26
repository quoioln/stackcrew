// Default location: src/common/logging/outbound-http-logger.ts
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger, type OnModuleInit, type Provider } from '@nestjs/common';
import { AxiosHeaders, isAxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { Readable } from 'node:stream';
import { contextLogFields } from '../context/request-context';
import { bodyPlaceholder, isMaskable, loadLogBodies, loadMaskOptions, maskBody, serializeMasked, type MaskOptions } from './body-masker';
import { elapsedMs, levelFor, LogEvent, type CallLogLine } from './log-fields';

export const OUTBOUND_TARGET = Symbol('OUTBOUND_TARGET');
const CAPTURE_LIMIT_BYTES = 2 * 1024 * 1024;

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
  private readonly startedAt = new WeakMap<object, bigint>();

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

  private write(config: InternalAxiosRequestConfig, response: AxiosResponse | undefined, error: string | undefined): void {
    const started = this.startedAt.get(config);
    const line: CallLogLine = {
      event: LogEvent.HTTP_OUT,
      target: this.target,
      method: (config.method ?? 'get').toUpperCase(),
      url: sanitizeUrl(this.http.axiosRef.getUri(config)),
      status: response?.status,
      durationMs: started === undefined ? undefined : elapsedMs(started),
      error,
      ...contextLogFields(),
      ...(this.logBodies ? { reqBody: requestBody(config, this.opts), resBody: response && responseBody(response, this.opts) } : {}),
    };
    this.logger[levelFor(line.status)](line, LogEvent.HTTP_OUT);
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
    return Buffer.byteLength(data) <= CAPTURE_LIMIT_BYTES ? maskBody(data, contentType, opts) : bodyPlaceholder(contentType, Buffer.byteLength(data));
  }
  return declaredSize(contentType, header(config.headers, 'content-length'));
}

/** Chosen by the response content type: never maskValue on a string, so XML or text only ever logs its size. */
function responseBody(response: AxiosResponse, opts: MaskOptions): string | undefined {
  const contentType = header(response.headers, 'content-type');
  const data: unknown = response.data;
  if (data instanceof Readable) {
    return declaredSize(contentType, header(response.headers, 'content-length'));
  }
  if (data === undefined || data === null || data === '') {
    return undefined;
  }
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    return maskBody(data, contentType, opts);
  }
  if (data instanceof ArrayBuffer) {
    return maskBody(Buffer.from(data), contentType, opts);
  }
  // axios parsed it as JSON; log it only when the response declares JSON or form
  return isMaskable(contentType) ? serializeMasked(data, opts) : bodyPlaceholder(contentType, Buffer.byteLength(JSON.stringify(data)));
}

function declaredSize(contentType: string | undefined, contentLength: string | undefined): string | undefined {
  const size = Number(contentLength ?? 0);
  return size > 0 ? bodyPlaceholder(contentType, size) : undefined;
}

function header(headers: InternalAxiosRequestConfig['headers'] | AxiosResponse['headers'], name: string): string | undefined {
  const value = headers instanceof AxiosHeaders ? headers.get(name) : undefined;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}
