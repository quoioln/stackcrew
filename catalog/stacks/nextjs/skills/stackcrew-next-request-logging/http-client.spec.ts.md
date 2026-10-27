Goes to `src/shared/logging/http-client.spec.ts`.

```ts
// Default location: src/shared/logging/http-client.spec.ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_LIMIT_BYTES } from './body-masker';
import { httpClient } from './http-client';
import { logger } from './logger';

type Written = { level: string; line: Record<string, unknown> };

/** A local provider stub: one scripted reply per path. */
const stub: Server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    if (req.url?.startsWith('/verify')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ decision: 'APPROVED', accessToken: 't0k3n', echo: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    } else if (req.url === '/xml') {
      res.writeHead(200, { 'content-type': 'text/xml', 'content-length': '300' });
      res.end('x'.repeat(300));
    } else if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'application/json' }); // chunked: no Content-Length
      res.end(JSON.stringify({ blob: 'a'.repeat(CAPTURE_LIMIT_BYTES) }));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"decision":', () => setTimeout(() => res.socket?.destroy(), 20)); // the reply breaks mid-body, after its headers
    }
  });
});

describe('httpClient.fetch', () => {
  let base: string;
  let written: Written[];
  const httpOut = (): Written[] => written.filter((w) => w.line.event === 'http_out');
  const oneLine = async (): Promise<Record<string, unknown>> => {
    await vi.waitFor(() => expect(httpOut()).toHaveLength(1));
    return httpOut()[0].line;
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => stub.close(resolve));
  });

  beforeEach(() => {
    written = [];
    for (const level of ['info', 'warn', 'error'] as const) {
      vi.spyOn(logger, level).mockImplementation((line: unknown) => {
        if (typeof line === 'object' && line !== null) {
          written.push({ level, line: { ...line } });
        }
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes one http_out line: target, method, url without the query, status, both bodies masked; the caller reads the reply', async () => {
    const response = await httpClient.fetch('kyc-provider', `${base}/verify?apiKey=secret`, {
      method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ documentNumber: '0792', email: 'a@b.c' }),
    });
    await expect(response.json()).resolves.toMatchObject({ decision: 'APPROVED', accessToken: 't0k3n' });
    expect(await oneLine()).toMatchObject({
      target: 'kyc-provider', method: 'POST', url: `${base}/verify`, status: 200,
      reqBody: '{"documentNumber":"0792","email":"***"}', resBody: '{"decision":"APPROVED","accessToken":"***","echo":{"documentNumber":"0792","email":"***"}}',
    });
  });

  it('logs a call without a reply once, with the network error code and no status, and rethrows the error', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));
    await expect(httpClient.fetch('kyc-provider', `http://127.0.0.1:${port}/verify`)).rejects.toThrow(TypeError);
    const line = await oneLine();
    expect(line).toMatchObject({ error: 'ECONNREFUSED', url: `http://127.0.0.1:${port}/verify` });
    expect(line.status).toBeUndefined();
  });

  it('still writes one line when the reply breaks mid-body: its status and the error, no body', async () => {
    const response = await httpClient.fetch('kyc-provider', `${base}/broken`);
    await expect(response.text()).rejects.toThrow();
    const line = await oneLine();
    expect(line).toMatchObject({ status: 200, error: expect.any(String) });
    expect(line.resBody).toBeUndefined();
  });

  it('logs replies it does not mask by size only: XML by Content-Length, JSON past the capture cap without parsing it', async () => {
    await (await httpClient.fetch('kyc-provider', `${base}/xml`)).text();
    expect(await oneLine()).toMatchObject({ resBody: '<text/xml 300 bytes>' });
    written.length = 0;
    const big = await httpClient.fetch('kyc-provider', `${base}/big`);
    expect(await oneLine()).toMatchObject({ resBody: '<application/json 16384+ bytes>' });
    expect((await big.text()).length).toBeGreaterThan(CAPTURE_LIMIT_BYTES); // the caller still gets the whole reply
  });
});
```
