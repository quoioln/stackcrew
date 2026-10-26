Goes to `src/common/logging/logging.setup.ts`.

```ts
// Default location: src/common/logging/logging.setup.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import type { Options } from 'pino-http';
import { contextLogFields, requestContextOf, safeRequestIdOrNew } from '../context/request-context';
import { httpLoggingMiddleware } from './http-logging.middleware';

/**
 * pino-http options for LoggerModule.forRootAsync. autoLogging is off: the logging middleware writes the one http_in
 * line, and pino-http would add a second. quietReqLogger keeps the request object (and its Authorization and cookie
 * headers) off every line; the mixin adds requestId, userId and tenantId from the request context instead.
 */
export function pinoHttpOptions(level: string): Options {
  return {
    level,
    autoLogging: false,
    quietReqLogger: true,
    genReqId: (req) => requestContextOf(req)?.requestId ?? safeRequestIdOrNew(undefined),
    mixin: () => contextLogFields(),
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'], remove: true },
  };
}

/**
 * Call from main.ts and from every e2e test, after NestFactory.create(AppModule, { bufferLogs: true, rawBody: true })
 * (tests: createNestApplication({ rawBody: true })) and before app.init() or app.listen(). app.use() here registers the
 * logging middleware ahead of the body parsers that init() adds, and ahead of CORS: call app.enableCors() after this.
 */
export function setupApp(app: NestExpressApplication): void {
  app.useLogger(app.get(Logger));
  app.use(httpLoggingMiddleware());
}
```
