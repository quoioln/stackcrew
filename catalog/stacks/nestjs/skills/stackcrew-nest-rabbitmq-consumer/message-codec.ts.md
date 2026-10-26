Goes to `src/common/messaging/message-codec.ts`.

```ts
// Default location: src/common/messaging/message-codec.ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { InvalidMessageError, ParkReason } from './message-errors';
import type { MessageEnvelope } from './messaging.types';

/**
 * Parses a payload once, at the edge, into its message class. An empty payload (a tombstone), text that is not a JSON
 * object, or a message that breaks its class-validator rules is an InvalidMessageError: never retried. Unknown fields
 * are dropped (whitelist), so a producer can add a field without breaking this consumer. The JSON error is not kept as
 * a cause: its message quotes the payload.
 */
export function decodeMessage<T extends MessageEnvelope>(type: new () => T, payload: Buffer | undefined): T {
  if (payload === undefined || payload.length === 0) {
    throw new InvalidMessageError(ParkReason.EMPTY);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch {
    throw new InvalidMessageError(ParkReason.NOT_JSON);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidMessageError(ParkReason.NOT_JSON);
  }
  const message = plainToInstance(type, parsed);
  if (validateSync(message, { whitelist: true }).length > 0) {
    throw new InvalidMessageError(ParkReason.INVALID);
  }
  return message;
}
```
