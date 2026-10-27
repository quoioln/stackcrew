Goes to `src/modules/kyc/kyc.constants.ts`.

```ts
// Default location: src/modules/kyc/kyc.constants.ts
import type { ProviderPolicyOptions } from '../../common/providers/provider-policy.types';

/** The `target` of this provider's http_out lines. */
export const KYC_PROVIDER_TARGET = 'kyc-provider';

/** Injection token of the resilience settings; a test overrides it with short delays. */
export const KYC_PROVIDER_POLICY = Symbol('KYC_PROVIDER_POLICY');

/** Injection token of the outcome side writes (KycOutcomeEffects); KycVerificationModule binds a no-op until a feature replaces it. */
export const KYC_OUTCOME_EFFECTS = Symbol('KYC_OUTCOME_EFFECTS');

/** Tune from the provider's SLA: all attempts and backoff together stay well inside the caller's own timeout. */
export const KYC_PROVIDER_POLICY_DEFAULTS: ProviderPolicyOptions = {
  maxRetries: 2,
  initialDelayMs: 200,
  maxDelayMs: 2_000,
  breakAfter: 5,
  halfOpenAfterMs: 30_000,
  maxConcurrent: 10,
  maxQueued: 20,
};
```
