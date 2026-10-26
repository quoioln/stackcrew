Goes to `src/modules/kyc/kyc.module.ts`.

```ts
// Default location: src/modules/kyc/kyc.module.ts
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { outboundHttpLogging } from '../../common/logging/outbound-http-logger';
import type { KycProviderEnv } from '../../config/env';
import { AcmeKycClient } from './acme/acme-kyc.client';
import { KycProvider } from './kyc-provider.port';
import { KYC_PROVIDER_POLICY, KYC_PROVIDER_POLICY_DEFAULTS, KYC_PROVIDER_TARGET } from './kyc.constants';

const API_KEY_HEADER = 'X-Api-Key';
/** Provider replies are small JSON; a larger one is refused before it is buffered. */
const MAX_RESPONSE_BYTES = 1_048_576; // 1 MiB
/** The request carries a base64 selfie. */
const MAX_REQUEST_BYTES = 10_485_760; // 10 MiB

/**
 * The KYC provider: its own HttpService (base URL, timeout and the API key from config, no redirects, body limits),
 * OutboundHttpLogger on that HttpService, the resilience settings, and the adapter bound to the KycProvider port.
 * Other modules import KycModule and inject KycProvider only.
 */
@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<KycProviderEnv, true>) => ({
        baseURL: config.get('KYC_PROVIDER_BASE_URL', { infer: true }),
        timeout: config.get('KYC_PROVIDER_TIMEOUT_MS', { infer: true }),
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        maxBodyLength: MAX_REQUEST_BYTES,
        headers: { [API_KEY_HEADER]: config.get('KYC_PROVIDER_API_KEY', { infer: true }) },
      }),
    }),
  ],
  providers: [
    { provide: KYC_PROVIDER_POLICY, useValue: KYC_PROVIDER_POLICY_DEFAULTS },
    { provide: KycProvider, useClass: AcmeKycClient },
    ...outboundHttpLogging(KYC_PROVIDER_TARGET),
  ],
  exports: [KycProvider],
})
export class KycModule {}
```
