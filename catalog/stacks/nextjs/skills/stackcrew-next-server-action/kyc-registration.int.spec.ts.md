Goes to `src/features/kyc-registrations/kyc-registration.int.spec.ts`.

```ts
// Default location: src/features/kyc-registrations/kyc-registration.int.spec.ts
// Runs with vitest.int.config.ts against the test database of DATABASE_URL (Postgres in Docker): the real action,
// wrapper, service, repository, subscribers and unique constraint. Only the session, the headers and the cache are faked.
import { headers } from 'next/headers';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { auth } from '../../auth';
import { ActionErrorCode, fail } from '../../shared/action-result';
import { runAsSystem, runCrossTenant } from '../../shared/context/request-context';
import { getDataSource } from '../../shared/db/data-source';
import { registerKyc } from './actions';
import { KycRegistration } from './kyc-registration.entity';
import { KycRegistrationRepository } from './kyc-registration.repository';

vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../auth', () => ({ auth: vi.fn() }));

const INPUT = { fullName: 'Nguyen Van A', dateOfBirth: '1990-04-12', documentType: 'NATIONAL_ID', idNumber: '079090001234' };
const authMock = auth as unknown as Mock<() => Promise<unknown>>;
const signIn = (id: string, tenantId: string): void => {
  authMock.mockResolvedValue({ user: { id, tenantId, roles: ['kyc_applicant'] }, expires: '2099-01-01T00:00:00.000Z' });
};

describe('registerKyc on Postgres', () => {
  let dataSource: DataSource;

  /** Every registration of every tenant, read the way a job reads: runAsSystem, then runCrossTenant (read only). */
  const allRows = (): Promise<KycRegistration[]> =>
    runAsSystem(undefined, () => runCrossTenant('test assertion', () => new KycRegistrationRepository(dataSource.getRepository(KycRegistration)).find()));

  beforeAll(async () => {
    dataSource = await getDataSource(); // the app's DataSource: entities, subscribers and migrations by class
    await dataSource.runMigrations();
  });

  beforeEach(async () => {
    vi.mocked(headers).mockResolvedValue(new Headers());
    await dataSource.getRepository(KycRegistration).clear();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('stores the registration in the caller\'s tenant, as the caller, with the audit fields', async () => {
    signIn('alice', 'tenant-a');

    const result = await registerKyc(INPUT);

    expect(result.ok).toBe(true);
    const [row] = await allRows();
    expect(row).toMatchObject({ ...INPUT, applicantId: 'alice', status: 'PENDING', {{sc:tenantColumn}}: 'tenant-a', createdBy: 'alice', updatedBy: 'alice' });
    expect(result.ok && result.data.id).toBe(row?.id);
  });

  it('answers CONFLICT to a second registration of the same applicant and keeps the first', async () => {
    signIn('alice', 'tenant-a');
    await registerKyc(INPUT);

    expect(await registerKyc({ ...INPUT, fullName: 'Someone Else' })).toEqual(fail(ActionErrorCode.CONFLICT));
    expect((await allRows()).map((r) => r.fullName)).toEqual([INPUT.fullName]);
  });

  it('lets exactly one of two concurrent submits through: the unique constraint decides, not a read', async () => {
    signIn('alice', 'tenant-a');

    const results = await Promise.all([registerKyc(INPUT), registerKyc(INPUT)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([fail(ActionErrorCode.CONFLICT)]);
    expect(await allRows()).toHaveLength(1);
  });

  it('scopes the uniqueness to the tenant: the same user id registers once in each tenant', async () => {
    signIn('alice', 'tenant-a');
    await registerKyc(INPUT);
    signIn('alice', 'tenant-b');

    expect((await registerKyc(INPUT)).ok).toBe(true);
    expect((await allRows()).map((r) => r.{{sc:tenantColumn}}).sort()).toEqual(['tenant-a', 'tenant-b']);
  });
});
```
