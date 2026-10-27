Goes to `src/shared/logging/log-fields.spec.ts`.

```ts
// Default location: src/shared/logging/log-fields.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { LogEvent, writeCallLine, type CallLogLine, type LineLogger } from './log-fields';

type Written = { level: string; line: unknown };

const recording = (written: Written[]): LineLogger => ({
  info: (line: unknown) => written.push({ level: 'info', line }),
  warn: (line: unknown) => written.push({ level: 'warn', line }),
  error: (line: unknown) => written.push({ level: 'error', line }),
});
const full = (): CallLogLine => ({ event: LogEvent.HTTP_IN, status: 201, reqBody: '{"password":"***"}' });
const fallback = (): CallLogLine => ({ event: LogEvent.HTTP_IN, status: 201, reqBody: '<application/json 17 bytes>' });
const fails = (): CallLogLine => {
  throw new RangeError('Maximum call stack size exceeded');
};

describe('writeCallLine', () => {
  let warning: MockInstance<typeof process.emitWarning>;

  beforeEach(() => {
    warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
  });

  afterEach(() => warning.mockRestore());

  it('writes the line at the level of its status', () => {
    const written: Written[] = [];
    writeCallLine(recording(written), full, fallback);
    expect(written).toEqual([{ level: 'info', line: full() }]);
    writeCallLine(recording(written), () => ({ event: LogEvent.MESSAGE_IN }), fallback, 'info');
    expect(written[1].level).toBe('info');
  });

  it('writes the fallback when building the line fails', () => {
    const written: Written[] = [];
    writeCallLine(recording(written), fails, fallback);
    expect(written).toEqual([{ level: 'info', line: fallback() }]);
    expect(warning).not.toHaveBeenCalled();
  });

  it('never throws when the fallback throws too: a process warning instead', () => {
    const written: Written[] = [];
    expect(() => writeCallLine(recording(written), fails, fails)).not.toThrow();
    expect(written).toEqual([]);
    expect(warning).toHaveBeenCalledWith('log line not built (RangeError)');
  });

  it('never throws when the logger throws: a process warning instead', () => {
    const broken: LineLogger = { info: () => { throw new TypeError('sink closed'); }, warn: () => undefined, error: () => undefined };
    expect(() => writeCallLine(broken, full, fallback)).not.toThrow();
    expect(warning).toHaveBeenCalledWith('http_in line not written (TypeError)');
  });
});
```
