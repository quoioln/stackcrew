Goes to `src/modules/kyc/kyc-verification.repository.ts`.

```ts
// Default location: src/modules/kyc/kyc-verification.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { TenantScopedRepository } from '../../common/database/tenant-scoped.repository';
import { KycVerification } from './entities/kyc-verification.entity';

/** Services inject this, never Repository<KycVerification>: every query carries the caller's tenant. */
@Injectable()
export class KycVerificationRepository extends TenantScopedRepository<KycVerification> {
  constructor(@InjectRepository(KycVerification) repository: Repository<KycVerification>) {
    super(repository);
  }
}
```
