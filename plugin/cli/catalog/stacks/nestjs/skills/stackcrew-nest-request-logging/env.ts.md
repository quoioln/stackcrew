Goes to `src/config/env.ts`.

```ts
// Default location: src/config/env.ts (merge these classes into the project's env validation if it has one)
import 'reflect-metadata'; // @Type reads decorator metadata, also in unit tests that never boot Nest
import { plainToInstance, Type } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUrl, Min, validateSync } from 'class-validator';

const DEFAULT_MAX_BODY_BYTES = 16384;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

/** Request and response logging (core-logging). */
export class LoggingEnv {
  /** PII keys to mask, comma-separated; unset or empty = the masker's default PII list. Secrets are always masked. */
  @IsString()
  LOG_MASK_FIELDS = '';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  LOG_MAX_BODY_BYTES = DEFAULT_MAX_BODY_BYTES;

  /** "false" drops reqBody and resBody and keeps the one line per call. */
  @IsIn(['true', 'false'])
  LOG_BODIES: 'true' | 'false' = 'true';

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: (typeof LOG_LEVELS)[number] = 'info';
}

/** Cross-tenant access (core-persistence). The default comes from conventions.crossTenantRoles in stackcrew.json. */
export class TenancyEnv {
  /** Roles (JWT claim `{{sc:rolesClaim}}`) allowed to call runCrossTenant, comma-separated; empty grants no role. */
  @IsString()
  CROSS_TENANT_ROLES = '{{sc:crossTenantRolesCsv}}';
}

/** JWT verification through the identity provider's JWKS. */
export class AuthEnv {
  @IsUrl({ require_tld: false })
  JWKS_URI!: string;

  @IsString()
  JWT_ISSUER!: string;

  @IsString()
  JWT_AUDIENCE!: string;
}

export class ServerEnv {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  PORT = 3000;
}

export type Env = ServerEnv & LoggingEnv & TenancyEnv & AuthEnv;

type EnvSection<T extends object> = new () => T;

/** Parses and validates one section from raw environment strings; the error names the variables, never their values. */
export function parseEnvSection<T extends object>(section: EnvSection<T>, raw: Readonly<Record<string, unknown>>): T {
  // numbers need @Type(() => Number): a property without a type annotation has design:type Object, so implicit
  // conversion would leave "2048" a string and @IsInt would fail once the variable is set
  const parsed = plainToInstance(section, raw, { enableImplicitConversion: true, excludeExtraneousValues: false });
  const errors = validateSync(parsed, { whitelist: true });
  if (errors.length > 0) {
    // names only: a value can be a secret
    throw new Error(`Invalid environment: ${errors.map((e) => e.property).join(', ')}`);
  }
  return parsed;
}

/** For ConfigModule.forRoot({ validate: validateEnv }): fails the boot on a missing or invalid variable. */
export function validateEnv(raw: Record<string, unknown>): Env {
  return Object.assign(parseEnvSection(ServerEnv, raw), parseEnvSection(LoggingEnv, raw), parseEnvSection(TenancyEnv, raw), parseEnvSection(AuthEnv, raw));
}

let logging: LoggingEnv | undefined;
let tenancy: TenancyEnv | undefined;

/** For code outside Nest's injector (masker, request context). Read after ConfigModule has loaded .env, never at import time. */
export function loggingEnv(): LoggingEnv {
  logging ??= parseEnvSection(LoggingEnv, process.env);
  return logging;
}

export function tenancyEnv(): TenancyEnv {
  tenancy ??= parseEnvSection(TenancyEnv, process.env);
  return tenancy;
}
```
