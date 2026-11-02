Goes to `src/modules/customer-profiles/dto/customer-profile-page.response.ts`.

```ts
// Default location: src/modules/customer-profiles/dto/customer-profile-page.response.ts
import type { PageData } from '../../../common/api/api-response';
import type { CustomerProfileResponse } from './customer-profile.response';

/**
 * One page of profiles: `items` and `pagination` (0-based page, size, totalElements, totalPages, hasNext, hasPrevious).
 * Built by toPageData in the mapper; the interceptor puts it in the envelope's `data`. The OpenAPI document gets the
 * same shape from `@ApiEnvelopeResponse(CustomerProfileResponse, { page: true })`. Never an unbounded list.
 */
export type CustomerProfilePageResponse = PageData<CustomerProfileResponse>;
```
