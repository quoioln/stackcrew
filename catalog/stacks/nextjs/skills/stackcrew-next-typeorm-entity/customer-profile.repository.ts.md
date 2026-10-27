Goes to `src/features/customer-profiles/customer-profile.repository.ts`.

```ts
// Default location: src/features/customer-profiles/customer-profile.repository.ts
import 'server-only';
import { getDataSource } from '../../shared/db/data-source';
import { TenantScopedRepository } from '../../shared/db/tenant-scoped.repository';
import { CustomerProfile } from './customer-profile.entity';

/** Server code uses this, never Repository<CustomerProfile>: every query carries the caller's tenant. */
export class CustomerProfileRepository extends TenantScopedRepository<CustomerProfile> {}

/** The repository on the process's DataSource: `const profiles = await customerProfiles();` in a data loader or action. */
export async function customerProfiles(): Promise<CustomerProfileRepository> {
  return new CustomerProfileRepository((await getDataSource()).getRepository(CustomerProfile));
}
```
