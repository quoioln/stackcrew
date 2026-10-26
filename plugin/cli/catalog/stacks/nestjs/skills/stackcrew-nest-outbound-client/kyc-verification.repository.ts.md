Goes to `src/modules/kyc/kyc-verification.repository.ts`.

```ts
// Default location: src/modules/kyc/kyc-verification.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { TenantScopedRepository } from '../../common/database/tenant-scoped.repository';
import { KycVerification, KycVerificationStatus } from './entities/kyc-verification.entity';

const ID_COLUMN = 'id';
/** kyc_verification_pending_key: its columns and its predicate, as the migration creates it. */
const PENDING_KEY_COLUMNS = ['{{sc:tenantColumn}}', 'profileId'];
const PENDING_KEY_PREDICATE = `"status" = '${KycVerificationStatus.PENDING}'`;
/** The column the conflict update writes: the audit actor (TypeORM adds updatedAt = DEFAULT). */
const TOUCHED_COLUMNS = ['updatedBy'];

/** Services inject this, never Repository<KycVerification>: every query carries the caller's tenant. */
@Injectable()
export class KycVerificationRepository extends TenantScopedRepository<KycVerification> {
  constructor(@InjectRepository(KycVerification) repository: Repository<KycVerification>) {
    super(repository);
  }

  /**
   * The id of the profile's PENDING operation in the caller's tenant: a new row, or the one already pending. One atomic
   * statement on the partial unique index, INSERT ... ON CONFLICT (tenant, profileId) WHERE status = 'PENDING'
   * DO UPDATE ... RETURNING id: a concurrent start waits for the first one's row and gets its id. DO UPDATE (only the
   * audit columns) rather than DO NOTHING, which would return no row. The tenant comes from TenantSubscriber on the
   * insert and is part of the conflict target, so another tenant's row is never touched. Never insert and catch the
   * duplicate-key error.
   */
  async startPending(profileId: string): Promise<string> {
    const result = await this.repository.createQueryBuilder()
      .insert()
      .values(this.create({ profileId, status: KycVerificationStatus.PENDING }))
      .orUpdate(TOUCHED_COLUMNS, PENDING_KEY_COLUMNS, { indexPredicate: PENDING_KEY_PREDICATE })
      .returning([ID_COLUMN])
      .execute();
    const rows: unknown = result.raw; // the RETURNING row: the new one or the pending one
    const row: unknown = Array.isArray(rows) && rows.length === 1 ? rows[0] : undefined;
    const id = typeof row === 'object' && row !== null && ID_COLUMN in row ? row[ID_COLUMN] : undefined;
    if (typeof id !== 'string') {
      throw new Error('kyc_verification insert returned no id');
    }
    return id;
  }
}
```
