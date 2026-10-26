Goes to `src/modules/kyc/kyc-verification.errors.ts`.

```ts
// Default location: src/modules/kyc/kyc-verification.errors.ts
import { HttpStatus } from '@nestjs/common';
import { ProblemError } from '../../common/errors/problem-details';

/** No such verification for the caller (another tenant's looks the same): 404 with a constant detail. */
export class KycVerificationNotFound extends ProblemError {
  readonly status = HttpStatus.NOT_FOUND;
  readonly detail = 'The verification does not exist.';
}
```
