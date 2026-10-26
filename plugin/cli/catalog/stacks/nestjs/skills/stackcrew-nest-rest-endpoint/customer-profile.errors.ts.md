Goes to `src/modules/customer-profiles/customer-profile.errors.ts`.

```ts
// Default location: src/modules/customer-profiles/customer-profile.errors.ts
import { HttpStatus } from '@nestjs/common';
import { ProblemError } from '../../common/errors/problem-details';

/**
 * No such profile for the caller. Another tenant's profile looks exactly the same (the repository finds nothing), so
 * a caller cannot probe for ids. AllExceptionsFilter answers 404 application/problem+json with this constant detail.
 */
export class CustomerProfileNotFound extends ProblemError {
  readonly status = HttpStatus.NOT_FOUND;
  readonly detail = 'The customer profile does not exist.';
}
```
