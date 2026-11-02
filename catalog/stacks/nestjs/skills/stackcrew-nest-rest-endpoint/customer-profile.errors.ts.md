Goes to `src/modules/customer-profiles/customer-profile.errors.ts`.

```ts
// Default location: src/modules/customer-profiles/customer-profile.errors.ts
import { ApiError } from '../../common/api/api-error';
import type { ErrorDefinition } from '../../common/api/error-codes';

/**
 * The domain row: the common code and summary of RESOURCE_NOT_FOUND (category 30) with this feature's own seq, so the
 * errorNumber names the error (SSCCNNN, seq 100-999) while the frontend translates the same code.
 */
export const CUSTOMER_PROFILE_NOT_FOUND = {
  category: 30,
  seq: 101,
  code: 'RESOURCE_NOT_FOUND',
  status: 404,
  summary: 'The resource does not exist',
} as const satisfies ErrorDefinition;

/**
 * No such profile for the caller. Another tenant's profile looks exactly the same (the repository finds nothing), so
 * a caller cannot probe for ids. AllExceptionsFilter answers 404 with the error envelope of CUSTOMER_PROFILE_NOT_FOUND.
 */
export class CustomerProfileNotFound extends ApiError {
  constructor() {
    super(CUSTOMER_PROFILE_NOT_FOUND);
  }
}
```
