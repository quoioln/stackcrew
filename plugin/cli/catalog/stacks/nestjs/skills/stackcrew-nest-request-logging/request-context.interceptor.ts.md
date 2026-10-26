Goes to `src/common/context/request-context.interceptor.ts`.

```ts
// Default location: src/common/context/request-context.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { requestContextOf, runWithRequestContext, safeRequestIdOrNew } from './request-context';

/**
 * Global (APP_INTERCEPTOR): runs the pipes, the handler and everything it awaits inside the request's context, which
 * the logging middleware and authentication bound to the request object. Nest binds the async context when
 * next.handle() is called, so calling it inside runWithRequestContext is enough.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<object>();
    const ctx = requestContextOf(req) ?? { requestId: safeRequestIdOrNew(undefined), roles: [] };
    return runWithRequestContext(ctx, () => next.handle());
  }
}
```
