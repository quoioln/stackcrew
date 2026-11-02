Goes to `src/common/api/raw-response.decorator.ts`.

```ts
// Default location: src/common/api/raw-response.decorator.ts
import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

export const RAW_RESPONSE_KEY = 'rawResponse';

/**
 * On a handler or a controller: TransformInterceptor sends the value as it is, without the success envelope. For the
 * health check (@nestjs/terminus) and a format a third party fixes. An HttpException thrown by such a handler keeps its
 * own status and body (terminus answers 503 with its details); any other error still gets the error envelope.
 */
export const RawResponse = (): CustomDecorator<string> => SetMetadata(RAW_RESPONSE_KEY, true);

const rawRequests = new WeakSet<IncomingMessage>();

/**
 * Called by TransformInterceptor, which reads the metadata, for a request whose handler is raw. The filter cannot read
 * the metadata itself: Nest hands it a host without the handler or the controller class.
 */
export function markRawRequest(req: IncomingMessage): void {
  rawRequests.add(req);
}

export function isRawRequest(req: IncomingMessage): boolean {
  return rawRequests.has(req);
}
```
