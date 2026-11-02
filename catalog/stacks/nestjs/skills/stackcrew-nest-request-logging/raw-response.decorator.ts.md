Goes to `src/common/api/raw-response.decorator.ts`.

```ts
// Default location: src/common/api/raw-response.decorator.ts
import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'rawResponse';

/**
 * On a handler or a controller: TransformInterceptor sends the value as it is, without the success envelope. For the
 * health check (@nestjs/terminus) and a format a third party fixes. Errors still get the error envelope.
 */
export const RawResponse = (): CustomDecorator<string> => SetMetadata(RAW_RESPONSE_KEY, true);
```
