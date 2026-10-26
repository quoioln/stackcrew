Goes to `src/common/logging/log-fields.ts`.

```ts
// Default location: src/common/logging/log-fields.ts
/** Names of the request-log events and fields (core-logging), shared by inbound, outbound and consumers. */
export const LogEvent = { HTTP_IN: 'http_in', HTTP_OUT: 'http_out', MESSAGE_IN: 'message_in' } as const;
export type LogEvent = (typeof LogEvent)[keyof typeof LogEvent];

/** One line per call. Fields left undefined are not written. */
export type CallLogLine = {
  event: LogEvent;
  method?: string;
  route?: string;
  url?: string;
  target?: string;
  status?: number;
  durationMs?: number;
  error?: string;
  reqBody?: string;
  resBody?: string;
  requestId?: string;
  userId?: string;
  tenantId?: string;
};

export type LogLevel = 'log' | 'warn' | 'error';

const SERVER_ERROR = 500;
const CLIENT_ERROR = 400;
const NS_PER_MS = 1_000_000n;

/** INFO for 2xx/3xx, WARN for 4xx, ERROR for 5xx and for calls that failed without a status. */
export function levelFor(status: number | undefined): LogLevel {
  if (status === undefined || status >= SERVER_ERROR) {
    return 'error';
  }
  return status >= CLIENT_ERROR ? 'warn' : 'log';
}

export function elapsedMs(startedNs: bigint): number {
  return Number((process.hrtime.bigint() - startedNs) / NS_PER_MS);
}
```
