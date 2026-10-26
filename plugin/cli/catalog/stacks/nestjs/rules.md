---
id: stack-nestjs
title: NestJS 10
---
# NestJS 10

NestJS 10 on Express with TypeScript strict. Applies with the TypeScript rule (SC-TYPE, SC-ENV, SC-CONST, SC-TYPEFILE). Do not use Nest 11 APIs (the built-in JSON logger among them). A new dependency is added only after you ask the user first.

## Essentials

- One folder per feature: `src/modules/<feature>/` with `<feature>.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `entities/`, `interfaces/`. Shared code lives in `src/common/`, config in `src/config/`. A service file declares no `interface` or `type` (SC-TYPEFILE): put them in `dto/`, `interfaces/` or `*.types.ts`.
- Controllers are thin: map HTTP to one service call and return a response DTO. No business logic, no repository, no `@Res()` unless streaming.
- Never return an entity from a controller, not even with `ClassSerializerInterceptor` and `@Exclude()`. A response DTO class has `@Expose()` and `@ApiProperty()` on every field and is built with `plainToInstance(XResponse, source, { excludeExtraneousValues: true })` or a mapper.
- Request DTOs are classes with class-validator decorators. One global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` registered as `APP_PIPE`.
- Configuration comes from `@nestjs/config` with `validate` at boot (class-validator); `process.env` is read only in `src/config/` (SC-ENV). Inject `ConfigService<Env, true>`; never read a variable in a service.
- Authentication: passport-jwt verifying the signature through the identity provider's JWKS (`jwks-rsa`, ask first), checking `issuer`, `audience` and the algorithm; one global `JwtAuthGuard` (`APP_GUARD`) with a `@Public()` decorator for open routes. The strategy binds `sub`, claim `{{sc:tenantClaim}}` and claim `{{sc:rolesClaim}}` to the request; `RequestContextInterceptor` runs the handler inside `runWithRequestContext`. Nothing else decodes a token.
- Persistence with TypeORM per `addon-typeorm`: entities extend `{{sc:baseEntity}}`/`{{sc:baseTenantEntity}}`, tenant entities only through their `TenantScopedRepository`, migrations only (skill `stackcrew-nest-typeorm-entity`).
- Errors: one global `AllExceptionsFilter` answers RFC 7807 `application/problem+json` with a constant `detail`; domain errors extend `ProblemError`. Never send `exception.message`.
- Outbound HTTP only through `HttpService` (`@nestjs/axios`) with a `timeout` per client, base URLs from config, and `OutboundHttpLogger` on that module. Never `fetch` or a bare axios instance.
- Logging per `core-logging` with `nestjs-pino` 4.x (ask first; 5.x needs Nest 11): one `http_in` line per request from `httpLoggingMiddleware`, one `http_out` per call, bodies only through the shared masker (skill `stackcrew-nest-request-logging`). Services log events with `Logger`, never bodies.
- Inject through constructors; providers are stateless singletons. Request-scoped providers are a last resort; use the request context instead.
- Use `async`/`await` with `firstValueFrom` for `HttpService`; never leave a promise floating.
- Write tests per `stack-nestjs-testing`: Jest with `@nestjs/testing`, Postgres in Testcontainers, supertest e2e, no live provider calls.

## Module layout

```
src/
  main.ts                    # NestFactory.create(..., { bufferLogs: true, rawBody: true }); setupApp(app)
  app.module.ts              # imports CommonModule, DatabaseModule and the feature modules
  config/env.ts              # validateEnv, typed sections
  common/{auth,context,errors,logging,database}/
  modules/customer-profiles/
    customer-profiles.module.ts
    customer-profiles.controller.ts
    customer-profiles.service.ts
    customer-profile.repository.ts
    customer-profile.mapper.ts
    dto/create-customer-profile.request.ts
    dto/customer-profile.response.ts
    entities/customer-profile.entity.ts
    interfaces/
```

