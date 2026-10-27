Goes to `src/features/kyc-registrations/kyc-registration.repository.ts`.

```ts
// Default location: src/features/kyc-registrations/kyc-registration.repository.ts
import 'server-only';
import { QueryFailedError } from 'typeorm';
import { getDataSource } from '../../shared/db/data-source';
import { TenantScopedRepository } from '../../shared/db/tenant-scoped.repository';
import { KycRegistration } from './kyc-registration.entity';

/** Postgres SQLSTATE unique_violation. */
const UNIQUE_VIOLATION = '23505';
const APPLICANT_KEY = 'kyc_registration_applicant_key';

/** Server code uses this, never Repository<KycRegistration>: every query carries the caller's tenant. */
export class KycRegistrationRepository extends TenantScopedRepository<KycRegistration> {
  /**
   * Inserts a new registration, or returns null when the applicant already has one in this tenant: the unique
   * constraint decides, also between two concurrent submits. Every other failure is rethrown unchanged.
   */
  async insertUnlessRegistered(registration: KycRegistration): Promise<KycRegistration | null> {
    try {
      return await this.save(registration);
    } catch (failure: unknown) {
      if (isUniqueViolation(failure, APPLICANT_KEY)) {
        return null;
      }
      throw failure;
    }
  }
}

/** The repository on the DataSource of this server layer: `const registrations = await kycRegistrations();`. */
export async function kycRegistrations(): Promise<KycRegistrationRepository> {
  return new KycRegistrationRepository((await getDataSource()).getRepository(KycRegistration));
}

/** True only for a violation of that one constraint: another unique index failing is a bug, not a repeat. */
function isUniqueViolation(failure: unknown, constraint: string): boolean {
  if (!(failure instanceof QueryFailedError)) {
    return false;
  }
  const driverError: unknown = failure.driverError;
  return typeof driverError === 'object' && driverError !== null
    && 'code' in driverError && driverError.code === UNIQUE_VIOLATION
    && 'constraint' in driverError && driverError.constraint === constraint;
}
```
