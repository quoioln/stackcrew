Goes to `src/shared/logging/web-body.ts`.

```ts
// Default location: src/shared/logging/web-body.ts
import {
  bodyPlaceholder, CAPTURE_LIMIT_BYTES, isMaskable, jsonByteLength, maskBody, mediaType, placeholderFor, serializeMasked, type MaskOptions,
} from './body-masker';

const JSON_TYPE = 'application/json';
const CONTENT_TYPE = 'content-type';
const CONTENT_LENGTH = 'content-length';
const noop = (): void => undefined;

/** A fetch Request or Response, as far as the body helpers need it. */
export type BodySource = { readonly headers: Headers; readonly body: ReadableStream<Uint8Array> | null };

export function contentTypeOf(headers: Headers): string | undefined {
  return headers.get(CONTENT_TYPE) ?? undefined;
}

/**
 * Whether the body is worth a copy: JSON, *+json and form bodies within CAPTURE_LIMIT_BYTES (or with no declared
 * size). Anything else (a stream, SSE, a file, XML) is never copied or read for the log line: it logs its size only.
 * Response.json() and NextResponse.json() set no Content-Length, so a missing one means "read the copy, up to the cap".
 */
export function shouldCapture(message: BodySource): boolean {
  if (message.body === null) {
    return false;
  }
  const declared = declaredLength(message.headers);
  return isMaskable(contentTypeOf(message.headers)) && (declared === undefined || declared <= CAPTURE_LIMIT_BYTES);
}

/** The log field of a body that is not copied: `<CT N bytes>` from Content-Length, or none without a declared size. */
export function uncapturedBody(headers: Headers): string | undefined {
  const declared = declaredLength(headers);
  return declared !== undefined && declared > 0 ? bodyPlaceholder(contentTypeOf(headers), declared) : undefined;
}

/**
 * Reads a copy of a body (the stream of a clone()) and masks it. Past CAPTURE_LIMIT_BYTES it stops, cancels the copy
 * (the original stream is not affected) and logs `<CT N+ bytes>` with N = maxBodyBytes: the full size is unknown.
 * Rejects only when the stream itself fails; the caller then logs the line without the body.
 */
export async function capturedBody(copy: ReadableStream<Uint8Array>, contentType: string | undefined, opts: MaskOptions): Promise<string | undefined> {
  const reader = copy.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return maskBody(Buffer.concat(chunks), contentType, opts);
    }
    size += value.byteLength;
    if (size > CAPTURE_LIMIT_BYTES) {
      // stop the copy so the tee buffers no more for it; its cancel settles only when the original ends, so nothing waits on it
      void reader.cancel().then(noop, noop);
      return `<${mediaType(contentType)} ${opts.maxBodyBytes}+ bytes>`;
    }
    chunks.push(value);
  }
}

/**
 * The log field of an already-parsed value (server action arguments and results): masked after a JSON round-trip,
 * or `<application/json N bytes>` over CAPTURE_LIMIT_BYTES. Never throws.
 */
export function capturedValue(value: unknown, opts: MaskOptions): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const size = jsonByteLength(value);
  if (size === undefined) {
    return placeholderFor(value, JSON_TYPE, opts); // JSON.stringify throws: the size is unknown
  }
  return size > CAPTURE_LIMIT_BYTES ? bodyPlaceholder(JSON_TYPE, size) : serializeMasked(value, opts);
}

function declaredLength(headers: Headers): number | undefined {
  const text = headers.get(CONTENT_LENGTH);
  const size = text === null ? Number.NaN : Number(text);
  return Number.isSafeInteger(size) && size >= 0 ? size : undefined;
}
```
