Goes to `src/modules/kyc/kyc-provider.port.ts`.

```ts
// Default location: src/modules/kyc/kyc-provider.port.ts
import type { VerifyIdentityCommand, VerifyIdentityResult } from './interfaces/kyc-verification';

/**
 * What the application needs from an identity verification provider, in domain types only: no provider name, field
 * or code. An abstract class is also the injection token: KycModule binds one adapter to it, and tests bind a fake
 * ({ provide: KycProvider, useValue: fake }). A second provider adds an adapter, never a second port.
 */
export abstract class KycProvider {
  /** Throws ProviderUnavailableError, ProviderRejectedError or ProviderProtocolError; never returns a partial result. */
  abstract verify(command: VerifyIdentityCommand): Promise<VerifyIdentityResult>;
}
```
