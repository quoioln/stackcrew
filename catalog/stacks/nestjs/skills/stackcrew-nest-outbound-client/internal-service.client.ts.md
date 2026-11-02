Goes to `src/common/http/internal-service.client.ts`.

```ts
// Default location: src/common/http/internal-service.client.ts
import { HttpService } from '@nestjs/axios';
import { AxiosError, isAxiosError, type AxiosRequestConfig } from 'axios';
import { STATUS_CODES } from 'node:http';
import { firstValueFrom } from 'rxjs';
import { ApiError, UpstreamApiError } from '../api/api-error';
import type { ErrorDetail, ErrorPayload } from '../api/api-response';
import { CommonError } from '../api/error-codes';
import { providerCallPolicy } from '../providers/provider-call.policy';
import type { ProviderCall, ProviderPolicyOptions } from '../providers/provider-policy.types';
import { ProviderUnavailableError } from '../providers/provider.errors';

const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const CONFLICT = 409;
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;
const CLIENT_ERROR = 400;
const BAD_GATEWAY_STATUS = 502;
const ERROR_NUMBER = /^\d{7}$/;
const TIMEOUT_CODES: ReadonlySet<string> = new Set([AxiosError.ECONNABORTED, AxiosError.ETIMEDOUT, AxiosError.ERR_CANCELED]);

type Outcome = { kind: 'reply'; status: number; body: unknown } | { kind: 'failure'; error: unknown };

/**
 * Turns another internal service's answer into data or into this service's error. A 4xx envelope keeps the origin's
 * errorNumber, errorCode and details (UpstreamApiError, B's status); a 5xx envelope is passed on with status 502.
 * Everything else is this service's own group-80 error, never a pass-through, and carries no upstream text:
 * - 401 or 403, envelope or not: DEPENDENCY_UNAVAILABLE (our credential or its permissions, not the caller's fault);
 * - a 5xx without an envelope (an HTML 502 from a proxy): DEPENDENCY_UNAVAILABLE;
 * - a 2xx, 3xx or 4xx whose body is not an envelope, or an envelope whose errorNumber is malformed: BAD_GATEWAY.
 * `body` is what axios made of the reply: the parsed JSON, or the text when it was not JSON.
 */
export function unwrapEnvelope<T>(status: number, body: unknown): T {
  if (status === UNAUTHORIZED || status === FORBIDDEN) {
    throw new ApiError(CommonError.DEPENDENCY_UNAVAILABLE);
  }
  const envelope = asRecord(body);
  if (status >= 200 && status < 300) {
    if (envelope?.success !== true) {
      throw new ApiError(CommonError.BAD_GATEWAY);
    }
    return (envelope.data === undefined ? null : envelope.data) as T;
  }
  const serverError = status >= SERVER_ERROR && status < 600;
  const clientError = status >= CLIENT_ERROR && status < SERVER_ERROR;
  const payload = envelope?.success === false && (serverError || clientError) ? errorPayload(envelope.error) : undefined;
  if (payload !== undefined && envelope !== undefined) {
    if (clientError && STATUS_CODES[status] === undefined) {
      throw new ApiError(CommonError.BAD_GATEWAY); // not a status this service can pass on
    }
    const summary = typeof envelope.message === 'string' && envelope.message !== '' ? envelope.message : payload.errorCode;
    throw new UpstreamApiError(serverError ? BAD_GATEWAY_STATUS : status, payload, summary);
  }
  throw new ApiError(serverError ? CommonError.DEPENDENCY_UNAVAILABLE : CommonError.BAD_GATEWAY);
}

/** A timeout is GATEWAY_TIMEOUT; connection refused or reset, and anything else, DEPENDENCY_UNAVAILABLE. Neither carries a cause. */
export function classifyTransportFailure(error: unknown): ApiError {
  const code = isAxiosError(error) ? (error.code ?? codeOf(error.cause)) : undefined;
  return new ApiError(code !== undefined && TIMEOUT_CODES.has(code) ? CommonError.GATEWAY_TIMEOUT : CommonError.DEPENDENCY_UNAVAILABLE);
}

/**
 * The client of one other internal service, on a module's own HttpService (baseURL, maxRedirects: 0, maxContentLength
 * and OutboundHttpLogger, like KycModule) and the same breaker, retry and bulkhead as a provider call. Every call is
 * safe to retry: a GET, or a POST that carries an Idempotency-Key the other service honours. 5xx, 429, 409, 401, 403
 * and no reply are retried; the answer after the last attempt is unwrapped.
 */
export class InternalServiceClient {
  private readonly call: ProviderCall;

  constructor(
    private readonly http: HttpService,
    private readonly options: { readonly policy: ProviderPolicyOptions; readonly timeoutMs: number },
  ) {
    this.call = providerCallPolicy(options.policy); // one breaker for every call to this service
  }

  get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
    return this.send<T>({ method: 'GET', url: path, params });
  }

  post<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    return this.send<T>({ method: 'POST', url: path, data: body, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } });
  }

  private async send<T>(config: AxiosRequestConfig): Promise<T> {
    const seen: { outcome?: Outcome } = {};
    try {
      await this.call(async () => {
        try {
          // every status is an answer to classify, not an exception; the bound covers connect, headers and body
          const reply = await firstValueFrom(this.http.request({ ...config, validateStatus: () => true, signal: AbortSignal.timeout(this.options.timeoutMs) }));
          seen.outcome = { kind: 'reply', status: reply.status, body: reply.data };
          if (isRetried(reply.status)) {
            throw new ProviderUnavailableError();
          }
        } catch (error: unknown) {
          if (error instanceof ProviderUnavailableError) {
            throw error;
          }
          seen.outcome = { kind: 'failure', error };
          throw new ProviderUnavailableError(); // no reply at all: retried and counted by the breaker
        }
      });
    } catch (error: unknown) {
      if (!(error instanceof ProviderUnavailableError)) {
        throw error;
      }
      // out of attempts, or the circuit is open (no outcome): the last answer decides
    }
    const outcome = seen.outcome;
    if (outcome === undefined) {
      throw new ApiError(CommonError.DEPENDENCY_UNAVAILABLE); // an open circuit or a full bulkhead: nothing was sent
    }
    if (outcome.kind === 'failure') {
      throw classifyTransportFailure(outcome.error);
    }
    return unwrapEnvelope<T>(outcome.status, outcome.body);
  }
}

function isRetried(status: number): boolean {
  return status >= SERVER_ERROR || status === TOO_MANY_REQUESTS || status === CONFLICT || status === UNAUTHORIZED || status === FORBIDDEN;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function codeOf(value: unknown): string | undefined {
  const code = asRecord(value)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** B's error object rebuilt from plain strings, or undefined when its errorNumber is not seven digits or its errorCode is blank. */
function errorPayload(value: unknown): ErrorPayload | undefined {
  const error = asRecord(value);
  if (typeof error?.errorNumber !== 'string' || !ERROR_NUMBER.test(error.errorNumber) || typeof error.errorCode !== 'string' || error.errorCode.trim() === '') {
    return undefined;
  }
  const details = Array.isArray(error.details) ? error.details.flatMap((item: unknown): ErrorDetail[] => toDetail(item)) : [];
  return { errorNumber: error.errorNumber, errorCode: error.errorCode, details };
}

function toDetail(item: unknown): ErrorDetail[] {
  const detail = asRecord(item);
  if (detail === undefined || typeof detail.code !== 'string' || typeof detail.message !== 'string' || !(detail.field === null || typeof detail.field === 'string')) {
    return []; // a malformed entry is dropped, never forwarded
  }
  return [{ field: detail.field, code: detail.code, message: detail.message }];
}
```
