Goes to `src/features/kyc-registrations/kyc-registration.service.ts`.

```ts
// Default location: src/features/kyc-registrations/kyc-registration.service.ts
import 'server-only';
import { ActionErrorCode, fail, ok, type ActionResult } from '../../shared/action-result';
import { getRequestContext } from '../../shared/context/session-context';
import { KycRegistrationStatus, KycRole } from './kyc-registration.constants';
import type { KycRegistrationDto } from './kyc-registration.dto';
import { toKycRegistrationDto } from './kyc-registration.mapper';
import { kycRegistrations } from './kyc-registration.repository';
import { registerKycSchema } from './schemas/register-kyc.schema';

/**
 * Registers the caller's own identity for eKYC. It is the body of the registerKyc server action and of
 * POST /api/v1/kyc-registrations: each entry point wraps it with its own logging wrapper, so it is never wrapped
 * itself (one http_in line per call). It checks, in this order: signed in, allowed (a tenant and the applicant role),
 * valid input; then one insert. Every refusal is a typed result; only an unexpected failure throws.
 */
export async function submitKycRegistration(input: unknown): Promise<ActionResult<KycRegistrationDto>> {
  const caller = await getRequestContext(); // the wrapper's context, built from auth() once per call
  if (caller.userId === undefined) {
    return fail(ActionErrorCode.UNAUTHENTICATED);
  }
  if (caller.tenantId === undefined || !caller.roles.includes(KycRole.APPLICANT)) {
    return fail(ActionErrorCode.FORBIDDEN); // checked before the repository, which would throw MissingTenantError (a 500)
  }
  const parsed = registerKycSchema.safeParse(input);
  if (!parsed.success) {
    return fail(ActionErrorCode.VALIDATION, parsed.error.flatten().fieldErrors);
  }
  const registrations = await kycRegistrations();
  const saved = await registrations.insertUnlessRegistered(
    registrations.create({ ...parsed.data, applicantId: caller.userId, status: KycRegistrationStatus.PENDING }),
  );
  return saved === null ? fail(ActionErrorCode.CONFLICT) : ok(toKycRegistrationDto(saved));
}
```
