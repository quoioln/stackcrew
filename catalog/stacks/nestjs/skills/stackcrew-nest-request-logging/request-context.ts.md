Goes to `src/common/context/request-context.ts`.

```ts
// Default location: src/common/context/request-context.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomInt, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import { tenancyEnv } from '../../config/env';

/**
 * Who is calling and for which tenant. Requests bind it once, after authentication; message consumers build it from
 * the x-request-id, x-tenant-id and x-user-id headers; jobs get it from runAsSystem. Persistence reads it and never
 * decodes a token.
 */
export type RequestContext = {
  requestId: string;
  /** Six letters A-Z, new for every request, job and message: the body's supportCode and the x-support-code header. */
  supportCode: string;
  userId?: string;
  tenantId?: string;
  roles: readonly string[];
  /** Set only by runAsSystem: the system job identity. */
  system?: boolean;
  /** Set only by runCrossTenant: reads skip the tenant condition, and there is no tenant to write with. */
  crossTenant?: boolean;
};

/** What a caller passes to runWithRequestContext: a missing supportCode is generated. */
export type RequestContextInit = Omit<RequestContext, 'supportCode'> & { supportCode?: string };

export const SYSTEM_USER = '{{sc:systemUser}}';
export const REQUEST_ID_HEADER = 'x-request-id';
export const TENANT_ID_HEADER = 'x-tenant-id';
export const USER_ID_HEADER = 'x-user-id';
/** Response only: a support code is never read from a request or a message. */
export const SUPPORT_CODE_HEADER = 'x-support-code';

const CROSS_TENANT_EVENT = 'cross_tenant';
/** An HTTP x-request-id is kept only when it is a UUID (requestIdOrNew). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A message-header request id from outside is kept only when it is short and plain. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;
/** A tenant or user id from a header: visible ASCII only (no spaces, no CR/LF), at most 128 characters. */
const SAFE_ID = /^[\x21-\x7e]{1,128}$/;
const SUPPORT_CODE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SUPPORT_CODE_LENGTH = 6;

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
const boundToRequest = new WeakMap<IncomingMessage, RequestContext>(); // Express requests extend IncomingMessage
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
export function runWithRequestContext<T>(ctx: RequestContextInit, fn: () => T): T {
  refuseInsideAUserContext();
  return storage.run(
    Object.freeze({ requestId: ctx.requestId, supportCode: ctx.supportCode ?? newSupportCode(), userId: ctx.userId, tenantId: ctx.tenantId, roles: Object.freeze([...ctx.roles]) }),
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
    Object.freeze({
      requestId: parent?.requestId ?? randomUUID(),
      supportCode: parent?.supportCode ?? newSupportCode(),
      userId: SYSTEM_USER,
      tenantId,
      roles: Object.freeze([]),
      system: true,
    }),
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

/**
 * The context a consumer runs with, from the message headers. Unsafe values count as absent; never the system identity.
 * The support code is this consumer's own, never the producer's.
 */
export function contextFromMessageHeaders(headers: Readonly<Record<string, unknown>> | undefined): RequestContext {
  const header = (name: string): unknown => headerText(headers?.[name]);
  return {
    requestId: safeRequestIdOrNew(header(REQUEST_ID_HEADER)),
    supportCode: newSupportCode(),
    tenantId: safeIdOrUndefined(header(TENANT_ID_HEADER)),
    userId: safeIdOrUndefined(header(USER_ID_HEADER)),
    roles: [],
  };
}

/** The caller's HTTP x-request-id when it is a UUID (lower-cased), else a new one (P3-R2: HTTP entry only). */
export function requestIdOrNew(value: unknown): string {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : randomUUID();
}

/** Six letters A-Z from the CSPRNG, unbiased (randomInt rejects out-of-range draws). Never read from a header. */
export function newSupportCode(): string {
  let code = '';
  for (let i = 0; i < SUPPORT_CODE_LENGTH; i++) {
    code += SUPPORT_CODE_LETTERS[randomInt(0, SUPPORT_CODE_LETTERS.length)];
  }
  return code;
}

/** A message header's request id when it is safe to log, else a new UUID. HTTP uses requestIdOrNew. */
export function safeRequestIdOrNew(value: unknown): string {
  return typeof value === 'string' && SAFE_REQUEST_ID.test(value) ? value : randomUUID();
}

/** A tenant or user id from outside when it is safe to log and use, else undefined (treated as absent: fail closed). */
export function safeIdOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : undefined;
}

/** Ties a context to one HTTP request object: the logging middleware binds the request id, authentication the user. */
export function bindRequestContext(req: IncomingMessage, ctx: RequestContext): void {
  boundToRequest.set(req, Object.freeze({ ...ctx, system: undefined, crossTenant: undefined }));
}

export function requestContextOf(req: IncomingMessage): RequestContext | undefined {
  return boundToRequest.get(req);
}

/**
 * The ids a response body carries: the ones the logging middleware bound to the request and sent as headers. A request
 * the middleware skipped (health, metrics) gets new ones, bound to it, so the body and the filter's headers agree.
 */
export function requestIdsOf(req: IncomingMessage): { requestId: string; supportCode: string } {
  const bound = boundToRequest.get(req);
  if (bound !== undefined) {
    return { requestId: bound.requestId, supportCode: bound.supportCode };
  }
  const ids = { requestId: randomUUID(), supportCode: newSupportCode() };
  bindRequestContext(req, { ...ids, roles: [] });
  return ids;
}

/** Called by authentication once the token is verified: the user, tenant and roles of this request. */
export function bindAuthenticatedUser(req: IncomingMessage, user: { userId: string; tenantId?: string; roles: readonly string[] }): void {
  const bound = boundToRequest.get(req); // keeps the ids the middleware already sent as headers
  bindRequestContext(req, {
    requestId: bound?.requestId ?? randomUUID(),
    supportCode: bound?.supportCode ?? newSupportCode(),
    userId: user.userId,
    tenantId: user.tenantId,
    roles: user.roles,
  });
}

/** Fields for every log line (pino mixin): the ids of the current context and the active OpenTelemetry span. */
export function contextLogFields(): { requestId?: string; supportCode?: string; userId?: string; tenantId?: string; traceId?: string; spanId?: string } {
  const ctx = storage.getStore();
  const ids = ctx === undefined ? {} : { requestId: ctx.requestId, supportCode: ctx.supportCode, userId: ctx.userId, tenantId: ctx.tenantId };
  return { ...ids, ...activeTraceFields() };
}

/** traceId and spanId of the active OpenTelemetry span; empty when there is none (no SDK, or outside a span). */
export function activeTraceFields(): { traceId?: string; spanId?: string } {
  const span = trace.getActiveSpan()?.spanContext();
  return span !== undefined && isSpanContextValid(span) ? { traceId: span.traceId, spanId: span.spanId } : {};
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
