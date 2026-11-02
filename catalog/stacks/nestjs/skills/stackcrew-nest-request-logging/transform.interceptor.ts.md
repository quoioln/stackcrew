Goes to `src/common/api/transform.interceptor.ts`.

```ts
// Default location: src/common/api/transform.interceptor.ts
import { Injectable, StreamableFile, type CallHandler, type ExecutionContext, type NestInterceptor, type Type } from '@nestjs/common';
import { RESPONSE_PASSTHROUGH_METADATA, ROUTE_ARGS_METADATA, SSE_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { map, type Observable } from 'rxjs';
import { REQUEST_ID_HEADER, requestIdsOf, SUPPORT_CODE_HEADER } from '../context/request-context';
import { successEnvelope } from './api-response';
import { markRawRequest, RAW_RESPONSE_KEY } from './raw-response.decorator';

/**
 * Global (APP_INTERCEPTOR, after RequestContextInterceptor): wraps what a handler returns in the success envelope, with
 * the ids the logging middleware bound to the request and sent as headers. undefined (a void handler) becomes data: null.
 * Left as they are: a StreamableFile, an @Sse() stream (each event would be wrapped), a handler that sends the response
 * itself through @Res() or @Next() without passthrough (Nest ignores its return value), and a handler or controller
 * marked @RawResponse(). It sets x-request-id and x-support-code while the response has not started: a path the logging
 * middleware skips (/health) has no headers from it. A @RawResponse() request is marked for AllExceptionsFilter, which
 * answers an HttpException of a raw handler (a terminus 503) as it is.
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const http = context.switchToHttp();
    const req = http.getRequest<IncomingMessage>();
    const res = http.getResponse<ServerResponse>();
    const handler = context.getHandler();
    const ids = requestIdsOf(req);
    if (!res.headersSent) { // nothing has been written yet: the interceptor runs before the handler
      res.setHeader(REQUEST_ID_HEADER, ids.requestId);
      res.setHeader(SUPPORT_CODE_HEADER, ids.supportCode);
    }
    const rawMarked = this.reflector.getAllAndOverride<boolean | undefined>(RAW_RESPONSE_KEY, [handler, context.getClass()]) === true;
    if (rawMarked) {
      markRawRequest(req);
    }
    if (rawMarked || this.reflector.get<boolean | undefined>(SSE_METADATA, handler) === true || sendsResponseItself(context.getClass(), handler.name)) {
      return next.handle();
    }
    return next.handle().pipe(map((value: unknown) => (value instanceof StreamableFile ? value : successEnvelope(value, ids))));
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
