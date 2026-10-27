Goes to `src/features/customer-profiles/customer-profile.entity.ts`.

```ts
// Default location: src/features/customer-profiles/customer-profile.entity.ts
import { Column, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { {{sc:baseTenantEntity}} } from '../../shared/db/base-tenant.entity';

export const REFERENCE_LENGTH = 64;
export const FULL_NAME_LENGTH = 200;
const STATUS_LENGTH = 16;

export const CustomerProfileStatus = { PENDING: 'PENDING', VERIFIED: 'VERIFIED', REJECTED: 'REJECTED' } as const;
export type CustomerProfileStatus = (typeof CustomerProfileStatus)[keyof typeof CustomerProfileStatus];

/**
 * Server-only data: it never reaches a Client Component, an action result or a route handler response; map it to a
 * DTO first. The table, index and constraint names are explicit, because the production build minifies class names.
 */
@Entity('customer_profile')
@Index('customer_profile_tenant_idx', ['{{sc:tenantColumn}}'])
export class CustomerProfile extends {{sc:baseTenantEntity}} {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'customer_profile_pkey' })
  readonly id!: string;

  @Column({ type: 'varchar', length: REFERENCE_LENGTH })
  reference!: string;

  @Column({ type: 'varchar', length: FULL_NAME_LENGTH })
  fullName!: string;

  @Column({ type: 'varchar', length: STATUS_LENGTH })
  status!: CustomerProfileStatus;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  readonly deletedAt!: Date | null;
}
```
