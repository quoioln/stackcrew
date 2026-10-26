Goes to `src/common/logging/body-masker.spec.ts`.

```ts
// Default location: src/common/logging/body-masker.spec.ts
import {
  DEFAULT_PII_FIELDS, loadLogBodies, loadMaskOptions, maskBody, maskValue, placeholderFor, serializeMasked, type MaskOptions,
} from './body-masker';

const JSON_TYPE = 'application/json';
const DEFAULTS: MaskOptions = { piiFields: DEFAULT_PII_FIELDS, maxBodyBytes: 16384 };
const mask = (json: string, opts: MaskOptions = DEFAULTS): string | undefined => maskBody(json, JSON_TYPE, opts);

describe('maskBody (core-logging masker contract)', () => {
  it.each(['password', 'newPassword', 'confirm_password', 'ACCESS_TOKEN', 'access-token', 'tokenType', 'Authorization', 'set-cookie',
    'otp', 'pin', 'cvv', 'email', 'customerEmail', 'phoneNumber', 'mobile', 'fullName', 'dateOfBirth', 'homeAddress', 'national_id',
    'nationalIdNumber', 'cccd', 'passportNumber', 'cardNumber', 'accountNumber'])('masks %s', (key) => {
    expect(mask(`{"${key}":"v"}`)).toBe(`{"${key}":"***"}`);
  });

  it.each(['shipping', 'company', 'spanId', 'footprint', 'pinned', 'id', 'orderId', 'amount', 'status', 'name', 'typeName', 'address2'])(
    'keeps %s', (key) => {
      expect(mask(`{"${key}":"v"}`)).toBe(`{"${key}":"v"}`);
    });

  it('replaces the default PII list with the configured one, never the secrets', () => {
    const onlyEmail = loadMaskOptions({ LOG_MASK_FIELDS: 'email', LOG_MAX_BODY_BYTES: 16384 });
    expect(mask('{"email":"a","phoneNumber":"b","password":"c"}', onlyEmail)).toBe('{"email":"***","phoneNumber":"b","password":"***"}');
    const profile = loadMaskOptions({ LOG_MASK_FIELDS: 'profile', LOG_MAX_BODY_BYTES: 16384 });
    expect(mask('{"profile":{"x":1}}', profile)).toBe('{"profile":"***"}');
    expect(loadMaskOptions({ LOG_MASK_FIELDS: ' , ', LOG_MAX_BODY_BYTES: 16384 }).piiFields).toEqual(DEFAULT_PII_FIELDS);
    expect(loadLogBodies({ LOG_BODIES: 'false' })).toBe(false);
    expect(loadLogBodies({ LOG_BODIES: 'true' })).toBe(true);
  });

  it('masks nested objects and arrays', () => {
    expect(mask('{"customer":{"contact":{"phone":"0901"}},"items":[{"cardNumber":"4111"}]}'))
      .toBe('{"customer":{"contact":{"phone":"***"}},"items":[{"cardNumber":"***"}]}');
  });

  it('replaces base64 longer than 1024 chars with its size', () => {
    const exactly1024 = 'A'.repeat(1024);
    expect(mask(`{"img":"${exactly1024}"}`)).toBe(`{"img":"${exactly1024}"}`);
    expect(mask(`{"img":"${'A'.repeat(1028)}"}`)).toBe('{"img":"<base64 771 bytes>"}');
    expect(mask(`{"img":"data:image/png;base64,${'A'.repeat(1100)}=="}`)).toBe('{"img":"<base64 824 bytes>"}');
  });

  it('truncates after 16384 bytes', () => {
    const exact = `{"n":"${'a b '.repeat(4094)}"}`;
    expect(Buffer.byteLength(exact)).toBe(16384);
    expect(mask(exact)).toBe(exact);
    const over = `{"n":"${'a b '.repeat(4094)}c"}`;
    expect(mask(over)).toBe(`${over.slice(0, 16384)}...[truncated 16385 bytes]`);
  });

  it('cuts on a character boundary', () => {
    const body = `{"n":"${'a-'.repeat(8188)}aé"}`; // the 2-byte é sits on bytes 16383 and 16384
    expect(Buffer.byteLength(body)).toBe(16387);
    expect(mask(body)).toBe(`${body.slice(0, 16383)}...[truncated 16387 bytes]`);
  });

  it('logs a placeholder for content it cannot mask', () => {
    expect(maskBody(Buffer.alloc(300), 'text/xml', DEFAULTS)).toBe('<text/xml 300 bytes>');
    expect(maskBody('{bad', JSON_TYPE, DEFAULTS)).toBe('<application/json 4 bytes>');
    expect(maskBody(Buffer.alloc(5000), 'image/jpeg', DEFAULTS)).toBe('<binary image/jpeg 5000 bytes>');
    expect(maskBody('x', undefined, DEFAULTS)).toBe('<unknown 1 bytes>');
    expect(maskBody('{"a":1}', 'Application/JSON; charset=utf-8', DEFAULTS)).toBe('{"a":1}');
    expect(maskBody('{"password":"p"}', 'application/problem+json', DEFAULTS)).toBe('{"password":"***"}');
    expect(maskBody('', JSON_TYPE, DEFAULTS)).toBeUndefined();
    expect(maskBody(undefined, JSON_TYPE, DEFAULTS)).toBeUndefined();
  });

  it('parses form bodies: last repeated key wins, a key without "=" is empty', () => {
    const FORM = 'application/x-www-form-urlencoded';
    expect(maskBody('email=a%40b.c&amount=10', FORM, DEFAULTS)).toBe('{"email":"***","amount":"10"}');
    expect(maskBody('a=1&a=2&flag', FORM, DEFAULTS)).toBe('{"a":"2","flag":""}');
  });

  it('keeps a __proto__ key as data and masks already-parsed values', () => {
    expect(mask('{"__proto__":{"password":"p"}}')).toBe('{"__proto__":{"password":"***"}}');
    expect(maskValue({ when: new Date(0), otp: 1 }, DEFAULTS)).toEqual({ when: '1970-01-01T00:00:00.000Z', otp: '***' });
  });

  it('masks a body nested 64 deep and logs only the size past that, without throwing', () => {
    const nest = (depth: number): string => `${'['.repeat(depth)}${']'.repeat(depth)}`;
    expect(mask(nest(64))).toBe(nest(64));
    expect(mask(nest(65))).toBe('<application/json 130 bytes>');
    expect(mask(nest(50000))).toBe('<application/json 100000 bytes>');
    expect(mask(`{"a":${nest(70)}}`)).toBe('<application/json 146 bytes>');
    expect(maskValue(JSON.parse(nest(65)), DEFAULTS)).toBe('<application/json 130 bytes>');
    // an already-parsed value is sized only up to maxBodyBytes: N+ means "larger than that"
    expect(serializeMasked(JSON.parse(nest(50000)), DEFAULTS, 'application/problem+json')).toBe('<application/problem+json 16384+ bytes>');
  });

  it('returns for a cyclic value and for a toJSON that returns itself', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    expect(serializeMasked(a, DEFAULTS)).toBe('<application/json 16384+ bytes>');
    expect(maskValue(a, DEFAULTS)).toBe('<application/json 16384+ bytes>');
    const self = { a: 1, password: 'p', toJSON(): unknown { return this; } };
    expect(serializeMasked(self, DEFAULTS)).toBe('{"a":1,"password":"***"}');
  });

  it('never copies a function onto the masked copy: a copied toJSON would run on the unmasked original', () => {
    class Dto {
      password = 'p4ss';
      email = 'a@b.c';
      toJSON = (): unknown => ({ ...this, kind: 'dto' }); // an arrow stays bound to the original instance
    }
    expect(serializeMasked(new Dto(), DEFAULTS)).toBe('{"password":"***","email":"***","kind":"dto"}');
    expect(JSON.stringify(maskValue(new Dto(), DEFAULTS))).toBe('{"password":"***","email":"***","kind":"dto"}');
    const inner = { note: 'ok', toJSON: (): unknown => ({ password: 'leak-from-copied-toJSON' }) };
    const outer = { toJSON: (): unknown => inner }; // JSON.stringify runs one toJSON per value: it writes {"note":"ok"}
    expect(serializeMasked(outer, DEFAULTS)).toBe('{"note":"ok"}');
    expect(serializeMasked({ body: outer }, DEFAULTS)).toBe('{"body":{"note":"ok"}}');
    const fn = Object.assign(() => 1, { toJSON: (): unknown => ({ password: 'leak' }) });
    expect(serializeMasked([fn], DEFAULTS)).toBe('[null]');
  });

  it('stops sizing a wide value at the cap without walking it', () => {
    const sparse: unknown[] = [];
    sparse.length = 200_000_000;
    expect(placeholderFor(sparse, 'text/csv', DEFAULTS)).toBe('<text/csv 16384+ bytes>');
    const wide = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`key-${'k'.repeat(20)}-${i}`, i]));
    expect(placeholderFor(wide, 'text/csv', DEFAULTS)).toBe('<text/csv 16384+ bytes>');
    expect(placeholderFor({ a: [1, 2] }, 'text/csv', DEFAULTS)).toBe('<text/csv 11 bytes>'); // {"a":[1,2]}
  });

  it('masks a toJSON result in place: a DTO whose JSON is 64 deep is masked like the plain value', () => {
    let dto: unknown = { toJSON: () => ({ password: 'p' }) };
    let plain: unknown = { password: 'p' };
    for (let i = 1; i < 64; i++) {
      dto = [dto];
      plain = [plain];
    }
    expect(serializeMasked(dto, DEFAULTS)).toBe(serializeMasked(plain, DEFAULTS));
    expect(serializeMasked(plain, DEFAULTS)).toContain('{"password":"***"}');
  });

  it('never throws, even for a value whose getter throws', () => {
    const hostile = { get email(): string { throw new Error('boom'); } };
    expect(serializeMasked(hostile, DEFAULTS)).toBe('<application/json 0 bytes>');
    expect(maskValue(hostile, DEFAULTS)).toBe('<application/json 0 bytes>');
  });
});
```
