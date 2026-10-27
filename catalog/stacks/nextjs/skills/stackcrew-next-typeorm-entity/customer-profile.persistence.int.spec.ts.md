Goes to `src/features/customer-profiles/customer-profile.persistence.int.spec.ts`.

```ts
// Default location: src/features/customer-profiles/customer-profile.persistence.int.spec.ts
// Runs with vitest.int.config.ts against the test database of DATABASE_URL (Postgres in Docker).
import { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contextFromMessageHeaders, CrossTenantDeniedError, MissingTenantError, runAsSystem, runCrossTenant, runWithRequestContext, SYSTEM_USER,
} from '../../shared/context/request-context';
import { dataSourceOptions } from '../../shared/db/data-source.options';
import { CustomerProfile, CustomerProfileStatus } from './customer-profile.entity';
import { CustomerProfileRepository } from './customer-profile.repository';

vi.hoisted(() => {
  process.env.CROSS_TENANT_ROLES = 'report_admin'; // before src/env.ts is imported and validated
});

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

/** Runs fn as a signed-in user, the way withActionLogging and withRouteLogging do for a call. */
const as = <T>(userId: string, tenantId: string | undefined, fn: () => Promise<T>, ...roles: string[]): Promise<T> =>
  runWithRequestContext({ requestId: `test-${userId}`, userId, tenantId, roles }, fn);

describe('CustomerProfile persistence (Postgres)', () => {
  let dataSource: DataSource;
  let profiles: CustomerProfileRepository;
  let rowOfTenantA: string;

  const newProfile = (reference: string): CustomerProfile =>
    profiles.create({ reference, fullName: 'Nguyen Van A', status: CustomerProfileStatus.PENDING });

  beforeAll(async () => {
    dataSource = new DataSource(dataSourceOptions()); // the app's entities, subscribers and migrations
    await dataSource.initialize();
    await dataSource.runMigrations();
    expect((await dataSource.driver.createSchemaBuilder().log()).upQueries).toEqual([]); // the migrations match the entities
    await dataSource.getRepository(CustomerProfile).clear(); // rows a crashed earlier run left behind
    profiles = new CustomerProfileRepository(dataSource.getRepository(CustomerProfile));
  });

  beforeEach(async () => {
    rowOfTenantA = (await as('alice', TENANT_A, () => profiles.save(newProfile('ref-a')))).id;
    await as('bob', TENANT_B, () => profiles.save(newProfile('ref-b')));
  });

  afterEach(() => dataSource.getRepository(CustomerProfile).clear());

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('fills the four audit fields on insert, update and soft delete', async () => {
    const inserted = await as('alice', TENANT_A, () => profiles.findOneBy({ id: rowOfTenantA }));
    expect(inserted).toMatchObject({ createdBy: 'alice', updatedBy: 'alice', {{sc:tenantColumn}}: TENANT_A });
    expect(inserted?.createdAt).toEqual(inserted?.updatedAt);

    await as('bob', TENANT_A, () => profiles.update({ id: rowOfTenantA }, { status: CustomerProfileStatus.VERIFIED }));
    const updated = await as('bob', TENANT_A, () => profiles.findOneBy({ id: rowOfTenantA }));
    expect(updated).toMatchObject({ createdBy: 'alice', updatedBy: 'bob', status: CustomerProfileStatus.VERIFIED });
    expect(updated?.createdAt).toEqual(inserted?.createdAt);
    // updatedAt is set by the database clock; both writes can land in the same millisecond, so equal is allowed
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(inserted?.updatedAt.getTime() ?? Infinity);

    await as('carol', TENANT_A, async () => {
      const loaded = await profiles.findOneBy({ id: rowOfTenantA });
      if (loaded === null) throw new Error('row not found');
      loaded.fullName = 'Tran Thi B';
      await profiles.save(loaded);
    });
    expect(await as('carol', TENANT_A, () => profiles.findOneBy({ id: rowOfTenantA }))).toMatchObject({ updatedBy: 'carol' });

    expect(await as('dave', TENANT_A, () => profiles.softDelete({ id: rowOfTenantA }))).toBe(1);
    const [deleted] = await as('dave', TENANT_A, () => profiles.find({ where: { id: rowOfTenantA }, withDeleted: true }));
    expect(deleted).toMatchObject({ createdBy: 'alice', updatedBy: 'dave' });
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    expect(await as('dave', TENANT_A, () => profiles.findOneBy({ id: rowOfTenantA }))).toBeNull();
  });

  it('writes the system user when there is no user', async () => {
    const saved = await runAsSystem(TENANT_A, () => profiles.save(newProfile('ref-job')));
    expect(saved).toMatchObject({ createdBy: SYSTEM_USER, updatedBy: SYSTEM_USER, {{sc:tenantColumn}}: TENANT_A });
  });

  it('keeps tenant B away from tenant A rows: read, by id, count, update, delete, soft delete, save', async () => {
    await as('bob', TENANT_B, async () => {
      expect((await profiles.find()).map((p) => p.reference)).toEqual(['ref-b']);
      expect(await profiles.count()).toBe(1);
      expect(await profiles.findOneBy({ id: rowOfTenantA })).toBeNull();
      expect(await profiles.update({ id: rowOfTenantA }, { status: CustomerProfileStatus.REJECTED })).toBe(0);
      expect(await profiles.delete({ id: rowOfTenantA })).toBe(0);
      expect(await profiles.softDelete({ id: rowOfTenantA })).toBe(0);
      const hijack = profiles.create({ id: rowOfTenantA, reference: 'hijack', fullName: 'X', status: CustomerProfileStatus.REJECTED });
      await expect(profiles.save(hijack)).rejects.toThrow(CrossTenantDeniedError);
      await expect(dataSource.getRepository(CustomerProfile).findOneBy({ id: rowOfTenantA })).rejects.toThrow(CrossTenantDeniedError);
    });
    const rowA = await as('alice', TENANT_A, () => profiles.findOneBy({ id: rowOfTenantA }));
    expect(rowA).toMatchObject({ reference: 'ref-a', status: CustomerProfileStatus.PENDING, updatedBy: 'alice', deletedAt: null });
  });

  it('keeps tenant B away from tenant A rows inside a transaction too (withManager)', async () => {
    const changed = await as('bob', TENANT_B, () => dataSource.transaction(async (manager) => {
      const scoped = profiles.withManager(manager);
      return [
        await scoped.update({ id: rowOfTenantA }, { status: CustomerProfileStatus.REJECTED }),
        await scoped.delete({ id: rowOfTenantA }),
        await scoped.update({ reference: 'ref-b' }, { status: CustomerProfileStatus.VERIFIED }),
      ];
    }));
    expect(changed).toEqual([0, 0, 1]);
    const rowA = await as('alice', TENANT_A, () => profiles.findOneBy({ id: rowOfTenantA }));
    expect(rowA).toMatchObject({ status: CustomerProfileStatus.PENDING, updatedBy: 'alice' });
    const rowB = await as('bob', TENANT_B, () => profiles.findOneBy({ reference: 'ref-b' }));
    expect(rowB).toMatchObject({ status: CustomerProfileStatus.VERIFIED, updatedBy: 'bob' });

    // withManager writes inside the transaction: a rollback undoes them
    const attempt = as('bob', TENANT_B, () => dataSource.transaction(async (manager) => {
      expect(await profiles.withManager(manager).update({ reference: 'ref-b' }, { status: CustomerProfileStatus.REJECTED })).toBe(1);
      throw new Error('roll back');
    }));
    await expect(attempt).rejects.toThrow('roll back');
    const afterRollback = await as('bob', TENANT_B, () => profiles.findOneBy({ reference: 'ref-b' }));
    expect(afterRollback).toMatchObject({ status: CustomerProfileStatus.VERIFIED, updatedBy: 'bob' });
  });

  it('throws MissingTenantError without a tenant, and never returns unfiltered rows', async () => {
    await expect(profiles.find()).rejects.toThrow(MissingTenantError);
    await as('bob', undefined, async () => {
      await expect(profiles.find()).rejects.toThrow(MissingTenantError);
      await expect(profiles.findOneBy({ id: rowOfTenantA })).rejects.toThrow(MissingTenantError);
      await expect(profiles.save(newProfile('ref-x'))).rejects.toThrow(MissingTenantError);
    });
  });

  it('lets a cross-tenant role read every tenant, read only', async () => {
    await as('carol', TENANT_A, async () => {
      const all = await runCrossTenant('monthly volume report', () => profiles.find());
      expect(all.map((p) => p.{{sc:tenantColumn}}).sort()).toEqual([TENANT_A, TENANT_B]);
      await expect(runCrossTenant('monthly volume report', () => profiles.save(newProfile('ref-x')))).rejects.toThrow(MissingTenantError);
      await expect(runCrossTenant('monthly volume report', () => profiles.update({ id: rowOfTenantA }, { fullName: 'X' })))
        .rejects.toThrow(MissingTenantError);
    }, 'report_admin');
    await as('bob', TENANT_B, async () => {
      await expect(runCrossTenant('monthly volume report', () => profiles.find())).rejects.toThrow(CrossTenantDeniedError);
    }, 'user');
  });

  it('lets only the system job entry read across tenants without a role', async () => {
    expect(await runAsSystem(undefined, () => runCrossTenant('nightly reconciliation', () => profiles.find()))).toHaveLength(2);
    await expect(as(SYSTEM_USER, TENANT_A, () => runCrossTenant('report', () => profiles.find()))).rejects.toThrow(CrossTenantDeniedError);
    const consumer = contextFromMessageHeaders({ 'x-request-id': 'req-7', 'x-tenant-id': TENANT_A, 'x-user-id': SYSTEM_USER });
    await expect(runWithRequestContext(consumer, () => runCrossTenant('consumer report', () => profiles.find()))).rejects.toThrow(CrossTenantDeniedError);
  });
});
```
