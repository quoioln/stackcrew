Goes to `src/common/api/transform.interceptor.ts`.

```ts
// Default location: src/common/api/transform.interceptor.ts
import { Injectable, StreamableFile, type CallHandler, type ExecutionContext, type NestInterceptor, type Type } from '@nestjs/common';
import { RESPONSE_PASSTHROUGH_METADATA, ROUTE_ARGS_METADATA, SSE_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage } from 'node:http';
import { map, type Observable } from 'rxjs';
import { requestIdsOf } from '../context/request-context';
import { successEnvelope } from './api-response';
import { RAW_RESPONSE_KEY } from './raw-response.decorator';

/**
 * Global (APP_INTERCEPTOR, after RequestContextInterceptor): wraps what a handler returns in the success envelope, with
 * the ids the logging middleware bound to the request and sent as headers. undefined (a void handler) becomes data: null.
 * Left as they are: a StreamableFile, an @Sse() stream (each event would be wrapped), a handler that sends the response
 * itself through @Res() or @Next() without passthrough (Nest ignores its return value), and a handler or controller
 * marked @RawResponse().
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http' || this.isRaw(context)) {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<IncomingMessage>();
    return next.handle().pipe(map((value: unknown) => (value instanceof StreamableFile ? value : successEnvelope(value, requestIdsOf(req)))));
  }

  private isRaw(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    return this.reflector.getAllAndOverride<boolean | undefined>(RAW_RESPONSE_KEY, [handler, context.getClass()]) === true
      || this.reflector.get<boolean | undefined>(SSE_METADATA, handler) === true
      || sendsResponseItself(context.getClass(), handler.name);
  }
}

/** Nest's own rule (RouterExecutionContext.isResponseHandled): an @Res() or @Next() parameter, and no passthrough. */
function sendsResponseItself(controller: Type<unknown>, method: string): boolean {
  const params: unknown = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method);
  if (typeof params !== 'object' || params === null || Reflect.getMetadata(RESPONSE_PASSTHROUGH_METADATA, controller, method) === true) {
    return false;
  }
  return Object.keys(params).some((key) => { // keys are `${paramtype}:${index}`
    const paramtype = Number(key.split(':')[0]);
    return paramtype === RouteParamtypes.RESPONSE || paramtype === RouteParamtypes.NEXT;
  });
}
```
