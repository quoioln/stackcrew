Goes to `src/shared/logging/with-route-logging.spec.ts`.

```ts
// Default location: src/shared/logging/with-route-logging.spec.ts
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { auth } from '../../auth';
import { currentContext } from '../context/request-context';
import { getRequestContext } from '../context/session-context';
import { CAPTURE_LIMIT_BYTES } from './body-masker';
import { logger } from './logger';
import { withRouteLogging } from './with-route-logging';

vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('../../auth', () => ({ auth: vi.fn() }));

type Written = { level: string; line: Record<string, unknown> };
type Params = { params: Promise<{ id: string }> };

const ROUTE = '/api/v1/customer-profiles/[id]';
const authMock = auth as unknown as Mock<() => Promise<unknown>>;
const params = (id: string): Params => ({ params: Promise.resolve({ id }) });
const post = (body: string, contentType: string, extra: Record<string, string> = {}): NextRequest =>
  new NextRequest('http://localhost/api/v1/customer-profiles/p-1?token=secret', { method: 'POST', headers: { 'content-type': contentType, ...extra }, body });

describe('withRouteLogging', () => {
  let written: Written[];
  const httpIn = (): Written[] => written.filter((w) => w.line.event === 'http_in');
  const oneLine = async (): Promise<Record<string, unknown>> => {
    await vi.waitFor(() => expect(httpIn()).toHaveLength(1)); // written once the body copies are read
    return httpIn()[0].line;
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
    authMock.mockResolvedValue({ user: { id: 'alice', tenantId: 'tenant-a', roles: [] }, expires: '2099-01-01T00:00:00.000Z' });
    vi.mocked(headers).mockResolvedValue(new Headers({ 'x-request-id': 'req-9' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the response of the handler and writes one line: route template, status, both bodies masked, the caller', async () => {
    const handler = withRouteLogging(ROUTE, async (req: NextRequest, ctx: Params) => {
      const body: unknown = await req.json(); // the handler reads the original; the line reads a copy
      const { id } = await ctx.params;
      const who = await getRequestContext();
      return NextResponse.json({ id, received: body, userId: who.userId }, { status: 201 });
    });
    const response = await handler(post('{"email":"a@b.c","amount":10}', 'application/json'), params('p-1'));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: 'p-1', received: { email: 'a@b.c', amount: 10 }, userId: 'alice' });
    expect(await oneLine()).toMatchObject({
      method: 'POST', route: ROUTE, status: 201, requestId: 'req-9', userId: 'alice', tenantId: 'tenant-a',
      reqBody: '{"email":"***","amount":10}', resBody: '{"id":"p-1","received":{"email":"***","amount":10},"userId":"alice"}',
    });
    expect(currentContext()).toBeUndefined();
  });

  it('rethrows an error unchanged as a 500 line, and notFound() as a 404 line', async () => {
    const boom = new RangeError('bad');
    await expect(withRouteLogging(ROUTE, async () => {
      throw boom;
    })(post('{}', 'application/json'), params('p-1'))).rejects.toBe(boom);
    expect(await oneLine()).toMatchObject({ status: 500, error: 'RangeError' });
    written.length = 0;
    await expect(withRouteLogging(ROUTE, async () => notFound())(post('{}', 'application/json'), params('p-2')))
      .rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
    expect(await oneLine()).toMatchObject({ status: 404, error: 'NEXT_HTTP_ERROR_FALLBACK' });
  });

  it('never holds back or copies a stream: an SSE response is returned at once, unread, and logs no body', async () => {
    const encoder = new TextEncoder();
    const events = new ReadableStream<Uint8Array>({ start: (controller) => controller.enqueue(encoder.encode('data: 1\n\n')) }); // never closes
    const handler = withRouteLogging('/api/v1/events', async () => new Response(events, { headers: { 'content-type': 'text/event-stream' } }));
    const response = await handler(new NextRequest('http://localhost/api/v1/events'), undefined);
    expect(await oneLine()).toMatchObject({ method: 'GET', route: '/api/v1/events', status: 200 });
    expect(httpIn()[0].line.resBody).toBeUndefined();
    const reader = response.body?.getReader();
    await expect(reader?.read()).resolves.toMatchObject({ done: false }); // the client still gets every event
    await reader?.cancel();
  });

  it('logs bodies it does not mask by size only: XML by Content-Length, JSON past the capture cap without parsing it', async () => {
    const xml = withRouteLogging(ROUTE, async (req: NextRequest) => new Response(await req.text(), { headers: { 'content-type': 'text/xml' } }));
    await xml(post('x'.repeat(300), 'text/xml', { 'content-length': '300' }), params('p-1'));
    expect(await oneLine()).toMatchObject({ reqBody: '<text/xml 300 bytes>' });
    written.length = 0;
    const huge = JSON.stringify({ blob: 'a'.repeat(CAPTURE_LIMIT_BYTES) });
    const big = withRouteLogging(ROUTE, async () => new Response(huge, { headers: { 'content-type': 'application/json' } }));
    const response = await big(new NextRequest('http://localhost/api/v1/customer-profiles/p-1'), params('p-1'));
    expect(await oneLine()).toMatchObject({ resBody: '<application/json 16384+ bytes>' });
    expect((await response.text()).length).toBe(huge.length); // the client gets the whole body
  });
});
```
