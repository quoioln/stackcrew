Goes to `src/features/kyc-registrations/data.spec.ts`.

```ts
// Default location: src/features/kyc-registrations/data.spec.ts
import { headers } from 'next/headers';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { auth } from '../../auth';
import { ActionErrorCode, fail } from '../../shared/action-result';
import { currentContext } from '../../shared/context/request-context';
import { pageQueryOrDefault } from '../../shared/pagination';
import { listKycRegistrations, loadKycRegistrationPage } from './data';
import type { KycRegistration } from './kyc-registration.entity';
import { kycRegistrations, type KycRegistrationRepository } from './kyc-registration.repository';

// Boundaries only: the session, the headers and the repository (tenant isolation itself is proven on Postgres by the
// persistence spec of the entity). The loader, the request context and the mapper run for real.
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('../../auth', () => ({ auth: vi.fn() }));
vi.mock('./kyc-registration.repository', () => ({ kycRegistrations: vi.fn() }));

const authMock = auth as unknown as Mock<() => Promise<unknown>>;
const signIn = (id: string, tenantId: string | undefined, roles: string[]): void => {
  authMock.mockResolvedValue({ user: { id, tenantId, roles }, expires: '2099-01-01T00:00:00.000Z' });
};
const ROW = {
  id: 'reg-1', applicantId: 'alice', fullName: 'Nguyen Van A', dateOfBirth: '1990-04-12', documentType: 'PASSPORT', idNumber: 'C1234567',
  status: 'PENDING', tenantId: 'tenant-a', createdBy: 'alice', updatedBy: 'alice', createdAt: new Date('2026-10-27T03:00:00.000Z'), updatedAt: new Date('2026-10-27T03:00:00.000Z'),
} as unknown as KycRegistration;

describe('listKycRegistrations', () => {
  let find: Mock<KycRegistrationRepository['find']>;
  let count: Mock<KycRegistrationRepository['count']>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(headers).mockResolvedValue(new Headers());
    find = vi.fn<KycRegistrationRepository['find']>().mockResolvedValue([ROW]);
    count = vi.fn<KycRegistrationRepository['count']>().mockResolvedValue(41);
    vi.mocked(kycRegistrations).mockResolvedValue({ find, count } as unknown as KycRegistrationRepository);
    signIn('rita', 'tenant-a', ['kyc_reviewer']);
  });

  it('returns a page of row DTOs, newest first, without the identity data the list does not show', async () => {
    const result = await loadKycRegistrationPage(pageQueryOrDefault({ page: '3', size: '20' }));

    expect(result).toEqual({
      ok: true,
      data: { items: [{ id: 'reg-1', fullName: 'Nguyen Van A', documentType: 'PASSPORT', status: 'PENDING', submittedAt: '2026-10-27T03:00:00.000Z' }], page: 3, size: 20, total: 41 },
    });
    expect(find).toHaveBeenCalledWith({ order: { createdAt: 'DESC', id: 'DESC' }, take: 20, skip: 40 });
    expect(JSON.stringify(result)).not.toMatch(/C1234567|1990-04-12|tenant-a|createdBy/);
  });

  it('runs the page loader inside a request context built from the session, and leaves none behind', async () => {
    find.mockImplementation(async () => {
      expect(currentContext()).toMatchObject({ userId: 'rita', tenantId: 'tenant-a' });
      return [];
    });

    await loadKycRegistrationPage(pageQueryOrDefault({}));

    expect(find).toHaveBeenCalledTimes(1);
    expect(currentContext()).toBeUndefined();
  });

  it('answers UNAUTHENTICATED without a session, and FORBIDDEN without the reviewer role or a tenant, before any query', async () => {
    authMock.mockResolvedValue(null);
    expect(await loadKycRegistrationPage(pageQueryOrDefault({}))).toEqual(fail(ActionErrorCode.UNAUTHENTICATED));
    signIn('alice', 'tenant-a', ['kyc_applicant']);
    expect(await loadKycRegistrationPage(pageQueryOrDefault({}))).toEqual(fail(ActionErrorCode.FORBIDDEN));
    signIn('rita', undefined, ['kyc_reviewer']);
    expect(await listKycRegistrations(pageQueryOrDefault({}))).toEqual(fail(ActionErrorCode.FORBIDDEN));

    expect(kycRegistrations).not.toHaveBeenCalled();
  });
});

describe('pageQueryOrDefault', () => {
  it('reads page and size from the search params and falls back to the first page on anything else', () => {
    expect(pageQueryOrDefault({ page: '2', size: '50' })).toEqual({ page: 2, size: 50 });
    for (const params of [{ page: 'abc' }, { page: '0' }, { size: '1000' }, { page: ['1', '2'] }, { page: '1.5' }]) {
      expect(pageQueryOrDefault(params), JSON.stringify(params)).toEqual({ page: 1, size: 20 });
    }
  });
});
```
