Goes to `src/shared/logging/next-control-flow.ts`.

```ts
// Default location: src/shared/logging/next-control-flow.ts
import { unstable_rethrow } from 'next/navigation';

/** A throw Next.js uses for control flow, as the logging wrappers report it before rethrowing it unchanged. */
export type ControlFlow = { name: string; status?: number };

const REDIRECT_DIGEST = 'NEXT_REDIRECT';
const HTTP_FALLBACK_DIGEST = 'NEXT_HTTP_ERROR_FALLBACK';
const OTHER_CONTROL_FLOW = 'NEXT_CONTROL_FLOW';
const DIGEST_SEPARATOR = ';';
const HTTP_STATUS = /^[1-5]\d\d$/;
/** A redirect digest ends with ";<status>;": the status is the part before the last, empty one. */
const REDIRECT_STATUS_FROM_END = -2;

/**
 * Next.js ends a request early by throwing: redirect() and permanentRedirect(), notFound(), forbidden(), unauthorized(),
 * and the dynamic-rendering bailouts of a build. A wrapper that catches errors must rethrow these unchanged and must
 * not log them as a 500. Detection goes through the public unstable_rethrow, which rethrows exactly these; the status
 * comes from the error's digest: "NEXT_REDIRECT;<type>;<url>;<status>;" and "NEXT_HTTP_ERROR_FALLBACK;<status>".
 * Returns undefined for an ordinary error. A bailout has no status: it is Next deciding how to render, not an outcome.
 */
export function nextControlFlow(error: unknown): ControlFlow | undefined {
  try {
    unstable_rethrow(error);
  } catch {
    return controlFlowOf(error); // the caller rethrows the original error itself
  }
  return undefined;
}

function controlFlowOf(error: unknown): ControlFlow {
  const digest = typeof error === 'object' && error !== null && 'digest' in error && typeof error.digest === 'string' ? error.digest : '';
  const parts = digest.split(DIGEST_SEPARATOR);
  if (parts[0] === REDIRECT_DIGEST) {
    return { name: REDIRECT_DIGEST, status: statusOf(parts.at(REDIRECT_STATUS_FROM_END)) };
  }
  if (parts[0] === HTTP_FALLBACK_DIGEST) {
    return { name: HTTP_FALLBACK_DIGEST, status: statusOf(parts[1]) };
  }
  return { name: OTHER_CONTROL_FLOW };
}

function statusOf(text: string | undefined): number | undefined {
  return text !== undefined && HTTP_STATUS.test(text) ? Number(text) : undefined;
}
```
