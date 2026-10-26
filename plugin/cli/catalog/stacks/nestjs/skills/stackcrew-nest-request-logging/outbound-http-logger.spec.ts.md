Goes to `src/common/logging/outbound-http-logger.spec.ts`.

```ts
// Default location: src/common/logging/outbound-http-logger.spec.ts
import { HttpModule, HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { firstValueFrom } from 'rxjs';
import { outboundHttpLogging } from './outbound-http-logger';

const TARGET = 'stub-provider';
const TIMEOUT_MS = 2_000;
const CAPTURE_LIMIT = 2_097_152; // 2 MiB, CAPTURE_LIMIT_BYTES in outbound-http-logger.ts
const OVER_CAP_JSON = `{"blob":"${'x'.repeat(CAPTURE_LIMIT + 1 - '{"blob":""}'.length)}"}`; // 2 MiB + 1 bytes
const OVER_CAP_TEXT = 'y'.repeat(CAPTURE_LIMIT + 1);

/** A local stand-in for the provider: one scripted answer per path, never a real third party. */
function answer(req: IncomingMessage, res: ServerResponse): void {
  req.resume();
  req.on('end', () => {
    if (req.url === '/big-json') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(OVER_CAP_JSON) }).end(OVER_CAP_JSON);
    } else if (req.url === '/big-json-chunked') {
      res.writeHead(200, { 'content-type': 'application/json' }); // no Content-Length: sent chunked
      res.write(OVER_CAP_JSON.slice(0, 10));
      res.end(OVER_CAP_JSON.slice(10));
    } else if (req.url === '/big-text') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end(OVER_CAP_TEXT);
    } else {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"APPROVED","accessToken":"tok"}');
    }
  });
}

describe('OutboundHttpLogger', () => {
  const stub: Server = createServer(answer);
  const lines: Record<string, unknown>[] = [];
  let moduleRef: TestingModule;
  let http: HttpService;
  let base = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        const [message] = args;
        if (typeof message === 'object' && message !== null && 'event' in message && message.event === 'http_out') {
          lines.push({ ...message });
        }
      });
    }
    moduleRef = await Test.createTestingModule({
      imports: [HttpModule.register({ timeout: TIMEOUT_MS, maxRedirects: 0 })],
      providers: outboundHttpLogging(TARGET),
    }).compile();
    await moduleRef.init(); // onModuleInit registers the axios interceptors
    http = moduleRef.get(HttpService);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await moduleRef.close();
    await new Promise((resolve) => stub.close(resolve));
  });

  beforeEach(() => {
    lines.length = 0;
  });

  it('writes one http_out line with both bodies masked', async () => {
    await firstValueFrom(http.post(`${base}/verify?apiKey=secret`, { otp: '123456', ref: 'r1' }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'http_out', target: TARGET, method: 'POST', status: 200, url: `${base}/verify`,
      reqBody: '{"otp":"***","ref":"r1"}', resBody: '{"status":"APPROVED","accessToken":"***"}' });
  });

  it.each([['/big-json', 'json'], ['/big-json-chunked', 'json'], ['/big-json', 'text']] as const)(
    'logs only the size of a JSON response over 2 MiB (%s read as %s)', async (path, responseType) => {
    const res = await firstValueFrom(http.get<unknown>(`${base}${path}`, { responseType }));
    expect(typeof res.data === 'string' ? res.data : JSON.stringify(res.data)).toBe(OVER_CAP_JSON); // the caller still gets the whole body
    expect(lines).toHaveLength(1);
    expect(lines[0].resBody).toBe(`<application/json ${CAPTURE_LIMIT + 1} bytes>`);
  });

  it('logs only the size of a text response over 2 MiB', async () => {
    await firstValueFrom(http.get(`${base}/big-text`));
    expect(lines[0].resBody).toBe(`<text/plain ${CAPTURE_LIMIT + 1} bytes>`);
  });

  it('logs only the size of a request body over 2 MiB', async () => {
    await firstValueFrom(http.post(`${base}/verify`, OVER_CAP_JSON, { headers: { 'content-type': 'application/json' } }));
    expect(lines[0]).toMatchObject({ reqBody: `<application/json ${CAPTURE_LIMIT + 1} bytes>`, resBody: '{"status":"APPROVED","accessToken":"***"}' });
  });
});
```
