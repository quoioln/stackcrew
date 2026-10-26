Goes to `src/modules/kyc/interfaces/kyc-verification.ts`.

```ts
// Default location: src/modules/kyc/interfaces/kyc-verification.ts

export const KycDecision = { APPROVED: 'APPROVED', REJECTED: 'REJECTED', PENDING: 'PENDING' } as const;
export type KycDecision = (typeof KycDecision)[keyof typeof KycDecision];

/**
 * One identity check, in domain terms. requestId is also the provider's idempotency key, so a retried call is applied
 * once. Never log this object: it holds a document number and a selfie.
 */
export type VerifyIdentityCommand = {
  readonly requestId: string;
  readonly documentNumber: string;
  readonly selfie: Buffer;
};

export type VerifyIdentityResult = {
  readonly decision: KycDecision;
  readonly score: number;
  readonly providerReference: string;
};
```
