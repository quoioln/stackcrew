Goes to `src/shared/logging/with-action-logging.spec.ts`.

```ts
// Default location: src/shared/logging/with-action-logging.spec.ts
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { auth } from '../../auth';
import { ActionErrorCode, fail, ok, type ActionResult } from '../action-result';
import { currentContext } from '../context/request-context';
import { getRequestContext } from '../context/session-context';
import { logger } from './logger';
import { withActionLogging } from './with-action-logging';

vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('../../auth', () => ({ auth: vi.fn() }));

type Written = { level: string; line: Record<string, unknown> };
type ProfileInput = { fullName: string; email: string; password: string };

const authMock = auth as unknown as Mock<() => Promise<unknown>>; // next-auth's auth() is overloaded; the mock returns a session
const session = (id: string, tenantId: string): unknown => ({ user: { id, tenantId, roles: ['user'] }, expires: '2099-01-01T00:00:00.000Z' });
const INPUT: ProfileInput = { fullName: 'Nguyen Van A', email: 'a@b.c', password: 'p4ss' };

/** The action under test: reads the caller through getRequestContext(), refuses with typed results. */
const createProfile = withActionLogging('createProfile', async (input: ProfileInput): Promise<ActionResult<{ id: string }>> => {
  const ctx = await getRequestContext();
  if (ctx.userId === undefined) {
    return fail(ActionErrorCode.UNAUTHENTICATED);
  }
  if (input.fullName === '') {
    return fail(ActionErrorCode.VALIDATION, { fullName: ['Required'] });
  }
  return ok({ id: `${ctx.tenantId}:${ctx.userId}` });
});

describe('withActionLogging', () => {
  let written: Written[];

  const httpIn = (): Written[] => written.filter((w) => w.line.event === 'http_in');
  const signIn = (who: unknown, requestId = 'req-1'): void => {
    authMock.mockResolvedValue(who);
    vi.mocked(headers).mockResolvedValue(new Headers({ 'x-request-id': requestId }));
  };

  beforeEach(() => {
    written = [];
    for (const level of ['info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation((line: unknown) => {
        if (typeof line === 'object' && line !== null) {
          written.push({ level, line: { ...line } });
        }
      });
    }
    signIn(session('alice', 'tenant-a'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes one http_in line with the masked arguments and result, inside the context of the signed-in user', async () => {
    await expect(createProfile(INPUT)).resolves.toEqual(ok({ id: 'tenant-a:alice' }));
    expect(httpIn()).toHaveLength(1);
    expect(httpIn()[0]).toMatchObject({
      level: 'info',
      line: {
        method: 'POST', route: 'action:createProfile', status: 200, requestId: 'req-1', userId: 'alice', tenantId: 'tenant-a',
        reqBody: '{"fullName":"***","email":"***","password":"***"}', resBody: '{"ok":true,"data":{"id":"tenant-a:alice"}}',
      },
    });
    expect(httpIn()[0].line.durationMs).toEqual(expect.any(Number));
  });

  it('logs a typed refusal at the status it stands for, as a warning, and returns it unchanged', async () => {
    await expect(createProfile({ ...INPUT, fullName: '' })).resolves.toEqual(fail(ActionErrorCode.VALIDATION, { fullName: ['Required'] }));
    signIn(null);
    await expect(createProfile(INPUT)).resolves.toEqual(fail(ActionErrorCode.UNAUTHENTICATED));
    expect(httpIn().map((w) => [w.level, w.line.status, w.line.error, w.line.userId])).toEqual([
      ['warn', 400, 'VALIDATION', 'alice'],
      ['warn', 401, 'UNAUTHENTICATED', undefined],
    ]);
  });

  it('rethrows an error unchanged and logs it once as a 500 with its class, never its message', async () => {
    const boom = new TypeError('database said: password=hunter2');
    const failing = withActionLogging('failing', async (): Promise<ActionResult<never>> => {
      throw boom;
    });
    await expect(failing()).rejects.toBe(boom);
    expect(httpIn()).toHaveLength(1);
    expect(httpIn()[0]).toMatchObject({ level: 'error', line: { status: 500, error: 'TypeError' } });
    expect(JSON.stringify(httpIn()[0].line)).not.toContain('hunter2');
  });

  it('logs redirect() and notFound() at their status, never as a 500, and rethrows them for Next.js', async () => {
    const redirecting = withActionLogging('redirecting', async (): Promise<ActionResult<never>> => redirect('/customer-profiles'));
    const missing = withActionLogging('missing', async (): Promise<ActionResult<never>> => notFound());
    const thrown = await redirecting().then(() => undefined, (failure: unknown) => failure);
    expect(thrown).toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;/) });
    await expect(missing()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(httpIn().map((w) => [w.level, w.line.route, w.line.status, w.line.error])).toEqual([
      ['info', 'action:redirecting', 307, 'NEXT_REDIRECT'],
      ['warn', 'action:missing', 404, 'NEXT_HTTP_ERROR_FALLBACK'],
    ]);
  });

  it('logs the fields of a FormData argument, after the previous state of useActionState, and a file as its size only', async () => {
    const submit = withActionLogging('submit', async (_previous: unknown, form: FormData): Promise<ActionResult<number>> => ok(form.getAll('tag').length));
    const form = new FormData();
    form.append('email', 'a@b.c');
    form.append('tag', 'x');
    form.append('tag', 'y');
    form.append('selfie', new File([new Uint8Array(3000)], 'selfie.jpg', { type: 'image/jpeg' }));
    await expect(submit(null, form)).resolves.toEqual(ok(2));
    expect(httpIn()[0].line.reqBody).toBe('[null,{"email":"***","tag":"y","selfie":"<binary image/jpeg 3000 bytes>"}]');
  });

  it('keeps concurrent calls of two users apart and leaks no context after the call', async () => {
    authMock.mockResolvedValueOnce(session('alice', 'tenant-a')).mockResolvedValueOnce(session('bob', 'tenant-b'));
    const results = await Promise.all([createProfile(INPUT), createProfile(INPUT)]);
    expect(results).toEqual([ok({ id: 'tenant-a:alice' }), ok({ id: 'tenant-b:bob' })]);
    expect(httpIn().map((w) => `${w.line.userId}@${w.line.tenantId}`).sort()).toEqual(['alice@tenant-a', 'bob@tenant-b']);
    expect(currentContext()).toBeUndefined();
  });

  it('still writes one line when auth() fails, and rethrows its error', async () => {
    const outage = new Error('session store unreachable');
    authMock.mockRejectedValue(outage);
    await expect(createProfile(INPUT)).rejects.toBe(outage);
    expect(httpIn()).toHaveLength(1);
    expect(httpIn()[0].line).toMatchObject({ status: 500, error: 'Error', route: 'action:createProfile' });
  });

  it('never changes the result when the logger fails: a process warning instead', async () => {
    vi.spyOn(logger, 'info').mockImplementation(() => {
      throw new TypeError('sink closed');
    });
    const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    await expect(createProfile(INPUT)).resolves.toEqual(ok({ id: 'tenant-a:alice' }));
    expect(warning).toHaveBeenCalledWith('http_in line not written (TypeError)');
  });
});
```
