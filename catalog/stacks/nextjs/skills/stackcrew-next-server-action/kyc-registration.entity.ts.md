Goes to `src/features/kyc-registrations/kyc-registration.entity.ts`.

```ts
// Default location: src/features/kyc-registrations/kyc-registration.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { {{sc:baseTenantEntity}} } from '../../shared/db/base-tenant.entity';
import { APPLICANT_ID_MAX, FULL_NAME_MAX, ID_NUMBER_MAX, type DocumentType, type KycRegistrationStatus } from './kyc-registration.constants';

const CODE_LENGTH = 16;

/**
 * One eKYC registration per applicant and tenant. The unique constraint decides a repeat (the action answers CONFLICT),
 * never a read before the insert, so two concurrent submits cannot both pass. Server-only data: it never reaches a
 * Client Component, an action result or a route response; map it to a DTO first. Its constants live in
 * kyc-registration.constants.ts, which the browser may load; this file it must not.
 */
@Entity('kyc_registration')
@Unique('kyc_registration_applicant_key', ['{{sc:tenantColumn}}', 'applicantId'])
@Index('kyc_registration_tenant_created_idx', ['{{sc:tenantColumn}}', 'createdAt'])
export class KycRegistration extends {{sc:baseTenantEntity}} {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'kyc_registration_pkey' })
  readonly id!: string;

  /** The applicant's user id (the identity provider's `sub`), taken from the request context, never from the form. */
  @Column({ type: 'varchar', length: APPLICANT_ID_MAX })
  applicantId!: string;

  @Column({ type: 'varchar', length: FULL_NAME_MAX })
  fullName!: string;

  /** A calendar day: Postgres `date`, read back as the 'YYYY-MM-DD' string, with no time zone to shift it. */
  @Column({ type: 'date' })
  dateOfBirth!: string;

  @Column({ type: 'varchar', length: CODE_LENGTH })
  documentType!: DocumentType;

  @Column({ type: 'varchar', length: ID_NUMBER_MAX })
  idNumber!: string;

  @Column({ type: 'varchar', length: CODE_LENGTH })
  status!: KycRegistrationStatus;
}
```
