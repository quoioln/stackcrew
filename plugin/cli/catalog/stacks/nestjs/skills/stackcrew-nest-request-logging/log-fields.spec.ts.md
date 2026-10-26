Goes to `src/common/logging/log-fields.spec.ts`.

```ts
// Default location: src/common/logging/log-fields.spec.ts
import { LogEvent, writeCallLine, type CallLogLine, type LineLogger } from './log-fields';

type Written = { level: string; line: unknown };

const recording = (written: Written[]): LineLogger => ({
  log: (line: unknown) => written.push({ level: 'log', line }),
  warn: (line: unknown) => written.push({ level: 'warn', line }),
  error: (line: unknown) => written.push({ level: 'error', line }),
});
const full = (): CallLogLine => ({ event: LogEvent.HTTP_IN, status: 201, reqBody: '{"password":"***"}' });
const fallback = (): CallLogLine => ({ event: LogEvent.HTTP_IN, status: 201, reqBody: '<application/json 17 bytes>' });
const fails = (): CallLogLine => {
  throw new RangeError('Maximum call stack size exceeded');
};

describe('writeCallLine', () => {
  let warning: jest.SpyInstance;

  beforeEach(() => {
    warning = jest.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
  });

  afterEach(() => warning.mockRestore());

  it('writes the line at the level of its status', () => {
    const written: Written[] = [];
    writeCallLine(recording(written), full, fallback);
    expect(written).toEqual([{ level: 'log', line: full() }]);
    writeCallLine(recording(written), () => ({ event: LogEvent.MESSAGE_IN }), fallback, 'log');
    expect(written[1].level).toBe('log');
  });

  it('writes the fallback when building the line fails', () => {
    const written: Written[] = [];
    writeCallLine(recording(written), fails, fallback);
    expect(written).toEqual([{ level: 'log', line: fallback() }]);
    expect(warning).not.toHaveBeenCalled();
  });

  it('never throws when the fallback throws too: a process warning instead', () => {
    const written: Written[] = [];
    expect(() => writeCallLine(recording(written), fails, fails)).not.toThrow();
    expect(written).toEqual([]);
    expect(warning).toHaveBeenCalledWith('log line not built (RangeError)');
  });

  it('never throws when the logger throws: a process warning instead', () => {
    const broken: LineLogger = { log: () => { throw new TypeError('sink closed'); }, warn: () => undefined, error: () => undefined };
    expect(() => writeCallLine(broken, full, fallback)).not.toThrow();
    expect(warning).toHaveBeenCalledWith('http_in line not written (TypeError)');
  });
});
```
