Goes to `src/features/kyc-registrations/kyc-registration-row.dto.ts`.

```ts
// Default location: src/features/kyc-registrations/kyc-registration-row.dto.ts
import type { DocumentType, KycRegistrationStatus } from './kyc-registration.constants';

/**
 * One row of the reviewers' list: only what the table shows. The document number, the date of birth, the tenant and
 * the audit fields stay on the server (data minimization); a detail page that needs them gets its own DTO.
 */
export type KycRegistrationRowDto = {
  readonly id: string;
  readonly fullName: string;
  readonly documentType: DocumentType;
  readonly status: KycRegistrationStatus;
  readonly submittedAt: string;
};
```
