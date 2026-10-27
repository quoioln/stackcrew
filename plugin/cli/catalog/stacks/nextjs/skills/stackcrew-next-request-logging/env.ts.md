Goes to `src/env.ts`.

```ts
// Default location: src/env.ts (merge these variables into the project's env schema if it has one)
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

const DEFAULT_MAX_BODY_BYTES = 16384;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

/**
 * The one module that reads process.env (SC-ENV); everything else imports `env` or a section below. Validated when it
 * is first imported, so `next build` and the server fail on a missing or invalid variable, and the error names the
 * variable. emptyStringAsUndefined stays off: `CROSS_TENANT_ROLES=` (empty) must mean "no role may read across
 * tenants", never the default list.
 */
export const env = createEnv({
  server: {
    /** PII keys to mask, comma-separated; unset or empty = the masker's default PII list. Secrets are always masked. */
    LOG_MASK_FIELDS: z.string().default(''),
    LOG_MAX_BODY_BYTES: z.coerce.number().int().min(1).default(DEFAULT_MAX_BODY_BYTES),
    /** "false" drops reqBody and resBody and keeps the one line per call. */
    LOG_BODIES: z.enum(['true', 'false']).default('true'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /** Roles (session claim `{{sc:rolesClaim}}`) allowed to call runCrossTenant, comma-separated; empty grants no role. */
    CROSS_TENANT_ROLES: z.string().default('{{sc:crossTenantRolesCsv}}'),
  },
  experimental__runtimeEnv: process.env,
  onValidationError: (issues) => {
    // names only: a value can be a secret
    const names = issues.map((issue) => (issue.path ?? []).map((part) => String(typeof part === 'object' ? part.key : part)).join('.'));
    throw new Error(`Invalid environment: ${names.join(', ')}`);
  },
});

export type LoggingEnv = Pick<typeof env, 'LOG_MASK_FIELDS' | 'LOG_MAX_BODY_BYTES' | 'LOG_BODIES' | 'LOG_LEVEL'>;
export type TenancyEnv = Pick<typeof env, 'CROSS_TENANT_ROLES'>;

/** Request and response logging (core-logging): the masker and the logger read their settings here. */
export function loggingEnv(): LoggingEnv {
  return env;
}

/** Cross-tenant access (core-persistence). The default comes from conventions.crossTenantRoles in stackcrew.json. */
export function tenancyEnv(): TenancyEnv {
  return env;
}
```
