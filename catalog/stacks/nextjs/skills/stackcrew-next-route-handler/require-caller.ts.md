Goes to `src/shared/http/require-caller.ts`.

```ts
// Default location: src/shared/http/require-caller.ts
import 'server-only';
import type { NextResponse } from 'next/server';
import { getRequestContext } from '../context/session-context';
import type { RequestContext } from '../context/request-context';
import { HTTP_STATUS, ProblemText, problemResponse, type ProblemDetails } from './problem-details';

export type CallerCheck = { ok: true; caller: RequestContext } | { ok: false; response: NextResponse<ProblemDetails> };

/**
 * The first step of a route handler, before it reads the body or the query (like a NestJS guard before the pipes): no
 * signed-in user -> 401, no tenant or not the role -> 403, as problems. So an anonymous or unauthorized caller learns
 * nothing about the input the endpoint expects. The shared function the handler calls checks again: it is also the
 * body of a server action.
 */
export async function requireCaller(role: string): Promise<CallerCheck> {
  const caller = await getRequestContext();
  if (caller.userId === undefined) {
    return { ok: false, response: problemResponse(HTTP_STATUS.UNAUTHORIZED, ProblemText.UNAUTHENTICATED) };
  }
  if (caller.tenantId === undefined || !caller.roles.includes(role)) {
    return { ok: false, response: problemResponse(HTTP_STATUS.FORBIDDEN, ProblemText.FORBIDDEN) };
  }
  return { ok: true, caller };
}
```
