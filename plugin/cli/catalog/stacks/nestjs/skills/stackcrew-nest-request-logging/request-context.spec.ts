// Default location: src/common/context/request-context.spec.ts
process.env.CROSS_TENANT_ROLES = 'report_admin'; // read once, on the first cross-tenant check of this test file

import {
  contextFromMessageHeaders, CrossTenantDeniedError, currentActor, currentContext, MissingTenantError, requireTenantId,
  runAsSystem, runCrossTenant, runWithRequestContext, SYSTEM_USER, type RequestContext,
} from './request-context';

const user = (userId: string, tenantId: string, ...roles: string[]): RequestContext => ({ requestId: 'req-1', userId, tenantId, roles });
const readEverything = async (): Promise<string> => 'rows of every tenant';

describe('request context', () => {
  it('lets a cross-tenant role read across tenants, without a tenant to write with', async () => {
    await runWithRequestContext(user('carol', 'tenant-a', 'report_admin'), async () => {
      await expect(runCrossTenant('monthly volume report', readEverything)).resolves.toBe('rows of every tenant');
      await runCrossTenant('monthly volume report', async () => {
        expect(() => requireTenantId()).toThrow(MissingTenantError);
      });
    });
  });

  it('denies every other role', async () => {
    await runWithRequestContext(user('bob', 'tenant-b', 'user'), async () => {
      await expect(runCrossTenant('monthly volume report', readEverything)).rejects.toThrow(CrossTenantDeniedError);
    });
  });

  it('lets only runAsSystem act as the system identity', async () => {
    await expect(runAsSystem(undefined, () => runCrossTenant('nightly reconciliation', readEverything))).resolves.toBe('rows of every tenant');
    await runAsSystem('tenant-a', async () => {
      expect(currentActor()).toBe(SYSTEM_USER);
      expect(requireTenantId()).toBe('tenant-a');
    });
  });

  it('never makes a token or header user named like the system user the system identity', async () => {
    await runWithRequestContext(user(SYSTEM_USER, 'tenant-a'), async () => {
      await expect(runCrossTenant('monthly volume report', readEverything)).rejects.toThrow(CrossTenantDeniedError);
    });
    const consumer = contextFromMessageHeaders({ 'x-request-id': 'req-7', 'x-tenant-id': 'tenant-a', 'x-user-id': SYSTEM_USER });
    await runWithRequestContext(consumer, async () => {
      await expect(runCrossTenant('consumer report', readEverything)).rejects.toThrow(CrossTenantDeniedError);
    });
    const forged = { ...user('mallory', 'tenant-a'), system: true, crossTenant: true };
    await runWithRequestContext(forged, async () => {
      expect(currentContext()?.system).toBeUndefined();
      await expect(runCrossTenant('forged', readEverything)).rejects.toThrow(CrossTenantDeniedError);
    });
  });

  it('refuses to switch user or tenant inside a user context', async () => {
    await runWithRequestContext(user('bob', 'tenant-b'), async () => {
      expect(() => runWithRequestContext(user('bob', 'tenant-a'), () => 1)).toThrow();
      expect(() => runAsSystem('tenant-a', async () => 1)).toThrow();
    });
  });

  it('treats unsafe header values as absent', () => {
    const ctx = contextFromMessageHeaders({ 'x-request-id': 'req id\r\nINJECTED', 'x-tenant-id': 'tenant-a\r\nINJECTED', 'x-user-id': 'u'.repeat(200) });
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ctx.tenantId).toBeUndefined();
    expect(ctx.userId).toBeUndefined();
    expect(contextFromMessageHeaders({ 'x-tenant-id': Buffer.from('tenant-a') }).tenantId).toBe('tenant-a');
  });

  it('keeps concurrent contexts apart and leaves nothing behind', async () => {
    const seen = await Promise.all(['alice', 'bob'].map((name, i) => runWithRequestContext(user(name, `tenant-${i}`), async () => {
      await new Promise((resolve) => setTimeout(resolve, 20 - i * 10));
      return `${currentContext()?.userId}@${requireTenantId()}`;
    })));
    expect(seen).toEqual(['alice@tenant-0', 'bob@tenant-1']);
    expect(currentContext()).toBeUndefined();
    expect(currentActor()).toBe(SYSTEM_USER);
  });
});
