Goes to `src/modules/kyc/kyc-verification.errors.ts`.

```ts
// Default location: src/modules/kyc/kyc-verification.errors.ts
import { ApiError } from '../../common/api/api-error';
import type { ErrorDefinition } from '../../common/api/error-codes';

/** The common RESOURCE_NOT_FOUND code and summary with this feature's own seq (100-999), so the errorNumber names the error. */
export const KYC_VERIFICATION_NOT_FOUND = {
  category: 30,
  seq: 201,
  code: 'RESOURCE_NOT_FOUND',
  status: 404,
  summary: 'The resource does not exist',
} as const satisfies ErrorDefinition;

/** The common BUSINESS_CONFLICT code and summary with its own seq: the operation already ended FAILED. */
export const KYC_VERIFICATION_FAILED = {
  category: 40,
  seq: 201,
  code: 'BUSINESS_CONFLICT',
  status: 409,
  summary: 'The request conflicts with the current state',
} as const satisfies ErrorDefinition;

/** No such verification for the caller (another tenant's looks the same): 404 with the fixed summary. */
export class KycVerificationNotFound extends ApiError {
  constructor() {
    super(KYC_VERIFICATION_NOT_FOUND);
  }
}

/** The operation ended FAILED (the provider rejected it): 409. A new check is a new operation, from start(). */
export class KycVerificationFailed extends ApiError {
  constructor() {
    super(KYC_VERIFICATION_FAILED);
  }
}
```
