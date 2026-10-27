Goes to `src/shared/http/read-json-body.ts`.

```ts
// Default location: src/shared/http/read-json-body.ts
import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { HTTP_STATUS, ProblemText, problemResponse, type ProblemDetails } from './problem-details';

/** application/json and the structured suffix types (application/merge-patch+json...), without parameters. */
const JSON_MEDIA_TYPE = /^application\/(?:[\w.-]+\+)?json$/;

export type JsonBody = { ok: true; value: unknown } | { ok: false; response: NextResponse<ProblemDetails> };

/**
 * The request body as `unknown` JSON, for the zod schema to parse. A body that is not JSON answers 415 and malformed
 * JSON answers 400, both as problems with constant text; any other read failure (the client went away) is rethrown.
 */
export async function readJsonBody(req: NextRequest): Promise<JsonBody> {
  const mediaType = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!JSON_MEDIA_TYPE.test(mediaType)) {
    return { ok: false, response: problemResponse(HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE, ProblemText.UNSUPPORTED_MEDIA_TYPE) };
  }
  try {
    const value: unknown = await req.json();
    return { ok: true, value };
  } catch (failure: unknown) {
    if (failure instanceof SyntaxError) {
      return { ok: false, response: problemResponse(HTTP_STATUS.BAD_REQUEST, ProblemText.MALFORMED_JSON) };
    }
    throw failure;
  }
}
```
