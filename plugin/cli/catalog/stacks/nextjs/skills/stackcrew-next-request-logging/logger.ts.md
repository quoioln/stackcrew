Goes to `src/shared/logging/logger.ts`.

```ts
// Default location: src/shared/logging/logger.ts
import pino from 'pino';
import { loggingEnv } from '../../env';
import { contextLogFields } from '../context/request-context';

/**
 * The application logger: one JSON line per event on stdout, UTC ISO-8601 timestamps, and the context ids (requestId,
 * userId, tenantId, traceId, spanId) on every line through the mixin; a field the line sets itself wins over the mixin.
 * Code logs events with a stable message plus fields: `logger.info({ event, ...fields }, event)`. Bodies are logged
 * only by the wrappers in this folder, through the masker. Locally, pipe the output through `pino-pretty`.
 */
export const logger = pino({
  level: loggingEnv().LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin: () => contextLogFields(),
});
```
