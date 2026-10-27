Goes to `src/shared/logging/next-control-flow.ts`.

```ts
// Default location: src/shared/logging/next-control-flow.ts
/** A throw Next.js uses for control flow, as the logging wrappers report it before rethrowing it unchanged. */
export type ControlFlow = { name: string; status?: number };

const DIGEST_SEPARATOR = ';';
const REDIRECT_DIGEST = 'NEXT_REDIRECT';
const HTTP_FALLBACK_DIGEST = 'NEXT_HTTP_ERROR_FALLBACK';
/** The statuses Next.js accepts in those digests: 303, 307 and 308; 401, 403 and 404. */
const REDIRECT_STATUS = /^30[378]$/;
const HTTP_FALLBACK_STATUS = /^40[134]$/;
/** A redirect digest ends with ";<status>;": the status is the part before the last, empty one. */
const REDIRECT_STATUS_FROM_END = -2;
/** What Next.js throws while it prerenders, to decide how to render: not an outcome of a call. */
const RENDERING_BAILOUTS: ReadonlySet<string> = new Set([
  'DYNAMIC_SERVER_USAGE',
  'BAILOUT_TO_CLIENT_SIDE_RENDERING',
  'HANGING_PROMISE_REJECTION',
  'NEXT_PRERENDER_INTERRUPTED',
]);

/**
 * Next.js ends a request early by throwing an error with a `digest`: redirect() and permanentRedirect()
 * ("NEXT_REDIRECT;<type>;<url>;<status>;"), notFound(), forbidden() and unauthorized()
 * ("NEXT_HTTP_ERROR_FALLBACK;<status>"), and the rendering bailouts of a prerender. A wrapper rethrows these
 * unchanged and logs them at their status, never as a 500; a bailout (no status) writes no line.
 * Only the thrown error's own digest counts, as it does for Next.js: an error that merely carries one of these in its
 * `cause` is an ordinary error, which Next.js answers with a 500, so the wrapper logs it as one (unstable_rethrow
 * also looks into `cause`, so it cannot tell the two apart). Returns undefined for an ordinary error.
 */
export function nextControlFlow(error: unknown): ControlFlow | undefined {
  const digest = typeof error === 'object' && error !== null && 'digest' in error && typeof error.digest === 'string' ? error.digest : undefined;
  if (digest === undefined) {
    return undefined;
  }
  if (RENDERING_BAILOUTS.has(digest)) {
    return { name: digest };
  }
  const parts = digest.split(DIGEST_SEPARATOR);
  if (parts[0] === REDIRECT_DIGEST) {
    return statusFlow(REDIRECT_DIGEST, parts.at(REDIRECT_STATUS_FROM_END), REDIRECT_STATUS);
  }
  if (parts[0] === HTTP_FALLBACK_DIGEST) {
    return statusFlow(HTTP_FALLBACK_DIGEST, parts[1], HTTP_FALLBACK_STATUS);
  }
  return undefined;
}

/** The control flow with its status, or undefined (an ordinary error) when the status is not one Next.js accepts. */
function statusFlow(name: string, status: string | undefined, accepted: RegExp): ControlFlow | undefined {
  return status !== undefined && accepted.test(status) ? { name, status: Number(status) } : undefined;
}
```
