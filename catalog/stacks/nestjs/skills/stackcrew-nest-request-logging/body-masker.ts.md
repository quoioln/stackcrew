Goes to `src/common/logging/body-masker.ts`.

```ts
// Default location: src/common/logging/body-masker.ts
import { loggingEnv, type LoggingEnv } from '../../config/env';

/**
 * The one masker for request, response and message bodies (core-logging, "Body masker"). Pure functions.
 * Keys match by whole word runs (no substring matching); masked values become "***"; long base64 strings become
 * their size; bodies are capped at maxBodyBytes after masking; anything but JSON and form bodies logs a placeholder.
 * The masker only ever walks plain data: parsed JSON, parsed form pairs, or an already-parsed value after a JSON
 * round-trip (jsonText). It never walks a live object graph, so no toJSON, getter, class or Array subclass of the
 * original can reach the line or run again when the masked copy is serialized.
 */

export const SECRET_FIELDS = ['password', 'passwd', 'secret', 'token', 'accessToken', 'refreshToken', 'idToken', 'apiKey',
  'clientSecret', 'privateKey', 'authorization', 'cookie', 'setCookie', 'otp', 'pin', 'cvv', 'cvc'] as const;
export const DEFAULT_PII_FIELDS = ['email', 'phone', 'phoneNumber', 'mobile', 'fullName', 'dob', 'dateOfBirth', 'address',
  'nationalId', 'idNumber', 'cccd', 'cmnd', 'passport', 'passportNumber', 'cardNumber', 'pan', 'accountNumber'] as const;

export type MaskOptions = { piiFields: readonly string[]; maxBodyBytes: number };

const MASK = '***';
const UNKNOWN_TYPE = 'unknown';
const JSON_TYPE = 'application/json';
const JSON_SUFFIX = '+json';
const FORM_TYPE = 'application/x-www-form-urlencoded';
const BINARY_PREFIXES = ['multipart/', 'image/'];
const BINARY_TYPES = ['application/octet-stream', 'application/pdf'];
/** camelCase boundaries (aB -> a|B, ABc -> A|Bc), underscores, hyphens and spaces. Digits are not a boundary. */
const WORD_SEPARATOR = /[_\- ]+|(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/;
const BASE64 = /^(data:[\w/+.-]+;base64,)?[A-Za-z0-9+/\r\n]+={0,2}$/;
const BASE64_MIN_EXCLUSIVE_LENGTH = 1024;
const BASE64_CHARS_PER_GROUP = 4;
const BASE64_BYTES_PER_GROUP = 3;
const UTF8_CONTINUATION_MASK = 0xc0;
const UTF8_CONTINUATION_BITS = 0x80;
/** A body nested deeper than this (objects or arrays) logs only its size: the walk never recurses without a bound. */
const MAX_NESTING_DEPTH = 64;

/** Thrown inside the walk past MAX_NESTING_DEPTH; the exported functions turn it into a size placeholder. */
class NestingTooDeep extends Error {}

/** LOG_MASK_FIELDS (unset or empty = DEFAULT_PII_FIELDS) and LOG_MAX_BODY_BYTES. */
export function loadMaskOptions(source: Pick<LoggingEnv, 'LOG_MASK_FIELDS' | 'LOG_MAX_BODY_BYTES'> = loggingEnv()): MaskOptions {
  const configured = source.LOG_MASK_FIELDS.split(',').map((field) => field.trim()).filter((field) => field !== '');
  return { piiFields: configured.length > 0 ? configured : DEFAULT_PII_FIELDS, maxBodyBytes: source.LOG_MAX_BODY_BYTES };
}

/** LOG_BODIES: false drops reqBody and resBody from every line. */
export function loadLogBodies(source: Pick<LoggingEnv, 'LOG_BODIES'> = loggingEnv()): boolean {
  return source.LOG_BODIES !== 'false';
}

/**
 * The masked, capped body for a log field; undefined when there is no body. Never throws: unparseable JSON, a body
 * nested deeper than MAX_NESTING_DEPTH, or any other failure gives the `<CT N bytes>` placeholder.
 */
export function maskBody(raw: string | Buffer | undefined, contentType: string | undefined, opts: MaskOptions): string | undefined {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const size = Buffer.byteLength(raw);
  try {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    if (mediaType(contentType) === FORM_TYPE) {
      return serialize(maskWith(parseForm(text), maskedKeys(opts), 1), opts.maxBodyBytes);
    }
    if (!isMaskable(contentType)) {
      return bodyPlaceholder(contentType, size);
    }
    return serialize(maskWith(JSON.parse(text), maskedKeys(opts), 1), opts.maxBodyBytes);
  } catch {
    return bodyPlaceholder(contentType, size); // JSON that does not parse, or nested too deep, logs its size only
  }
}

/**
 * Masks an already-parsed body (an object a handler returned, a parsed message), as plain data; no size cap.
 * The value is first normalized by a guarded JSON round-trip (jsonText, then JSON.parse), so what is masked is exactly
 * what JSON.stringify would write: toJSON applied once per value, functions and symbols dropped, Array subclasses, boxed
 * primitives, Maps, Buffers and typed arrays reduced to plain arrays, objects and primitives. The result holds nothing
 * but plain data, so serializing it later runs no user code. When JSON.stringify throws (a cycle, a BigInt, a getter or
 * toJSON that throws, nesting that overflows the stack) the size is unknown: `<CT maxBodyBytes+ bytes>`. When the data
 * nests deeper than MAX_NESTING_DEPTH: `<CT N bytes>` with its exact size. Never throws.
 */
export function maskValue(value: unknown, opts: MaskOptions): unknown {
  const text = jsonText(value);
  if (text === undefined) {
    return placeholderText(JSON_TYPE, overCap(opts));
  }
  try {
    return maskWith(parseJson(text), maskedKeys(opts), 1);
  } catch {
    return bodyPlaceholder(JSON_TYPE, Buffer.byteLength(text)); // nested deeper than MAX_NESTING_DEPTH
  }
}

/** maskValue, then compact JSON capped at maxBodyBytes: the log field for an already-parsed body. Never throws. */
export function serializeMasked(value: unknown, opts: MaskOptions, contentType: string = JSON_TYPE): string {
  const text = jsonText(value);
  if (text === undefined) {
    return placeholderText(contentType, overCap(opts));
  }
  try {
    return serialize(maskWith(parseJson(text), maskedKeys(opts), 1), opts.maxBodyBytes);
  } catch {
    return bodyPlaceholder(contentType, Buffer.byteLength(text)); // nested deeper than MAX_NESTING_DEPTH
  }
}

/**
 * The size placeholder of an already-parsed value that is not masked: `<CT N bytes>` with N the size of what
 * JSON.stringify writes for it, or `<CT N+ bytes>` with N = maxBodyBytes when JSON.stringify throws (a cycle, a BigInt,
 * a getter or toJSON that throws, nesting that overflows the stack) and the size is unknown. Never throws.
 */
export function placeholderFor(value: unknown, contentType: string | undefined, opts: MaskOptions): string {
  const text = jsonText(value);
  return text === undefined ? placeholderText(contentType, overCap(opts)) : bodyPlaceholder(contentType, Buffer.byteLength(text));
}

/** True for the bodies the masker parses (JSON, *+json, form); everything else only ever logs its size. */
export function isMaskable(contentType: string | undefined): boolean {
  const type = mediaType(contentType);
  return type === JSON_TYPE || type.endsWith(JSON_SUFFIX) || type === FORM_TYPE;
}

/** Size-only placeholder: `<binary CT N bytes>` for files, `<CT N bytes>` for everything else. */
export function bodyPlaceholder(contentType: string | undefined, size: number): string {
  return placeholderText(contentType, String(size));
}

function placeholderText(contentType: string | undefined, size: string): string {
  const type = mediaType(contentType);
  const binary = BINARY_TYPES.includes(type) || BINARY_PREFIXES.some((prefix) => type.startsWith(prefix));
  return `<${binary ? 'binary ' : ''}${type} ${size} bytes>`;
}

function overCap(opts: MaskOptions): string {
  return `${opts.maxBodyBytes}+`;
}

/** The media type without parameters, lower case, CR and LF removed; `unknown` when missing. */
export function mediaType(contentType: string | undefined): string {
  const type = (contentType ?? '').split(';')[0].replace(/[\r\n]/g, '').trim().toLowerCase();
  return type === '' ? UNKNOWN_TYPE : type;
}

const keyCache = new WeakMap<readonly string[], ReadonlySet<string>>();

function maskedKeys(opts: MaskOptions): ReadonlySet<string> {
  let keys = keyCache.get(opts.piiFields);
  if (keys === undefined) {
    const pii = opts.piiFields.length > 0 ? opts.piiFields : DEFAULT_PII_FIELDS;
    keys = new Set([...SECRET_FIELDS, ...pii].map((entry) => words(entry).join('')));
    keyCache.set(opts.piiFields, keys);
  }
  return keys;
}

/**
 * What JSON.stringify writes for the value ('' when it writes nothing: undefined, a function, a symbol), or undefined
 * when it throws: a cycle, a BigInt, a getter or toJSON that throws, or nesting deep enough to overflow the stack.
 * This is the one place user code (toJSON, getters) runs, once, exactly as the final serialization would run it.
 */
function jsonText(value: unknown): string | undefined {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return undefined;
  }
}

/** The plain data behind JSON text from jsonText: only arrays, objects, strings, numbers, booleans and null. */
function parseJson(text: string): unknown {
  return text === '' ? undefined : JSON.parse(text);
}

/** Compact JSON of the masked data, capped at maxBodyBytes. */
function serialize(masked: unknown, maxBodyBytes: number): string {
  return truncate(JSON.stringify(masked) ?? '', maxBodyBytes);
}

/**
 * Walks plain data only (parsed JSON or form pairs). Recursive, but never deeper than MAX_NESTING_DEPTH: depth 1 is the
 * body itself. The copy is built from Object.fromEntries and Array.prototype.map on plain arrays, so it carries no
 * prototype, toJSON or function of the input.
 */
function maskWith(value: unknown, keys: ReadonlySet<string>, depth: number): unknown {
  if (typeof value !== 'object' || value === null) {
    const base64 = typeof value === 'string' && value.length > BASE64_MIN_EXCLUSIVE_LENGTH && BASE64.test(value);
    return base64 ? `<base64 ${decodedSize(value)} bytes>` : value;
  }
  if (depth > MAX_NESTING_DEPTH) {
    throw new NestingTooDeep();
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => maskWith(item, keys, depth + 1));
  }
  // Object.fromEntries defines own properties, so a "__proto__" key stays a plain key
  return Object.fromEntries(Object.entries(value).map(([key, item]: [string, unknown]) => [key, isMaskedKey(key, keys) ? MASK : maskWith(item, keys, depth + 1)]));
}

/** True when any contiguous run of the key's words, joined, is in the list. */
function isMaskedKey(key: string, keys: ReadonlySet<string>): boolean {
  const parts = words(key);
  for (let start = 0; start < parts.length; start++) {
    let run = '';
    for (let end = start; end < parts.length; end++) {
      run += parts[end];
      if (keys.has(run)) {
        return true;
      }
    }
  }
  return false;
}

function words(key: string): string[] {
  return key.split(WORD_SEPARATOR).filter((word) => word !== '').map((word) => word.toLowerCase());
}

/** Repeated key: the last value wins; a key without "=" gets "". */
function parseForm(text: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(text).entries());
}

/** floor(payloadLength * 3 / 4) - padding, where the payload follows the comma of a data: URI. */
function decodedSize(value: string): number {
  const payload = value.slice(value.indexOf(',') + 1);
  const padding = payload.length - payload.replace(/=+$/, '').length;
  return Math.floor((payload.length * BASE64_BYTES_PER_GROUP) / BASE64_CHARS_PER_GROUP) - padding;
}

function truncate(serialized: string, maxBodyBytes: number): string {
  const bytes = Buffer.from(serialized, 'utf8');
  if (bytes.length <= maxBodyBytes) {
    return serialized;
  }
  let cut = maxBodyBytes;
  while (cut > 0 && (bytes[cut] & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_BITS) {
    cut--;
  }
  return `${bytes.subarray(0, cut).toString('utf8')}...[truncated ${bytes.length} bytes]`;
}
```
