Goes to `src/modules/kyc/entities/kyc-verification.entity.ts`.

```ts
// Default location: src/modules/kyc/entities/kyc-verification.entity.ts
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { {{sc:baseTenantEntity}} } from '../../../common/database/base-tenant.entity';
import type { KycDecision } from '../interfaces/kyc-verification';

const STATUS_LENGTH = 16;
const DECISION_LENGTH = 16;
const PROVIDER_REFERENCE_LENGTH = 128;

export const KycVerificationStatus = { PENDING: 'PENDING', COMPLETED: 'COMPLETED' } as const;
export type KycVerificationStatus = (typeof KycVerificationStatus)[keyof typeof KycVerificationStatus];

/**
 * One identity check of a customer profile: the business operation. The row is inserted and committed before the
 * provider is called; its id is the provider's idempotency key for every attempt and every retry of the operation.
 */
@Entity('kyc_verification')
@Index('kyc_verification_tenant_profile_idx', ['{{sc:tenantColumn}}', 'profileId'])
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
