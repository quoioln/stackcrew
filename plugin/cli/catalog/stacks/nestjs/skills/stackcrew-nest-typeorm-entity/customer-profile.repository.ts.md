Goes to `src/modules/customer-profiles/customer-profile.repository.ts`.

```ts
// Default location: src/modules/customer-profiles/customer-profile.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { TenantScopedRepository } from '../../common/database/tenant-scoped.repository';
import { CustomerProfile } from './entities/customer-profile.entity';

/** Services inject this, never Repository<CustomerProfile>. */
@Injectable()
export class CustomerProfileRepository extends TenantScopedRepository<CustomerProfile> {
  constructor(@InjectRepository(CustomerProfile) repository: Repository<CustomerProfile>) {
    super(repository);
  }
}
```
