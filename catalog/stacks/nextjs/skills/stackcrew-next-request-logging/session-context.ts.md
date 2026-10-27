Goes to `src/shared/context/session-context.ts`.

```ts
// Default location: src/shared/context/session-context.ts
import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { auth } from '../../auth';
import { currentContext, REQUEST_ID_HEADER, runWithRequestContext, safeRequestIdOrNew, type RequestContext } from './request-context';

/** The signed-in user as the session callback in src/auth.ts shapes `session.user`. */
export type AuthUser = { userId: string; tenantId?: string; roles: readonly string[] };

/**
 * Parses the session at the edge: `session.user.id` (the identity provider's `sub`), `tenantId` (claim
 * `{{sc:tenantClaim}}`) and `roles` (claim `{{sc:rolesClaim}}`), copied there by the jwt and session callbacks.
 * Anything else, or no session, is no user.
 */
export function toAuthUser(session: unknown): AuthUser | undefined {
  const user: unknown = typeof session === 'object' && session !== null && 'user' in session ? session.user : undefined;
  if (typeof user !== 'object' || user === null || !('id' in user) || typeof user.id !== 'string' || user.id === '') {
    return undefined;
  }
  const tenantId: unknown = 'tenantId' in user ? user.tenantId : undefined;
  const roles: unknown = 'roles' in user ? user.roles : undefined;
  return {
    userId: user.id,
    tenantId: typeof tenantId === 'string' && tenantId !== '' ? tenantId : undefined,
    roles: Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : [],
  };
}

/**
 * The context of the current request, from auth() and the x-request-id header. React's cache() makes it one auth()
 * call per Server Component render; outside a render (an action, a route handler) it runs once per wrapper call.
 */
export const contextOfRequest = cache(async (): Promise<RequestContext> => {
  const [session, requestHeaders] = await Promise.all([auth(), headers()]);
  const user = toAuthUser(session);
  return { requestId: safeRequestIdOrNew(requestHeaders.get(REQUEST_ID_HEADER)), userId: user?.userId, tenantId: user?.tenantId, roles: user?.roles ?? [] };
});

/**
 * The one way server code reads who is calling: inside withActionLogging or withRouteLogging the context they built,
 * in a Server Component the context of its request (auth() is called here). Never read the session cookie, a header or
 * auth() for the user anywhere else.
 */
export async function getRequestContext(): Promise<RequestContext> {
  return currentContext() ?? contextOfRequest();
}

/**
 * Runs a Server Component data loader inside the request context, so tenant repositories and the audit subscriber
 * see the user and tenant: `export const loadProfiles = (page: number) => runInRequestContext(() => ...)`. Inside a
 * wrapper it just runs fn in the wrapper's context.
 */
export async function runInRequestContext<T>(fn: () => Promise<T>): Promise<T> {
  if (currentContext() !== undefined) {
    return fn();
  }
  return runWithRequestContext(await contextOfRequest(), fn);
}
```
