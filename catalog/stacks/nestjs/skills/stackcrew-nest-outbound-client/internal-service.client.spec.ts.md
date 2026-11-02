Goes to `src/common/http/internal-service.client.spec.ts`.

```ts
// Default location: src/common/http/internal-service.client.spec.ts
import { HttpModule, HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AxiosError } from 'axios';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiError, UpstreamApiError } from '../api/api-error';
import { CommonError } from '../api/error-codes';
import { outboundHttpLogging } from '../logging/outbound-http-logger';
import type { ProviderPolicyOptions } from '../providers/provider-policy.types';
import { classifyTransportFailure, InternalServiceClient, unwrapEnvelope } from './internal-service.client';

type Reply = { status: number; body: string; contentType?: string; delayMs?: number };
type Hit = { method: string; url: string; idempotencyKey: string | undefined };

const TIMEOUT_MS = 200;
/** The production policy's shape with short delays, so no test waits on backoff. */
const FAST_POLICY: ProviderPolicyOptions = { maxRetries: 2, initialDelayMs: 5, maxDelayMs: 20, breakAfter: 3, halfOpenAfterMs: 60_000, maxConcurrent: 5, maxQueued: 5 };
const ATTEMPTS = FAST_POLICY.maxRetries + 1;
const TARGET = 'billing-service';
const OTHER_SERVICES_ERROR_NUMBER = '0530101'; // service 05, category 30, seq 101: not this service's number
const B_SUPPORT_CODE = 'QWERTY';
const B_REQUEST_ID = 'b7f0c0de-0000-4000-8000-000000000001';

const envelope = (extra: Record<string, unknown>): string => JSON.stringify({ timestamp: '2026-11-02T02:52:00.000Z', supportCode: B_SUPPORT_CODE, requestId: B_REQUEST_ID, ...extra });
const success = (data: unknown): Reply => ({ status: 200, body: envelope({ success: true, data }) });
const failure = (status: number, errorCode: string, extra: Record<string, unknown> = {}): Reply => ({
  status,
  body: envelope({ success: false, message: 'B summary', error: { errorNumber: OTHER_SERVICES_ERROR_NUMBER, errorCode, details: [], ...extra } }),
});

describe('InternalServiceClient (against a local fake of service B, never a real service)', () => {
  const replies: Reply[] = []; // B's scripted answers, one per request, in order
  const hits: Hit[] = [];
  const lines: Record<string, unknown>[] = [];
  const stub: Server = createServer(answer);
  let moduleRef: TestingModule;
  let client: InternalServiceClient;

  function answer(req: IncomingMessage, res: ServerResponse): void {
    req.resume();
    req.on('end', () => {
      hits.push({ method: req.method ?? '', url: req.url ?? '', idempotencyKey: req.headers['idempotency-key']?.toString() });
      const reply = replies.shift() ?? { status: 500, body: 'no scripted reply', contentType: 'text/plain' };
      setTimeout(() => res.writeHead(reply.status, { 'content-type': reply.contentType ?? 'application/json' }).end(reply.body), reply.delayMs ?? 0);
    });
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        const [message] = args;
        if (typeof message === 'object' && message !== null && 'event' in message && message.event === 'http_out') {
          lines.push({ ...message });
        }
      });
    }
  });

  beforeEach(async () => {
    replies.length = 0;
    hits.length = 0;
    lines.length = 0;
    moduleRef = await Test.createTestingModule({
      imports: [HttpModule.register({ baseURL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`, maxRedirects: 0, maxContentLength: 1_048_576 })],
      providers: outboundHttpLogging(TARGET),
    }).compile();
    await moduleRef.init(); // OutboundHttpLogger registers its interceptors
    client = new InternalServiceClient(moduleRef.get(HttpService), { policy: FAST_POLICY, timeoutMs: TIMEOUT_MS }); // a fresh breaker per test
  });

  afterEach(() => moduleRef.close());

  afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((resolve) => stub.close(resolve));
  });

  /** This service's own error: the table row, no upstream text anywhere on it. */
  async function expectOwnError(call: Promise<unknown>, row: (typeof CommonError)[keyof typeof CommonError]): Promise<void> {
    const error: unknown = await call.then(() => undefined, (rejected: unknown) => rejected);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(UpstreamApiError);
    expect((error as ApiError).definition).toBe(row);
    expect(JSON.stringify(error)).not.toContain('B summary');
  }

  it('returns the data of a success envelope', async () => {
    replies.push(success({ balance: 42 }));
    await expect(client.get<{ balance: number }>('/v1/accounts/7', { expand: true })).resolves.toEqual({ balance: 42 });
    expect(hits).toEqual([{ method: 'GET', url: '/v1/accounts/7?expand=true', idempotencyKey: undefined }]);
  });

  it('returns null for a success envelope whose data is null', async () => {
    replies.push(success(null));
    await expect(client.post('/v1/charges', { amount: 1 }, 'key-1')).resolves.toBeNull();
    expect(hits[0]).toMatchObject({ method: 'POST', idempotencyKey: 'key-1' });
  });

  it("passes a 404 envelope on with B's status and B's errorNumber 0530101, and logs the upstream ids on the http_out line", async () => {
    replies.push(failure(404, 'RESOURCE_NOT_FOUND', { details: [{ field: 'id', code: 'INVALID_VALUE', message: 'no such account' }] }));
    const error: unknown = await client.get('/v1/accounts/9').then(() => undefined, (rejected: unknown) => rejected);
    expect(error).toBeInstanceOf(UpstreamApiError);
    expect(error).toMatchObject({
      status: 404,
      summary: 'B summary',
      payload: { errorNumber: '0530101', errorCode: 'RESOURCE_NOT_FOUND', details: [{ field: 'id', code: 'INVALID_VALUE', message: 'no such account' }] },
    });
    expect(hits).toHaveLength(1); // a refusal is not retried
    expect(lines[0]).toMatchObject({ status: 404, upstreamErrorNumber: '0530101', upstreamSupportCode: B_SUPPORT_CODE, upstreamRequestId: B_REQUEST_ID });
  });

  it("passes a 500 envelope on with status 502 and B's errorNumber, after retrying it", async () => {
    replies.push(failure(500, 'INTERNAL_ERROR'), failure(500, 'INTERNAL_ERROR'), failure(500, 'INTERNAL_ERROR'));
    await expect(client.get('/v1/accounts/1')).rejects.toMatchObject({ status: 502, payload: { errorNumber: '0530101', errorCode: 'INTERNAL_ERROR' } });
    expect(hits).toHaveLength(ATTEMPTS);
  });

  it('retries a 5xx, 429 or 409 and returns the later success', async () => {
    replies.push(failure(503, 'DEPENDENCY_UNAVAILABLE'), failure(429, 'RATE_LIMIT_EXCEEDED'), success({ ok: true }));
    await expect(client.post('/v1/charges', {}, 'key-2')).resolves.toEqual({ ok: true });
    expect(hits.map((hit) => hit.idempotencyKey)).toEqual(['key-2', 'key-2', 'key-2']); // the same key on every attempt
    expect(lines.map((line) => line.status)).toEqual([503, 429, 200]);
  });

  it.each([401, 403])('maps a %i with an envelope to DEPENDENCY_UNAVAILABLE: our credential is wrong, not the caller', async (status) => {
    replies.push(failure(status, 'ACCESS_DENIED'), failure(status, 'ACCESS_DENIED'), failure(status, 'ACCESS_DENIED'));
    await expectOwnError(client.get('/v1/accounts/1'), CommonError.DEPENDENCY_UNAVAILABLE);
  });

  it('maps a 403 without an envelope to DEPENDENCY_UNAVAILABLE', async () => {
    replies.push({ status: 403, body: 'forbidden', contentType: 'text/plain' }, { status: 403, body: 'forbidden', contentType: 'text/plain' }, { status: 403, body: 'forbidden', contentType: 'text/plain' });
    await expectOwnError(client.get('/v1/accounts/1'), CommonError.DEPENDENCY_UNAVAILABLE);
  });

  it('maps an HTML 502 from a proxy to DEPENDENCY_UNAVAILABLE', async () => {
    const proxy: Reply = { status: 502, body: '<html><body>Bad Gateway B summary</body></html>', contentType: 'text/html' };
    replies.push(proxy, proxy, proxy);
    await expectOwnError(client.get('/v1/accounts/1'), CommonError.DEPENDENCY_UNAVAILABLE);
    expect(hits).toHaveLength(ATTEMPTS);
    expect(Object.keys(lines[0]).filter((key) => key.startsWith('upstream'))).toEqual([]); // not an envelope: no upstream ids
  });

  it('maps a 5xx with an empty body to DEPENDENCY_UNAVAILABLE', async () => {
    replies.push({ status: 503, body: '' }, { status: 503, body: '' }, { status: 503, body: '' });
    await expectOwnError(client.get('/v1/accounts/1'), CommonError.DEPENDENCY_UNAVAILABLE);
  });

  it.each([
    ['a 200 that is not JSON', { status: 200, body: 'OK B summary', contentType: 'text/plain' }],
    ['a 200 with an empty body', { status: 200, body: '' }],
    ['a 200 JSON that is not an envelope', { status: 200, body: '{"balance":42}' }],
    ['a 200 failure envelope', { status: 200, body: envelope({ success: false, error: { errorNumber: '0530101', errorCode: 'X' } }) }],
    ['a 404 that is not an envelope', { status: 404, body: '<h1>Not Found B summary</h1>', contentType: 'text/html' }],
    ['a 400 with an empty body', { status: 400, body: '' }],
    ['a 422 whose errorNumber is not seven digits', { status: 422, body: envelope({ success: false, message: 'B summary', error: { errorNumber: '53\nERROR forged', errorCode: 'X', details: [] } }) }],
    ['a 422 whose errorCode is blank', { status: 422, body: envelope({ success: false, message: 'B summary', error: { errorNumber: '0530101', errorCode: ' ', details: [] } }) }],
  ] satisfies [string, Reply][])('maps %s to BAD_GATEWAY without a retry', async (_case, reply) => {
    replies.push(reply);
    await expectOwnError(client.get('/v1/accounts/1'), CommonError.BAD_GATEWAY);
    expect(hits).toHaveLength(1);
    expect(String(lines[0].upstreamErrorNumber ?? '')).not.toContain('forged'); // a hostile id never reaches the log
  });

  it('drops a malformed detail instead of forwarding it', async () => {
    replies.push(failure(400, 'VALIDATION_FAILED', { details: [{ field: 'a', code: 'REQUIRED', message: 'a is required' }, { field: 7, code: 1 }, 'text'] }));
    await expect(client.get('/v1/accounts/1')).rejects.toMatchObject({ status: 400, payload: { details: [{ field: 'a', code: 'REQUIRED', message: 'a is required' }] } });
  });

  it('maps an answer slower than the timeout to GATEWAY_TIMEOUT, after retrying it', async () => {
    const slow: Reply = { ...success({}), delayMs: TIMEOUT_MS * 3 };
    replies.push(slow, slow, slow);
    await expectOwnError(client.get('/v1/accounts/1'), CommonError.GATEWAY_TIMEOUT);
    expect(hits).toHaveLength(ATTEMPTS);
    expect(['ECONNABORTED', 'ERR_CANCELED']).toContain(lines[0].error);
    expect(lines[0].status).toBeUndefined();
  });

  it('maps a refused connection to DEPENDENCY_UNAVAILABLE', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve)); // nothing listens on that port now
    moduleRef.get(HttpService).axiosRef.defaults.baseURL = `http://127.0.0.1:${port}`;
    await expectOwnError(client.get('/v1/accounts/1'), CommonError.DEPENDENCY_UNAVAILABLE);
  });

  it('fails fast with DEPENDENCY_UNAVAILABLE once the circuit is open, without calling B', async () => {
    for (let call = 0; call < FAST_POLICY.breakAfter; call++) {
      await expect(client.get('/v1/accounts/1')).rejects.toBeInstanceOf(ApiError); // no scripted reply: a 500 without an envelope
    }
    const before = hits.length;
    await expectOwnError(client.get('/v1/accounts/1'), CommonError.DEPENDENCY_UNAVAILABLE);
    expect(hits).toHaveLength(before);
  });

  it('classifies transport failures: a timeout code is GATEWAY_TIMEOUT, everything else DEPENDENCY_UNAVAILABLE', () => {
    for (const code of [AxiosError.ECONNABORTED, AxiosError.ETIMEDOUT]) {
      expect(classifyTransportFailure(new AxiosError('x', code)).definition).toBe(CommonError.GATEWAY_TIMEOUT);
    }
    for (const failureCase of [new AxiosError('x', 'ECONNREFUSED'), new AxiosError('x', 'ECONNRESET'), new Error('boom'), 'text', undefined]) {
      expect(classifyTransportFailure(failureCase).definition).toBe(CommonError.DEPENDENCY_UNAVAILABLE);
    }
  });

  it('unwrapEnvelope reads a parsed body and never a status the service cannot pass on', () => {
    expect(unwrapEnvelope(200, { success: true, data: [1] })).toEqual([1]);
    expect(() => unwrapEnvelope(499, JSON.parse(failure(499, 'X').body))).toThrow(ApiError);
    expect(() => unwrapEnvelope(499, JSON.parse(failure(499, 'X').body))).not.toThrow(UpstreamApiError);
  });
});
```
