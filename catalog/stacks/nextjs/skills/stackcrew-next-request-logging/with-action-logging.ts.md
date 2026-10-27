Goes to `src/shared/logging/with-action-logging.ts`.

```ts
// Default location: src/shared/logging/with-action-logging.ts
import 'server-only';
import { ACTION_ERROR_STATUS, isActionFailure } from '../action-result';
import { contextLogFields, currentContext, runWithRequestContext, type RequestContext } from '../context/request-context';
import { contextOfRequest } from '../context/session-context';
import { bodyPlaceholder, loadLogBodies, loadMaskOptions } from './body-masker';
import { elapsedMs, errorName, LogEvent, writeCallLine, type CallLogLine } from './log-fields';
import { logger } from './logger';
import { nextControlFlow } from './next-control-flow';
import { capturedValue } from './web-body';

const ACTION_METHOD = 'POST';
const ACTION_ROUTE_PREFIX = 'action:';
const OK_STATUS = 200;
const SERVER_ERROR_STATUS = 500;

/** How the call ended: the value the action returned, or what it threw. */
type Outcome = { result: unknown } | { failure: unknown };

/**
 * Wraps a server action: `export const createX = withActionLogging('createX', async (input: unknown) => ...)` in a
 * 'use server' file. Each call runs inside the request context (auth() once, through contextOfRequest) and writes
 * exactly one http_in line: method POST, route `action:<name>`, the status its outcome stands for (200; the
 * ACTION_ERROR_STATUS of a typed refusal; the redirect or notFound status of a Next.js control-flow throw; 500 for any
 * other throw), the masked arguments as reqBody and the masked result as resBody. It returns the action's result and
 * rethrows its error unchanged: logging never changes the outcome.
 */
export function withActionLogging<A extends unknown[], R>(name: string, action: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  const route = `${ACTION_ROUTE_PREFIX}${name}`;
  return async (...args: A): Promise<R> => {
    const started = process.hrtime.bigint();
    if (currentContext() !== undefined) {
      return logged(route, started, args, action); // called from inside another wrapper: same request, same context
    }
    let context: RequestContext;
    try {
      context = await contextOfRequest();
    } catch (failure: unknown) {
      writeActionLine(route, started, args, { failure }); // auth() or headers() failed: still one line
      throw failure;
    }
    return runWithRequestContext(context, () => logged(route, started, args, action));
  };
}

async function logged<A extends unknown[], R>(route: string, started: bigint, args: A, action: (...args: A) => Promise<R>): Promise<R> {
  let result: R;
  try {
    result = await action(...args);
  } catch (failure: unknown) {
    writeActionLine(route, started, args, { failure });
    throw failure;
  }
  writeActionLine(route, started, args, { result });
  return result;
}

function writeActionLine(route: string, started: bigint, args: readonly unknown[], outcome: Outcome): void {
  const durationMs = elapsedMs(started);
  const control = 'failure' in outcome ? nextControlFlow(outcome.failure) : undefined;
  if (control !== undefined && control.status === undefined) {
    return; // a rendering bailout is not an outcome of the call
  }
  const minimal = (): CallLogLine => {
    if ('result' in outcome) {
      const refusal = isActionFailure(outcome.result) ? outcome.result.error.code : undefined;
      return { event: LogEvent.HTTP_IN, method: ACTION_METHOD, route, durationMs, status: refusal === undefined ? OK_STATUS : ACTION_ERROR_STATUS[refusal], error: refusal };
    }
    return { event: LogEvent.HTTP_IN, method: ACTION_METHOD, route, durationMs, status: control?.status ?? SERVER_ERROR_STATUS, error: control?.name ?? errorName(outcome.failure) };
  };
  writeCallLine(logger, () => {
    const line: CallLogLine = { ...minimal(), ...contextLogFields() };
    if (!loadLogBodies()) {
      return line;
    }
    const opts = loadMaskOptions();
    return { ...line, reqBody: capturedValue(actionInput(args), opts), resBody: 'result' in outcome ? capturedValue(outcome.result, opts) : undefined };
  }, minimal);
}

/**
 * The arguments as the line shows them: one argument as it is, several as an array, none as nothing. A FormData
 * becomes its fields (the last value of a repeated key wins, as in a form body), and a file its size only.
 */
function actionInput(args: readonly unknown[]): unknown {
  const values = args.map((arg) => (arg instanceof FormData ? formFields(arg) : arg));
  if (values.length === 0) {
    return undefined;
  }
  return values.length === 1 ? values[0] : values;
}

function formFields(form: FormData): Record<string, string> {
  return Object.fromEntries([...form.entries()].map(([key, value]) => [key, typeof value === 'string' ? value : bodyPlaceholder(value.type, value.size)]));
}
```