- One module per feature; export only what other modules call (usually the service). No circular imports; `forwardRef` is a design smell.
- Status and type values are `as const` objects next to the entity or in `<feature>.constants.ts`, not string literals in code (SC-CONST).

## Response DTOs

```ts
// Default location: src/modules/customer-profiles/dto/customer-profile.response.ts
import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { CustomerProfileStatus } from '../entities/customer-profile.entity';

/**
 * The API shape of a customer profile. The mapper copies only the @Expose() fields (excludeExtraneousValues), so the
 * tenant, the audit fields and any column added to the entity later never reach a client.
 */
export class CustomerProfileResponse {
  @Expose()
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @Expose()
  @ApiProperty()
  readonly reference!: string;

  @Expose()
  @ApiProperty()
  readonly fullName!: string;

  @Expose()
  @ApiProperty({ enum: Object.values(CustomerProfileStatus) })
  readonly status!: CustomerProfileStatus;

  @Expose()
  @ApiProperty({ type: String, format: 'date-time' })
  readonly createdAt!: Date;
}
```

- The mapper builds it (`customer-profile.mapper.ts`, skill `stackcrew-nest-rest-endpoint`): `plainToInstance(CustomerProfileResponse, entity, { excludeExtraneousValues: true })` copies only `@Expose()` fields, so a column added to the entity later (or `{{sc:tenantColumn}}`, `createdBy`) never leaks. The DTO holds no mapping code.
- The service returns the DTO (or a domain result the controller maps); a controller's return type is the DTO class, never `Promise<CustomerProfile>`.
- `ClassSerializerInterceptor` with `@Exclude()` is not enough: one forgotten `@Exclude()` leaks a field. Do not rely on it.

## Validation and config

- `ValidationPipe` options: `whitelist` drops undecorated fields, `forbidNonWhitelisted` rejects them, `transform` builds the DTO class. Its `exceptionFactory` returns `RequestValidationError` (request-logging skill) so the filter answers 400 with `errors: [{ field, messages }]`.
- Nested DTOs need `@ValidateNested()` and `@Type(() => Child)`; arrays `@IsArray()` plus `each: true`.
- `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })`: a missing or invalid variable fails the boot and the error names the variable, never its value. Secrets come from the environment or a vault, never from the repository.

## Authentication

passport-jwt and jwks-rsa (ask first) verify the token; the payload is parsed at the edge into `AuthUser`:

```ts
// src/common/auth/auth-user.ts
import { UnauthorizedException } from '@nestjs/common';

export type AuthUser = { userId: string; tenantId?: string; roles: readonly string[] };

const TENANT_CLAIM = '{{sc:tenantClaim}}';
const ROLES_CLAIM = '{{sc:rolesClaim}}';

/** The verified token payload: `sub`, claim `{{sc:tenantClaim}}`, claim `{{sc:rolesClaim}}`. */
export function toAuthUser(payload: unknown): AuthUser {
  if (typeof payload !== 'object' || payload === null || !('sub' in payload) || typeof payload.sub !== 'string') {
    throw new UnauthorizedException();
  }
  const claims = new Map<string, unknown>(Object.entries(payload));
  const tenantId = claims.get(TENANT_CLAIM);
  const roles = claims.get(ROLES_CLAIM);
  return {
    userId: payload.sub,
    tenantId: typeof tenantId === 'string' && tenantId !== '' ? tenantId : undefined,
    roles: Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : [],
  };
}
```

