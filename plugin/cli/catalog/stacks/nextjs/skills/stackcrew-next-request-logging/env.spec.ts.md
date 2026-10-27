Goes to `src/env.spec.ts`.

```ts
// Default location: src/env.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

/** A fresh src/env.ts, validated against the stubbed environment. */
const loadEnv = async (): Promise<typeof import('./env').env> => {
  vi.resetModules();
  return (await import('./env')).env;
};

describe('env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults CROSS_TENANT_ROLES to the conventions list when it is unset', async () => {
    vi.stubEnv('CROSS_TENANT_ROLES', undefined);
    expect((await loadEnv()).CROSS_TENANT_ROLES).toBe('{{sc:crossTenantRolesCsv}}');
  });

  it('keeps an empty CROSS_TENANT_ROLES empty: no role may read across tenants, never the default', async () => {
    vi.stubEnv('CROSS_TENANT_ROLES', '');
    expect((await loadEnv()).CROSS_TENANT_ROLES).toBe('');
  });

  it('converts numbers from the strings the environment holds, and applies the logging defaults', async () => {
    vi.stubEnv('LOG_MAX_BODY_BYTES', '2048');
    vi.stubEnv('LOG_BODIES', undefined);
    const env = await loadEnv();
    expect(env.LOG_MAX_BODY_BYTES).toBe(2048);
    expect(env.LOG_BODIES).toBe('true');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('fails on an invalid value and names the variable, never the value', async () => {
    vi.stubEnv('LOG_BODIES', 'maybe-secret');
    const failure = loadEnv();
    await expect(failure).rejects.toThrow('Invalid environment: LOG_BODIES');
    await expect(failure).rejects.not.toThrow('maybe-secret');
  });
});
```
