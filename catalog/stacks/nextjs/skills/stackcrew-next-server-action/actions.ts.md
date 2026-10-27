Goes to `src/features/kyc-registrations/actions.ts`.

```ts
// Default location: src/features/kyc-registrations/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '../../shared/action-result';
import { withActionLogging } from '../../shared/logging/with-action-logging';
import { KycPath } from './kyc-registration.constants';
import type { KycRegistrationDto } from './kyc-registration.dto';
import { submitKycRegistration } from './kyc-registration.service';

/**
 * Every exported action is a public POST endpoint: submitKycRegistration checks the caller, the role and the input
 * itself, whatever the page around the form checked. The input is `unknown`: the form sends the schema's shape, but
 * anyone can call the action with anything. This file exports wrapped async actions only, and declares no type.
 */
export const registerKyc = withActionLogging('registerKyc', async (input: unknown): Promise<ActionResult<KycRegistrationDto>> => {
  const result = await submitKycRegistration(input);
  if (result.ok) {
    revalidatePath(KycPath.REGISTRATIONS); // the reviewers' list shows the new registration on its next render
  }
  return result;
});
```
