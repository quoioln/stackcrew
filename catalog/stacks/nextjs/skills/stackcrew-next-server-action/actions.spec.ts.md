Goes to `src/features/kyc-registrations/actions.spec.ts`.

```ts
// Default location: src/features/kyc-registrations/actions.spec.ts
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { auth } from '../../auth';
import { ActionErrorCode, fail, ok } from '../../shared/action-result';
import { logger } from '../../shared/logging/logger';
import { registerKyc } from './actions';
import { KycPath, KycRegistrationStatus } from './kyc-registration.constants';
import type { KycRegistration } from './kyc-registration.entity';
import { kycRegistrations, type KycRegistrationRepository } from './kyc-registration.repository';

// The boundaries only: the session, the request headers, Next.js's cache and the repository. The action, the wrapper,
// the service, the schema, the mapper and the masker run for real.
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../auth', () => ({ auth: vi.fn() }));
vi.mock('./kyc-registration.repository', () => ({ kycRegistrations: vi.fn() }));

type Written = { level: string; line: Record<string, unknown> };
type FakeRepository = { [K in 'create' | 'insertUnlessRegistered']: Mock<KycRegistrationRepository[K]> };

const INPUT = { fullName: 'Nguyen Van A', dateOfBirth: '1990-04-12', documentType: 'NATIONAL_ID', idNumber: '079090001234' };
const SUBMITTED_AT = new Date('2026-10-27T03:00:00.000Z');
const authMock = auth as unknown as Mock<() => Promise<unknown>>; // next-auth's auth() is overloaded
const session = (id: string, tenantId: string | undefined, roles: string[]): unknown => ({ user: { id, tenantId, roles }, expires: '2099-01-01T00:00:00.000Z' });

describe('registerKyc', () => {
  let written: Written[];
  let repository: FakeRepository;

  const httpIn = (): Written[] => written.filter((w) => w.line.event === 'http_in');
  const signIn = (who: unknown): void => {
    authMock.mockResolvedValue(who);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    written = [];
    for (const level of ['info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation((line: unknown) => {
        if (typeof line === 'object' && line !== null) {
          written.push({ level, line: { ...line } });
        }
      });
    }
    vi.mocked(headers).mockResolvedValue(new Headers({ 'x-request-id': 'req-kyc' }));
    repository = {
      create: vi.fn<KycRegistrationRepository['create']>((data) => data as KycRegistration),
      insertUnlessRegistered: vi.fn<KycRegistrationRepository['insertUnlessRegistered']>(async (registration) => ({ ...registration, id: 'reg-1', createdAt: SUBMITTED_AT }) as KycRegistration),
    };
    vi.mocked(kycRegistrations).mockResolvedValue(repository as unknown as KycRegistrationRepository);
    signIn(session('alice', 'tenant-a', ['kyc_applicant']));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the caller as the applicant and returns the DTO, never the identity data', async () => {
    const result = await registerKyc({ ...INPUT, applicantId: 'mallory', status: KycRegistrationStatus.VERIFIED });

    expect(result).toEqual(ok({ id: 'reg-1', documentType: 'NATIONAL_ID', status: 'PENDING', submittedAt: '2026-10-27T03:00:00.000Z' }));
    expect(repository.create).toHaveBeenCalledWith({ ...INPUT, applicantId: 'alice', status: KycRegistrationStatus.PENDING });
    expect(revalidatePath).toHaveBeenCalledWith(KycPath.REGISTRATIONS);
  });

  it('writes one http_in line with the identity data masked', async () => {
    await registerKyc(INPUT);

    expect(httpIn()).toHaveLength(1);
    expect(httpIn()[0]).toMatchObject({
      level: 'info',
      line: {
        method: 'POST', route: 'action:registerKyc', status: 200, requestId: 'req-kyc', userId: 'alice', tenantId: 'tenant-a',
        reqBody: '{"fullName":"***","dateOfBirth":"***","documentType":"NATIONAL_ID","idNumber":"***"}',
      },
    });
  });

  it('answers UNAUTHENTICATED without a session, and touches nothing', async () => {
    signIn(null);

    expect(await registerKyc(INPUT)).toEqual(fail(ActionErrorCode.UNAUTHENTICATED));
    expect(kycRegistrations).not.toHaveBeenCalled();
    expect(httpIn()[0]?.line).toMatchObject({ status: 401, error: 'UNAUTHENTICATED' });
  });

  it('answers FORBIDDEN without the applicant role or without a tenant, before the repository', async () => {
    signIn(session('bob', 'tenant-a', ['kyc_reviewer']));
    expect(await registerKyc(INPUT)).toEqual(fail(ActionErrorCode.FORBIDDEN));
    signIn(session('carol', undefined, ['kyc_applicant']));
    expect(await registerKyc(INPUT)).toEqual(fail(ActionErrorCode.FORBIDDEN));

    expect(kycRegistrations).not.toHaveBeenCalled();
    expect(httpIn().map((w) => w.line.status)).toEqual([403, 403]);
  });

  it('answers VALIDATION with the field errors of the schema, and writes nothing', async () => {
    const result = await registerKyc({ ...INPUT, dateOfBirth: '2001-02-30', documentType: 'DRIVER' });

    expect(result).toMatchObject({ ok: false, error: { code: ActionErrorCode.VALIDATION, fieldErrors: { dateOfBirth: [expect.any(String)], documentType: [expect.any(String)] } } });
    expect(JSON.stringify(result)).not.toContain('DRIVER');
    expect(repository.insertUnlessRegistered).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(httpIn()[0]?.line).toMatchObject({ status: 400, error: 'VALIDATION' });
  });

  it('answers CONFLICT when the applicant already registered in this tenant', async () => {
    repository.insertUnlessRegistered.mockResolvedValue(null);

    expect(await registerKyc(INPUT)).toEqual(fail(ActionErrorCode.CONFLICT));
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(httpIn()[0]?.line).toMatchObject({ status: 409, error: 'CONFLICT' });
  });

  it('rethrows an unexpected failure unchanged, logged once as a 500 without its message', async () => {
    const failure = new RangeError('connection lost for idNumber 079090001234');
    repository.insertUnlessRegistered.mockRejectedValue(failure);

    await expect(registerKyc(INPUT)).rejects.toBe(failure);
    expect(httpIn()).toHaveLength(1);
    expect(httpIn()[0]?.line).toMatchObject({ status: 500, error: 'RangeError' });
    expect(JSON.stringify(written)).not.toContain('079090001234');
  });
});
```
