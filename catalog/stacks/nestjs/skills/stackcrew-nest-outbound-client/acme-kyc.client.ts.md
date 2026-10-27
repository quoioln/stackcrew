Goes to `src/modules/kyc/acme/acme-kyc.client.ts`.

```ts
// Default location: src/modules/kyc/acme/acme-kyc.client.ts
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { providerCallPolicy } from '../../../common/providers/provider-call.policy';
import type { ProviderCall, ProviderPolicyOptions } from '../../../common/providers/provider-policy.types';
import { ProviderProtocolError, ProviderRejectedError, ProviderUnavailableError, type ProviderError } from '../../../common/providers/provider.errors';
import type { KycProviderEnv } from '../../../config/env';
import type { VerifyIdentityCommand, VerifyIdentityResult } from '../interfaces/kyc-verification';
import { KycProvider } from '../kyc-provider.port';
import { KYC_PROVIDER_POLICY } from '../kyc.constants';
import { toAcmeRequest, toVerifyResult } from './acme-kyc.mapper';

const VERIFY_PATH = '/v1/verifications';
const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const CONFLICT = 409;
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;
/** axios rejects a status from here on; below it, an error with a response is a body that broke after the headers. */
const FIRST_ERROR_STATUS = 300;
/**
 * Statuses under 500 that are not a refusal of this request: 429, a 409 (the provider is still working on the same
 * idempotency key: a concurrent run or a retry that overtook the first attempt; it replays the result once done), and
 * 401 or 403 (our credential or its permissions, fixed in configuration, not in the request). The operation stays
 * open and a retry sends the same key.
 */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([TOO_MANY_REQUESTS, CONFLICT, UNAUTHORIZED, FORBIDDEN]);

/**
 * The Acme adapter of KycProvider. Base URL, timeout, body size limits, the API key header and no redirects come from
 * KycModule's HttpModule.registerAsync; OutboundHttpLogger on that HttpService writes one masked http_out line per
 * attempt, so this class logs no body. Each attempt is bounded as a whole by an AbortSignal (axios `timeout` stops
 * counting once the response headers arrive), and maps its failure to a typed provider error; the policy retries the
 * transient ones.
 */
@Injectable()
export class AcmeKycClient extends KycProvider {
  private readonly call: ProviderCall;
  private readonly attemptTimeoutMs: number;

  constructor(
    private readonly http: HttpService,
    config: ConfigService<KycProviderEnv, true>,
    @Inject(KYC_PROVIDER_POLICY) policy: ProviderPolicyOptions,
  ) {
    super();
    this.call = providerCallPolicy(policy); // one breaker for every call to this provider
    this.attemptTimeoutMs = config.get('KYC_PROVIDER_TIMEOUT_MS', { infer: true });
  }

  /** Safe to retry: Acme applies a request once per Idempotency-Key, and every attempt sends the command's stored key. */
  verify(command: VerifyIdentityCommand): Promise<VerifyIdentityResult> {
    return this.call(async () => {
      try {
        const response = await firstValueFrom(this.http.post<unknown>(VERIFY_PATH, toAcmeRequest(command), {
          headers: { [IDEMPOTENCY_KEY_HEADER]: command.idempotencyKey },
          signal: AbortSignal.timeout(this.attemptTimeoutMs), // the whole attempt: connect, headers and body
        }));
        return toVerifyResult(response.data);
      } catch (error: unknown) {
        throw isAxiosError(error) ? providerErrorFor(error) : error; // a ProviderProtocolError passes as is
      }
    });
  }
}

/**
 * Transient (retried, and counted by the circuit breaker): 5xx, the RETRYABLE_STATUSES, no reply at all (timeout, the
 * attempt bound, refused, reset), and a 2xx whose body broke mid-read (a reset or an aborted stream after the
 * headers). Other statuses (400, 404, 422, any other 4xx or a 3xx) are rejections of this request, which the provider
 * would refuse again under the same key. A retry is safe: every attempt sends the same idempotency key.
 */
function providerErrorFor(error: AxiosError): ProviderError {
  const status = error.response?.status;
  if (status !== undefined && status < FIRST_ERROR_STATUS) {
    return new ProviderUnavailableError(); // the transport failed while reading a successful reply
  }
  if (status !== undefined) {
    return status >= SERVER_ERROR || RETRYABLE_STATUSES.has(status) ? new ProviderUnavailableError() : new ProviderRejectedError();
  }
  if (error.code === AxiosError.ERR_BAD_RESPONSE) {
    return new ProviderProtocolError(); // a reply over maxContentLength: sending it again gets the same reply
  }
  if (error.code === AxiosError.ERR_BAD_REQUEST) {
    return new ProviderRejectedError(); // our request over maxBodyLength, or invalid before it was sent
  }
  return new ProviderUnavailableError();
}
```
