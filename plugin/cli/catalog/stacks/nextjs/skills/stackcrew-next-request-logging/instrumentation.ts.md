Goes to `src/instrumentation.ts`.

```ts
// Default location: src/instrumentation.ts (next to src/app; at the project root without a src folder)
import type { Instrumentation } from 'next';

/**
 * Next.js calls this for every error that escapes a Server Component render, a route handler, a server action or
 * proxy.ts: the errors no wrapper caught, and those the wrappers rethrew. It writes one `unhandled_error` line with the
 * error class, the digest and the stack frames, never the message (core-logging). The http_in line of a wrapped call
 * is written by its wrapper; this line is in addition to it.
 * Next.js also builds this file for the Edge runtime and replaces process.env.NEXT_RUNTIME at build time: only this
 * literal check, here, lets it drop the Node-only logger from the Edge bundle (a helper in src/env.ts does not).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // eslint-disable-next-line no-restricted-properties -- bootstrap: NEXT_RUNTIME is a build-time constant, read before any module
  if (process.env.NEXT_RUNTIME === 'nodejs') { // stackcrew-allow: SC-ENV build-time constant that removes the Node-only import from the Edge bundle
    const { logUnhandledError } = await import('./shared/logging/unhandled-error');
    logUnhandledError(error, request, context);
  }
};
```
