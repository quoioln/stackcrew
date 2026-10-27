Goes to `src/app/api/v1/kyc-registrations/route.ts`.

```ts
// Default location: src/app/api/v1/kyc-registrations/route.ts
import { revalidatePath } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { listKycRegistrations } from '../../../../features/kyc-registrations/data';
import type { KycRegistrationRowDto } from '../../../../features/kyc-registrations/kyc-registration-row.dto';
import { KycPath, KycRole } from '../../../../features/kyc-registrations/kyc-registration.constants';
import type { KycRegistrationDto } from '../../../../features/kyc-registrations/kyc-registration.dto';
import { submitKycRegistration } from '../../../../features/kyc-registrations/kyc-registration.service';
import { HTTP_STATUS, problemForRefusal, problemResponse, ProblemText, toFieldErrors } from '../../../../shared/http/problem-details';
import { readJsonBody } from '../../../../shared/http/read-json-body';
import { requireCaller } from '../../../../shared/http/require-caller';
import { withRouteLogging } from '../../../../shared/logging/with-route-logging';
import { pageQuerySchema, type PageDto } from '../../../../shared/pagination';

/**
 * GET ?page=&size=: one page of the tenant's registrations, for reviewers. The query is parsed strictly here: a bad
 * value is a 400 with the field, never a silent first page. The caller is checked first (401, 403), then the input.
 */
export const GET = withRouteLogging('/api/v1/kyc-registrations', async (req: NextRequest) => {
  const access = await requireCaller(KycRole.REVIEWER);
  if (!access.ok) {
    return access.response;
  }
  const query = pageQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!query.success) {
    return problemResponse(HTTP_STATUS.BAD_REQUEST, ProblemText.INVALID_REQUEST, toFieldErrors(query.error.flatten().fieldErrors));
  }
  const result = await listKycRegistrations(query.data);
  return result.ok ? NextResponse.json<PageDto<KycRegistrationRowDto>>(result.data) : problemForRefusal(result.error);
});

/**
 * POST a registration of the caller's own identity (a mobile app, another client): the same function as the server
 * action registerKyc, so the checks, the schema and the CONFLICT rule are one. 201 with the DTO, or a problem. The
 * caller is checked before the body is read: an anonymous caller gets 401, whatever it sent.
 */
export const POST = withRouteLogging('/api/v1/kyc-registrations', async (req: NextRequest) => {
  const access = await requireCaller(KycRole.APPLICANT);
  if (!access.ok) {
    return access.response;
  }
  const body = await readJsonBody(req);
  if (!body.ok) {
    return body.response;
  }
  const result = await submitKycRegistration(body.value);
  if (!result.ok) {
    return problemForRefusal(result.error);
  }
  revalidatePath(KycPath.REGISTRATIONS);
  return NextResponse.json<KycRegistrationDto>(result.data, { status: HTTP_STATUS.CREATED });
});
```
