Goes to `src/modules/customer-profiles/customer-profile.mapper.ts`.

```ts
// Default location: src/modules/customer-profiles/customer-profile.mapper.ts
import { plainToInstance } from 'class-transformer';
import { CustomerProfilePageResponse } from './dto/customer-profile-page.response';
import { CustomerProfileResponse } from './dto/customer-profile.response';
import type { ListCustomerProfilesQuery } from './dto/list-customer-profiles.query';
import type { CustomerProfile } from './entities/customer-profile.entity';

/**
 * Entity to API shape, in one place. excludeExtraneousValues copies only the @Expose() fields of the response DTO: the
 * tenant, the audit fields, deletedAt and any column added later stay in the service layer.
 */
export function toCustomerProfileResponse(entity: CustomerProfile): CustomerProfileResponse {
  return plainToInstance(CustomerProfileResponse, entity, { excludeExtraneousValues: true });
}

export function toCustomerProfilePage(entities: readonly CustomerProfile[], total: number, query: ListCustomerProfilesQuery): CustomerProfilePageResponse {
  const items = entities.map((entity) => toCustomerProfileResponse(entity));
  return plainToInstance(CustomerProfilePageResponse, { items, page: query.page, size: query.size, total }, { excludeExtraneousValues: true });
}
```
