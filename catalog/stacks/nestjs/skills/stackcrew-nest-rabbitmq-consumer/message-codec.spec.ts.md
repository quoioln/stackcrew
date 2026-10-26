Goes to `src/common/messaging/message-codec.spec.ts`.

```ts
// Default location: src/common/messaging/message-codec.spec.ts
import { Equals, IsISO8601, IsString, IsUUID } from 'class-validator';
import { MissingTenantError } from '../context/request-context';
import { decodeMessage } from './message-codec';
import { InvalidMessageError, ParkReason, parkReasonOf } from './message-errors';
import type { MessageEnvelope } from './messaging.types';

class SampleCreated implements MessageEnvelope {
  @IsUUID() readonly messageId!: string;
  @Equals('sample.created') readonly type!: string;
  @Equals(1) readonly version!: number;
  @IsISO8601({ strict: true }) readonly occurredAt!: string;
  @IsString() readonly name!: string;
}

const VALID = { messageId: 'c1d5f0b2-3e4a-4b5c-8d6e-7f8091a2b3c4', type: 'sample.created', version: 1, occurredAt: '2026-10-27T08:00:00Z', name: 'n' };
const payload = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
const reasonOf = (raw: Buffer | undefined): unknown => {
  try {
    decodeMessage(SampleCreated, raw);
    return 'decoded';
  } catch (failure: unknown) {
    return failure instanceof InvalidMessageError ? failure.reason : failure;
  }
};

describe('decodeMessage', () => {
  it('returns the typed message and drops unknown fields', () => {
    const message = decodeMessage(SampleCreated, payload({ ...VALID, addedLater: 'x' }));
    expect(message).toBeInstanceOf(SampleCreated);
    expect(message).toEqual({ ...VALID });
  });

  it.each([
    ['a missing payload', undefined, ParkReason.EMPTY],
    ['an empty payload (a tombstone)', Buffer.alloc(0), ParkReason.EMPTY],
    ['text that is not JSON', Buffer.from('{"messageId":'), ParkReason.NOT_JSON],
    ['a JSON array', payload([VALID]), ParkReason.NOT_JSON],
    ['a JSON string', payload('hello'), ParkReason.NOT_JSON],
    ['a missing field', payload({ ...VALID, name: undefined }), ParkReason.INVALID],
    ['a wrong type', payload({ ...VALID, type: 'sample.deleted' }), ParkReason.INVALID],
    ['a wrong version', payload({ ...VALID, version: 2 }), ParkReason.INVALID],
  ])('rejects %s as InvalidMessageError (%s)', (_case, raw, reason) => {
    expect(reasonOf(raw)).toBe(reason);
  });

  it('never puts the payload in the error message', () => {
    expect(() => decodeMessage(SampleCreated, Buffer.from('{"password":"p4ss"'))).toThrow(new InvalidMessageError(ParkReason.NOT_JSON));
  });
});

describe('parkReasonOf', () => {
  it('parks invalid messages and missing tenants, and retries everything else', () => {
    expect(parkReasonOf(new InvalidMessageError(ParkReason.INVALID))).toBe(ParkReason.INVALID);
    expect(parkReasonOf(new MissingTenantError())).toBe(ParkReason.NO_TENANT);
    expect(parkReasonOf(new Error('connection terminated'))).toBeUndefined();
  });
});
```
