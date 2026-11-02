Goes to `src/modules/customer-profiles/customer-profile.mapper.ts`.

```ts
// Default location: src/modules/customer-profiles/customer-profile.mapper.ts
import { plainToInstance } from 'class-transformer';
import { toPageData } from '../../common/api/api-response';
import type { CustomerProfilePageResponse } from './dto/customer-profile-page.response';
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

/** The rows of one page and the total count of the same filter; page and size are the (capped) values of the query. */
export function toCustomerProfilePage(entities: readonly CustomerProfile[], totalElements: number, query: ListCustomerProfilesQuery): CustomerProfilePageResponse {
  return toPageData(entities.map((entity) => toCustomerProfileResponse(entity)), query.page, query.size, totalElements);
}
```
