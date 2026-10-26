Goes to `src/modules/kyc/acme/acme-kyc.client.ts`.

```ts
// Default location: src/modules/kyc/acme/acme-kyc.client.ts
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { providerCallPolicy } from '../../../common/providers/provider-call.policy';
import type { ProviderCall, ProviderPolicyOptions } from '../../../common/providers/provider-policy.types';
import { ProviderRejectedError, ProviderUnavailableError, type ProviderError } from '../../../common/providers/provider.errors';
import type { VerifyIdentityCommand, VerifyIdentityResult } from '../interfaces/kyc-verification';
import { KycProvider } from '../kyc-provider.port';
import { KYC_PROVIDER_POLICY } from '../kyc.constants';
import { toAcmeRequest, toVerifyResult } from './acme-kyc.mapper';

const VERIFY_PATH = '/v1/verifications';
const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
const TOO_MANY_REQUESTS = 429;
const SERVER_ERROR = 500;

/**
 * The Acme adapter of KycProvider. Base URL, timeout, the API key header and no redirects come from KycModule's
 * HttpModule.registerAsync; OutboundHttpLogger on that HttpService writes one masked http_out line per attempt, so this
 * class logs no body. Each attempt maps its failure to a typed provider error; the policy retries the transient ones.
 */
@Injectable()
export class AcmeKycClient extends KycProvider {
  private readonly call: ProviderCall;

  constructor(
    private readonly http: HttpService,
    @Inject(KYC_PROVIDER_POLICY) policy: ProviderPolicyOptions,
  ) {
    super();
    this.call = providerCallPolicy(policy); // one breaker for every call to this provider
  }

  /** Safe to retry: Acme applies a request once per Idempotency-Key, and every attempt sends the same key. */
  verify(command: VerifyIdentityCommand): Promise<VerifyIdentityResult> {
    return this.call(async () => {
      try {
        const response = await firstValueFrom(this.http.post<unknown>(VERIFY_PATH, toAcmeRequest(command), {
          headers: { [IDEMPOTENCY_KEY_HEADER]: command.requestId },
        }));
        return toVerifyResult(response.data);
      } catch (error: unknown) {
        throw isAxiosError(error) ? providerErrorFor(error.response?.status) : error; // a ProviderProtocolError passes as is
      }
    });
  }
}

/** Only a missing response (timeout, refused, reset), 5xx and 429 are transient; any other status is a rejection. */
function providerErrorFor(status: number | undefined): ProviderError {
  if (status === undefined || status >= SERVER_ERROR || status === TOO_MANY_REQUESTS) {
    return new ProviderUnavailableError();
  }
  return new ProviderRejectedError();
}
```