```ts
// src/common/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthEnv } from '../../config/env';
import { bindAuthenticatedUser } from '../context/request-context';
import { toAuthUser, type AuthUser } from './auth-user';

const JWKS_REQUESTS_PER_MINUTE = 10;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<AuthEnv, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKeyProvider: passportJwtSecret({
        jwksUri: config.getOrThrow('JWKS_URI', { infer: true }),
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: JWKS_REQUESTS_PER_MINUTE,
      }),
      issuer: config.getOrThrow('JWT_ISSUER', { infer: true }),
      audience: config.getOrThrow('JWT_AUDIENCE', { infer: true }),
      algorithms: ['RS256'],
      passReqToCallback: true,
    });
  }

  /** Called after the signature, expiry, issuer and audience checks passed. */
  validate(req: Request, payload: unknown): AuthUser {
    const user = toAuthUser(payload);
    bindAuthenticatedUser(req, user); // the request context; RequestContextInterceptor runs the handler in it
    return user;
  }
}
```

```ts
// src/common/auth/public.decorator.ts
import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
```

```ts
// src/common/auth/jwt-auth.guard.ts
import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    return isPublic === true || super.canActivate(context);
  }
}
```

- Register `JwtStrategy`, `{ provide: APP_GUARD, useClass: JwtAuthGuard }` and `RequestContextInterceptor` in `CommonModule` (request-logging skill). Mark health checks and webhooks `@Public()`; a public route touches no tenant entity.
- The strategy binds the user to the request object, not to AsyncLocalStorage: callbacks inside passport and jwks-rsa may run in another request's async context.
- Authorization by role reads `AuthUser.roles` (`req.user`, set by the strategy) in a guard on the route or controller; object-level checks (no IDOR) go through the tenant repository and the owner field.

## Persistence

Per `addon-typeorm` and skill `stackcrew-nest-typeorm-entity`:

- Services inject the entity's `TenantScopedRepository` subclass; a lookup by id of another tenant's row returns `null` and becomes 404.
- `AuditSubscriber` fills `createdBy`/`updatedBy` from the request context; `TenantSubscriber` assigns the tenant and refuses other tenants' rows.
- Jobs and migrations run inside `runAsSystem(tenantId, work)`; consumers inside `runWithRequestContext(contextFromMessageHeaders(headers), work)`. Cross-tenant reads only through `runCrossTenant(reason, work)`, allowed for `CROSS_TENANT_ROLES` (default {{sc:crossTenantRoles}}) and the system job entry.
- Transactions: `dataSource.transaction(async (manager) => ...)`. Inside, a tenant entity goes only through its repository's `withManager(manager)` (`this.profiles.withManager(manager).update(...)`). Never use any manager method on a tenant entity (getRepository, update, delete, increment, decrement, softDelete, restore, upsert, createQueryBuilder…): none carries the tenant condition, so tenant B would change tenant A's rows. Never a remote call inside a transaction.

## Errors (RFC 7807)

- `AllExceptionsFilter` (`APP_FILTER`) maps every exception: `RequestValidationError` 400 with field errors, `ProblemError` subclasses to their status and constant detail, other `HttpException`s to their status with the standard title, body-parser errors to their 4xx, `CrossTenantDeniedError` to 404, everything else to 500.
- Throw domain errors from services (`class CustomerProfileNotFound extends ProblemError`), not `HttpException`s with free text.

## Outbound HTTP

- `HttpModule.register({ timeout, maxRedirects: 0 })` (or `registerAsync` with `ConfigService`) in the module that calls the provider, plus `...outboundHttpLogging(target)` in its providers. Call with `await firstValueFrom(this.http.post(...))`.
- Parse every response at the edge (class-validator DTO or a type guard) before it leaves the client. Retries, circuit breaker and the provider pattern: skill `stackcrew-nest-outbound-client`.

## Logging and observability

- `LoggerModule.forRootAsync` with `pinoHttpOptions` (request-logging skill); `app.useLogger(app.get(Logger))` in `setupApp`, with `bufferLogs: true`. JSON to stdout; `LOG_LEVEL` from config.
- In code, `private readonly logger = new Logger(Feature.name)` and `this.logger.log({ event, ...fields }, event)`: a stable message plus fields. Never interpolate data into the message, never log a DTO, entity or body.
- Health: `@nestjs/terminus` at `/health` (`@Public()`), skipped by the request log.
