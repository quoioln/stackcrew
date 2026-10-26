Goes to `src/common/messaging/message-errors.ts`.

```ts
// Default location: src/common/messaging/message-errors.ts
import { CrossTenantDeniedError, MissingTenantError } from '../context/request-context';

/** Why a message was parked: constant codes, never text taken from the payload. */
export const ParkReason = {
  EMPTY: 'empty_payload',
  NOT_JSON: 'not_json',
  INVALID: 'invalid_message',
  NO_TENANT: 'missing_tenant',
  BUSINESS_RULE: 'business_rule',
  ATTEMPTS: 'attempts_exhausted',
} as const;
export type ParkReason = (typeof ParkReason)[keyof typeof ParkReason];

/** A message that can never succeed: parked at once, never retried. Its message is the constant reason code. */
export class NonRetryableMessageError extends Error {
  constructor(readonly reason: ParkReason) {
    super(reason);
    this.name = new.target.name;
  }
}

/** An empty payload (a tombstone), text that is not a JSON object, or a message that breaks its schema. */
export class InvalidMessageError extends NonRetryableMessageError {}

/** The park reason of a failure, or undefined when a later attempt may succeed (a database or network error). */
export function parkReasonOf(failure: unknown): ParkReason | undefined {
  if (failure instanceof NonRetryableMessageError) {
    return failure.reason;
  }
  if (failure instanceof MissingTenantError || failure instanceof CrossTenantDeniedError) {
    return ParkReason.NO_TENANT; // the headers carry no usable tenant: a retry sees the same headers
  }
  return undefined;
}
```
