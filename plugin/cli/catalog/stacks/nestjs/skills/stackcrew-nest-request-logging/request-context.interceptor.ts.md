Goes to `src/common/context/request-context.interceptor.ts`.

```ts
// Default location: src/common/context/request-context.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { Observable } from 'rxjs';
import { requestContextOf, runWithRequestContext, safeRequestIdOrNew } from './request-context';

/**
 * Global (APP_INTERCEPTOR): runs the pipes, the handler and everything it awaits inside the request's context, which
 * the logging middleware and authentication bound to the request object. The subscription itself happens inside
 * runWithRequestContext, so this works on every NestJS 10 release, with or without Nest's own async-context binding.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<IncomingMessage>();
    const ctx = requestContextOf(req) ?? { requestId: safeRequestIdOrNew(undefined), roles: [] };
    return new Observable<unknown>((subscriber) => runWithRequestContext(ctx, () => next.handle().subscribe(subscriber)));
  }
}
```
