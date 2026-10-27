Goes to `src/features/kyc-registrations/kyc-registration.dto.ts`.

```ts
// Default location: src/features/kyc-registrations/kyc-registration.dto.ts
import type { DocumentType, KycRegistrationStatus } from './kyc-registration.constants';

/**
 * What the applicant's browser gets back after registering: the registration's id and state, not the identity data it
 * just sent, no tenant and no audit field. Dates are ISO 8601 strings: a Date does not cross to a Client Component.
 */
export type KycRegistrationDto = {
  readonly id: string;
  readonly documentType: DocumentType;
  readonly status: KycRegistrationStatus;
  readonly submittedAt: string;
};
```
