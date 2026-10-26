Goes to `src/common/context/request-context.ts`.

```ts
// Default location: src/common/context/request-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { tenancyEnv } from '../../config/env';

/**
 * Who is calling and for which tenant. Requests bind it once, after authentication; message consumers build it from
 * the x-request-id, x-tenant-id and x-user-id headers; jobs get it from runAsSystem. Persistence reads it and never
 * decodes a token.
 */
export type RequestContext = {
  requestId: string;
  userId?: string;
  tenantId?: string;
  roles: readonly string[];
  /** Set only by runAsSystem: the system job identity. */
  system?: boolean;
  /** Set only by runCrossTenant: reads skip the tenant condition, and there is no tenant to write with. */
  crossTenant?: boolean;
};

export const SYSTEM_USER = '{{sc:systemUser}}';
export const REQUEST_ID_HEADER = 'x-request-id';
export const TENANT_ID_HEADER = 'x-tenant-id';
export const USER_ID_HEADER = 'x-user-id';

const CROSS_TENANT_EVENT = 'cross_tenant';
/** A request id from outside is kept only when it is short and plain. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;
/** A tenant or user id from a header: visible ASCII only (no spaces, no CR/LF), at most 128 characters. */
const SAFE_ID = /^[\x21-\x7e]{1,128}$/;

export class MissingTenantError extends Error {
  constructor() {
    super('A tenant entity was touched without a tenant in the request context');
    this.name = 'MissingTenantError';
  }
}

export class CrossTenantDeniedError extends Error {
  constructor(reason: string) {
    super(`Cross-tenant access denied: ${reason}`);
    this.name = 'CrossTenantDeniedError';
  }
}

const storage = new AsyncLocalStorage<RequestContext>();
const boundToRequest = new WeakMap<object, RequestContext>();
const logger = new Logger('RequestContext');

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The tenant of the current unit of work; throws MissingTenantError when there is none (also inside runCrossTenant). */
export function requireTenantId(): string {
  const tenantId = storage.getStore()?.tenantId;
  if (tenantId === undefined || tenantId === '') {
    throw new MissingTenantError();
  }
  return tenantId;
}

export function isCrossTenant(): boolean {
  return storage.getStore()?.crossTenant === true;
}

/** createdBy / updatedBy: the user of the context, or SYSTEM_USER when there is none (job, consumer without a user). */
export function currentActor(): string {
  return storage.getStore()?.userId ?? SYSTEM_USER;
}

/**
 * Runs fn with ctx as the context: requests (RequestContextInterceptor) and message consumers. It never grants the
 * system identity or cross-tenant reads, whatever ctx says, and refuses to replace the context of another user.
 */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  refuseInsideAUserContext();
  return storage.run(
    Object.freeze({ requestId: ctx.requestId, userId: ctx.userId, tenantId: ctx.tenantId, roles: Object.freeze([...ctx.roles]) }),
    fn,
  );
}

/**
 * The system job entry: scheduled jobs and migrations run here as SYSTEM_USER, one tenant per unit of work
 * (undefined when the job touches no tenant entity). The only way to get the system identity, and with it the right
 * to call runCrossTenant without a role. Never call it from a request handler or a message consumer.
 */
export function runAsSystem<T>(tenantId: string | undefined, fn: () => Promise<T>): Promise<T> {
  refuseInsideAUserContext();
  const parent = storage.getStore();
  return storage.run(
    Object.freeze({ requestId: parent?.requestId ?? randomUUID(), userId: SYSTEM_USER, tenantId, roles: Object.freeze([]), system: true }),
    fn,
  );
}

/**
 * Read across tenants: allowed for the roles in CROSS_TENANT_ROLES and inside runAsSystem; denied for everyone else,
 * including a token, header or runWithRequestContext user whose id happens to be SYSTEM_USER. Logs who and why.
 * Read only: inside fn there is no tenant, so every write throws MissingTenantError.
 */
export async function runCrossTenant<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  if (reason.trim() === '') {
    throw new Error('runCrossTenant needs a short, human-readable reason');
  }
  const ctx = storage.getStore();
  const loggedReason = reason.replace(/[\r\n]+/g, ' ');
  const roles = crossTenantRoles();
  const allowed = ctx !== undefined && (ctx.system === true || ctx.roles.some((role) => roles.includes(role)));
  if (!allowed) {
    logger.warn({ event: CROSS_TENANT_EVENT, userId: ctx?.userId, reason: loggedReason, outcome: 'denied' }, CROSS_TENANT_EVENT);
    throw new CrossTenantDeniedError(`no cross-tenant role for: ${loggedReason}`);
  }
  logger.log({ event: CROSS_TENANT_EVENT, userId: ctx.userId, tenantId: ctx.tenantId, reason: loggedReason }, CROSS_TENANT_EVENT);
  return storage.run(Object.freeze({ ...ctx, tenantId: undefined, crossTenant: true }), fn);
}

/** The context a consumer runs with, from the message headers. Unsafe values count as absent; never the system identity. */
export function contextFromMessageHeaders(headers: Readonly<Record<string, unknown>> | undefined): RequestContext {
  const header = (name: string): unknown => headerText(headers?.[name]);
  return {
    requestId: safeRequestIdOrNew(header(REQUEST_ID_HEADER)),
    tenantId: safeIdOrUndefined(header(TENANT_ID_HEADER)),
    userId: safeIdOrUndefined(header(USER_ID_HEADER)),
    roles: [],
  };
}

/** The caller's request id when it is safe to log, else a new UUID. */
export function safeRequestIdOrNew(value: unknown): string {
  return typeof value === 'string' && SAFE_REQUEST_ID.test(value) ? value : randomUUID();
}

/** A tenant or user id from outside when it is safe to log and use, else undefined (treated as absent: fail closed). */
export function safeIdOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : undefined;
}

/** Ties a context to one HTTP request object: the logging middleware binds the request id, authentication the user. */
export function bindRequestContext(req: object, ctx: RequestContext): void {
  boundToRequest.set(req, Object.freeze({ ...ctx, system: undefined, crossTenant: undefined }));
}

export function requestContextOf(req: object): RequestContext | undefined {
  return boundToRequest.get(req);
}

/** Called by authentication once the token is verified: the user, tenant and roles of this request. */
export function bindAuthenticatedUser(req: object, user: { userId: string; tenantId?: string; roles: readonly string[] }): void {
  const requestId = boundToRequest.get(req)?.requestId ?? randomUUID();
  bindRequestContext(req, { requestId, userId: user.userId, tenantId: user.tenantId, roles: user.roles });
}

/** Fields for every log line (pino mixin): the ids of the current context. */
export function contextLogFields(): { requestId?: string; userId?: string; tenantId?: string } {
  const ctx = storage.getStore();
  return ctx === undefined ? {} : { requestId: ctx.requestId, userId: ctx.userId, tenantId: ctx.tenantId };
}

function crossTenantRoles(): readonly string[] {
  return tenancyEnv().CROSS_TENANT_ROLES.split(',').map((role) => role.trim()).filter((role) => role !== '');
}

function refuseInsideAUserContext(): void {
  const ctx = storage.getStore();
  if (ctx?.userId !== undefined && ctx.system !== true) {
    throw new Error('This code already runs as a user; a request or message cannot switch user or tenant');
  }
}

function headerText(value: unknown): unknown {
  return Buffer.isBuffer(value) ? value.toString('utf8') : value;
}
```
