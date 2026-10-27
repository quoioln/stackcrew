Goes to `src/features/kyc-registrations/data.ts`.

```ts
// Default location: src/features/kyc-registrations/data.ts
import 'server-only';
import { ActionErrorCode, fail, ok, type ActionResult } from '../../shared/action-result';
import { getRequestContext, runInRequestContext } from '../../shared/context/session-context';
import { pageOf, pageWindow, type PageDto, type PageQuery } from '../../shared/pagination';
import type { KycRegistrationRowDto } from './kyc-registration-row.dto';
import { toKycRegistrationRowDto } from './kyc-registration-row.mapper';
import { KycRole } from './kyc-registration.constants';
import { kycRegistrations } from './kyc-registration.repository';

/**
 * One page of the tenant's registrations for a reviewer, newest first (the id breaks ties, so pages never overlap).
 * Shared by the page (through loadKycRegistrationPage) and GET /api/v1/kyc-registrations, and never wrapped itself.
 * The tenant repository adds the caller's tenant to the find and to the count: another tenant's rows never appear.
 */
export async function listKycRegistrations(query: PageQuery): Promise<ActionResult<PageDto<KycRegistrationRowDto>>> {
  const caller = await getRequestContext();
  if (caller.userId === undefined) {
    return fail(ActionErrorCode.UNAUTHENTICATED);
  }
  if (caller.tenantId === undefined || !caller.roles.includes(KycRole.REVIEWER)) {
    return fail(ActionErrorCode.FORBIDDEN);
  }
  const registrations = await kycRegistrations();
  const [rows, total] = await Promise.all([
    registrations.find({ order: { createdAt: 'DESC', id: 'DESC' }, ...pageWindow(query) }),
    registrations.count(),
  ]);
  return ok(pageOf(rows.map(toKycRegistrationRowDto), query, total));
}

/**
 * The page's loader: the same list inside the request context of the render (auth() once per request), which the
 * tenant repository and the audit subscriber read. Without runInRequestContext the repository throws MissingTenantError.
 */
export function loadKycRegistrationPage(query: PageQuery): Promise<ActionResult<PageDto<KycRegistrationRowDto>>> {
  return runInRequestContext(() => listKycRegistrations(query));
}
```
