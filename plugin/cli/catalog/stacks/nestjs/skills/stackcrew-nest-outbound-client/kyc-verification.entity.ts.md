Goes to `src/modules/kyc/entities/kyc-verification.entity.ts`.

```ts
// Default location: src/modules/kyc/entities/kyc-verification.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { {{sc:baseTenantEntity}} } from '../../../common/database/base-tenant.entity';
import type { KycDecision } from '../interfaces/kyc-verification';

const STATUS_LENGTH = 16;
const DECISION_LENGTH = 16;
const PROVIDER_REFERENCE_LENGTH = 128;

export const KycVerificationStatus = { PENDING: 'PENDING', COMPLETED: 'COMPLETED', FAILED: 'FAILED' } as const;
export type KycVerificationStatus = (typeof KycVerificationStatus)[keyof typeof KycVerificationStatus];

/**
 * One identity check of a customer profile: the business operation. The row is inserted and committed before the
 * provider is called; its id is the provider's idempotency key for every attempt and every retry of the operation.
 * A profile has at most one PENDING operation per tenant (kyc_verification_pending_key), so a repeated start gets the
 * same one. COMPLETED and FAILED are terminal: a new check of the profile is a new operation with a new key.
 */
@Entity('kyc_verification')
@Index('kyc_verification_tenant_profile_idx', ['{{sc:tenantColumn}}', 'profileId'])
@Index('kyc_verification_pending_key', ['{{sc:tenantColumn}}', 'profileId'], { unique: true, where: `"status" = 'PENDING'` })
export class KycVerification extends {{sc:baseTenantEntity}} {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'kyc_verification_pkey' })
  readonly id!: string;

  @Column({ type: 'uuid' })
  profileId!: string;

  @Column({ type: 'varchar', length: STATUS_LENGTH })
  status!: KycVerificationStatus;

  @Column({ type: 'varchar', length: DECISION_LENGTH, nullable: true })
  decision!: KycDecision | null;

  @Column({ type: 'varchar', length: PROVIDER_REFERENCE_LENGTH, nullable: true })
  providerReference!: string | null;
}
```
