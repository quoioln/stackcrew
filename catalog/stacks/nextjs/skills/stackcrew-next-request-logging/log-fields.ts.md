Goes to `src/shared/logging/log-fields.ts`.

```ts
// Default location: src/shared/logging/log-fields.ts
import type { Logger } from 'pino';

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
  traceId?: string;
  spanId?: string;
};

export type LogLevel = 'info' | 'warn' | 'error';

/** The part of a pino logger the line writers use. */
export type LineLogger = Pick<Logger, LogLevel>;

const SERVER_ERROR = 500;
const CLIENT_ERROR = 400;
const NANOSECONDS_PER_MS = 1_000_000;
const NS_PER_MS = BigInt(NANOSECONDS_PER_MS); // no bigint literal: the target of a Next.js tsconfig is ES2017

/** INFO for 2xx/3xx, WARN for 4xx, ERROR for 5xx and for calls that failed without a status. */
export function levelFor(status: number | undefined): LogLevel {
  if (status === undefined || status >= SERVER_ERROR) {
    return 'error';
  }
  return status >= CLIENT_ERROR ? 'warn' : 'info';
}

export function elapsedMs(startedNs: bigint): number {
  return Number((process.hrtime.bigint() - startedNs) / NS_PER_MS);
}

/**
 * Logging never throws (core-logging). When build() fails, fallback() is written instead: the same line with size-only
 * bodies, built from plain values. When the fallback or the logger fails too, a process warning is emitted. A request,
 * an outbound call or a message never fails, or changes its result, because of its log line. `level` defaults to the
 * level of the line's status (a message_in line has none: pass 'info').
 */
export function writeCallLine(logger: LineLogger, build: () => CallLogLine, fallback: () => CallLogLine, level?: LogLevel): void {
  let line: CallLogLine;
  try {
    line = build();
  } catch {
    try {
      line = fallback();
    } catch (failure: unknown) {
      process.emitWarning(`log line not built (${errorName(failure)})`);
      return;
    }
  }
  try {
    logger[level ?? levelFor(line.status)](line, line.event);
  } catch (failure: unknown) {
    process.emitWarning(`${line.event} line not written (${errorName(failure)})`);
  }
}

/** The class of an error for the `error` field: never its message, which can quote input. */
export function errorName(failure: unknown): string {
  return failure instanceof Error ? failure.name : typeof failure;
}
```
