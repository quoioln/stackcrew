Goes to `src/modules/customer-profiles/entities/customer-profile.entity.ts`.

```ts
// Default location: src/modules/customer-profiles/entities/customer-profile.entity.ts
import { Column, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { {{sc:baseTenantEntity}} } from '../../../common/database/base-tenant.entity';

export const REFERENCE_LENGTH = 64;
export const FULL_NAME_LENGTH = 200;
const STATUS_LENGTH = 16;

export const CustomerProfileStatus = { PENDING: 'PENDING', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED' } as const;
export type CustomerProfileStatus = (typeof CustomerProfileStatus)[keyof typeof CustomerProfileStatus];

@Entity('customer_profile')
@Index('customer_profile_tenant_idx', ['{{sc:tenantColumn}}'])
export class CustomerProfile extends {{sc:baseTenantEntity}} {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'customer_profile_pkey' })
  readonly id!: string;

  @Column({ length: REFERENCE_LENGTH })
  reference!: string;

  @Column({ length: FULL_NAME_LENGTH })
  fullName!: string;

  @Column({ type: 'varchar', length: STATUS_LENGTH })
  status!: CustomerProfileStatus;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  readonly deletedAt!: Date | null;
}
```
