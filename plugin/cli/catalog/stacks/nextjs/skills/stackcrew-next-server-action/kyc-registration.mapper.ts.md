Goes to `src/features/kyc-registrations/kyc-registration.mapper.ts`.

```ts
// Default location: src/features/kyc-registrations/kyc-registration.mapper.ts
import type { KycRegistrationDto } from './kyc-registration.dto';
import type { KycRegistration } from './kyc-registration.entity';

/** The one place that knows both shapes. Copies field by field, so a column added later never leaks. */
export function toKycRegistrationDto(entity: KycRegistration): KycRegistrationDto {
  return { id: entity.id, documentType: entity.documentType, status: entity.status, submittedAt: entity.createdAt.toISOString() };
}
```
