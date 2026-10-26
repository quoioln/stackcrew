// Default location: src/common/logging/body-masker.ts
import { loggingEnv, type LoggingEnv } from '../../config/env';

/**
 * The one masker for request, response and message bodies (core-logging, "Body masker"). Pure functions.
 * Keys match by whole word runs (no substring matching); masked values become "***"; long base64 strings become
 * their size; bodies are capped at maxBodyBytes after masking; anything but JSON and form bodies logs a placeholder.
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

/** LOG_MASK_FIELDS (unset or empty = DEFAULT_PII_FIELDS) and LOG_MAX_BODY_BYTES. */
export function loadMaskOptions(source: Pick<LoggingEnv, 'LOG_MASK_FIELDS' | 'LOG_MAX_BODY_BYTES'> = loggingEnv()): MaskOptions {
  const configured = source.LOG_MASK_FIELDS.split(',').map((field) => field.trim()).filter((field) => field !== '');
  return { piiFields: configured.length > 0 ? configured : DEFAULT_PII_FIELDS, maxBodyBytes: source.LOG_MAX_BODY_BYTES };
}

/** LOG_BODIES: false drops reqBody and resBody from every line. */
export function loadLogBodies(source: Pick<LoggingEnv, 'LOG_BODIES'> = loggingEnv()): boolean {
  return source.LOG_BODIES !== 'false';
}

/** The masked, capped body for a log field; undefined when there is no body. */
export function maskBody(raw: string | Buffer | undefined, contentType: string | undefined, opts: MaskOptions): string | undefined {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const type = mediaType(contentType);
  const size = Buffer.byteLength(raw);
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  if (type === FORM_TYPE) {
    return serializeMasked(parseForm(text), opts);
  }
  if (!isMaskable(contentType)) {
    return bodyPlaceholder(contentType, size);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return bodyPlaceholder(contentType, size);
  }
  return serializeMasked(parsed, opts);
}

/** Masks an already-parsed body (an object a handler returned, a parsed message): keys, nesting and base64; no size cap. */
export function maskValue(value: unknown, opts: MaskOptions): unknown {
  return maskWith(value, maskedKeys(opts));
}

/** maskValue, then compact JSON capped at maxBodyBytes: the log field for an already-parsed body. */
export function serializeMasked(value: unknown, opts: MaskOptions): string {
  return truncate(JSON.stringify(maskValue(value, opts)) ?? '', opts.maxBodyBytes);
}

/** True for the bodies the masker parses (JSON, *+json, form); everything else only ever logs its size. */
export function isMaskable(contentType: string | undefined): boolean {
  const type = mediaType(contentType);
  return type === JSON_TYPE || type.endsWith(JSON_SUFFIX) || type === FORM_TYPE;
}

/** Size-only placeholder: `<binary CT N bytes>` for files, `<CT N bytes>` for everything else. */
export function bodyPlaceholder(contentType: string | undefined, size: number): string {
  const type = mediaType(contentType);
  const binary = BINARY_TYPES.includes(type) || BINARY_PREFIXES.some((prefix) => type.startsWith(prefix));
  return `<${binary ? 'binary ' : ''}${type} ${size} bytes>`;
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

function maskWith(value: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => maskWith(item, keys));
  }
  if (typeof value === 'object' && value !== null && 'toJSON' in value && typeof value.toJSON === 'function') {
    const json: unknown = value.toJSON(); // a Date or a DTO with toJSON: mask what JSON.stringify would write
    return maskWith(json, keys);
  }
  if (typeof value === 'object' && value !== null) {
    // Object.fromEntries defines own properties, so a "__proto__" key stays a plain key
    return Object.fromEntries(Object.entries(value).map(([key, item]: [string, unknown]) =>
      [key, isMaskedKey(key, keys) ? MASK : maskWith(item, keys)]));
  }
  if (typeof value === 'string' && value.length > BASE64_MIN_EXCLUSIVE_LENGTH && BASE64.test(value)) {
    return `<base64 ${decodedSize(value)} bytes>`;
  }
  return value;
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
