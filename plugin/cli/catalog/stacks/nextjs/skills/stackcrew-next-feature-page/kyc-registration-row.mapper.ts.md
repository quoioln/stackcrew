Goes to `src/features/kyc-registrations/kyc-registration-row.mapper.ts`.

```ts
// Default location: src/features/kyc-registrations/kyc-registration-row.mapper.ts
import type { KycRegistrationRowDto } from './kyc-registration-row.dto';
import type { KycRegistration } from './kyc-registration.entity';

/** Field by field, so a column added to the entity later never reaches the browser. */
export function toKycRegistrationRowDto(entity: KycRegistration): KycRegistrationRowDto {
  return { id: entity.id, fullName: entity.fullName, documentType: entity.documentType, status: entity.status, submittedAt: entity.createdAt.toISOString() };
}
```
