Goes to `src/config/env.spec.ts`.

```ts
// Default location: src/config/env.spec.ts
import { AuthEnv, LoggingEnv, parseEnvSection, ServerEnv, TenancyEnv, validateEnv } from './env';

describe('environment sections', () => {
  it('converts the strings the environment holds', () => {
    const logging = parseEnvSection(LoggingEnv, { LOG_MAX_BODY_BYTES: '2048', LOG_BODIES: 'false', LOG_MASK_FIELDS: 'email,phone' });
    expect(logging).toMatchObject({ LOG_MAX_BODY_BYTES: 2048, LOG_BODIES: 'false', LOG_MASK_FIELDS: 'email,phone', LOG_LEVEL: 'info' });
    expect(parseEnvSection(ServerEnv, { PORT: '8080' }).PORT).toBe(8080);
  });

  it('keeps the defaults when a variable is unset', () => {
    expect(parseEnvSection(LoggingEnv, {})).toMatchObject({ LOG_MAX_BODY_BYTES: 16384, LOG_BODIES: 'true', LOG_MASK_FIELDS: '' });
    expect(parseEnvSection(TenancyEnv, {}).CROSS_TENANT_ROLES).toBe('{{sc:crossTenantRolesCsv}}');
  });

  it('names an invalid or missing variable, never its value', () => {
    expect(() => parseEnvSection(LoggingEnv, { LOG_MAX_BODY_BYTES: 'many', LOG_BODIES: 'sometimes' })).toThrow('Invalid environment: LOG_MAX_BODY_BYTES, LOG_BODIES');
    expect(() => parseEnvSection(AuthEnv, { JWKS_URI: 'not a url with a secret', JWT_ISSUER: 'i' })).toThrow(/^Invalid environment: JWKS_URI, JWT_AUDIENCE$/);
  });

  it('requires https for the JWKS keys outside development and test', () => {
    // DATABASE_URL is only read once the TypeORM skill has added its DatabaseEnv section
    const raw = { JWKS_URI: 'http://idp.internal/jwks', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', DATABASE_URL: 'postgres://db.internal/app' };
    expect(() => validateEnv(raw)).toThrow('Invalid environment: JWKS_URI must use https outside development and test');
    expect(() => validateEnv({ ...raw, NODE_ENV: 'production' })).toThrow('JWKS_URI must use https');
    expect(validateEnv({ ...raw, NODE_ENV: 'test' }).JWKS_URI).toBe('http://idp.internal/jwks');
    expect(validateEnv({ ...raw, JWKS_URI: 'https://idp.example.com/jwks' }).JWKS_URI).toBe('https://idp.example.com/jwks');
  });
});
```
