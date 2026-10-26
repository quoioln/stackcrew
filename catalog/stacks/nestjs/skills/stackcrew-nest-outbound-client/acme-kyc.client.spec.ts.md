Goes to `src/modules/kyc/acme/acme-kyc.client.spec.ts`.

```ts
// Default location: src/modules/kyc/acme/acme-kyc.client.spec.ts
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runWithRequestContext } from '../../../common/context/request-context';
import type { ProviderPolicyOptions } from '../../../common/providers/provider-policy.types';
import { KycProviderEnv, parseEnvSection } from '../../../config/env';
import { ProviderProtocolError, ProviderRejectedError, ProviderUnavailableError } from '../../../common/providers/provider.errors';
import { KycDecision, type VerifyIdentityCommand } from '../interfaces/kyc-verification';
import { KycProvider } from '../kyc-provider.port';
import { KYC_PROVIDER_POLICY } from '../kyc.constants';
import { KycModule } from '../kyc.module';

type Reply = { status: number; body: string; delayMs?: number; trickle?: boolean };
type Hit = { url: string; idempotencyKey: string | undefined; apiKey: string | undefined };

const TIMEOUT_MS = 300;
const TRICKLE_STEP_MS = 50; // under TIMEOUT_MS: axios's idle timeout never fires, only the attempt bound does
const MAX_RESPONSE_BYTES = 1_048_576; // maxContentLength in kyc.module.ts
/** The production policy's shape with short delays, so no test waits on backoff. */
const FAST_POLICY: ProviderPolicyOptions = { maxRetries: 2, initialDelayMs: 5, maxDelayMs: 20, breakAfter: 3, halfOpenAfterMs: 60_000, maxConcurrent: 5, maxQueued: 5 };
const CONTEXT_REQUEST_ID = 'req-ctx-1';
/** The key the service stored with its verification row before calling the provider. */
const VERIFICATION_ID = '0f8e2c1a-6b7d-4e3f-9a2b-1c4d5e6f7a8b';
const COMMAND: VerifyIdentityCommand = { idempotencyKey: VERIFICATION_ID, traceRef: CONTEXT_REQUEST_ID, documentNumber: '079201001234', selfie: Buffer.alloc(2048, 1) };
const APPROVED = JSON.stringify({ resultCode: 'OK', matchScore: 97.5, transactionId: 'acme-tx-1' });
const ok = (body = APPROVED): Reply => ({ status: 200, body });

describe('AcmeKycClient (against a local provider stub, never the real provider)', () => {
  const replies: Reply[] = []; // the stub's scripted answers, one per request, in order
  const hits: Hit[] = [];
  const lines: Record<string, unknown>[] = [];
  const stub: Server = createServer(answer);
  let baseUrl = '';
  let moduleRef: TestingModule;
  let provider: KycProvider;

  function answer(req: IncomingMessage, res: ServerResponse): void {
    req.resume();
    req.on('end', () => {
      hits.push({ url: req.url ?? '', idempotencyKey: req.headers['idempotency-key']?.toString(), apiKey: req.headers['x-api-key']?.toString() });
      const reply = replies.shift() ?? { status: 500, body: '{"error":"no scripted reply"}' };
      if (reply.trickle === true) { // headers at once, then one character per step: the body takes far longer than TIMEOUT_MS
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        const characters = [...reply.body];
        const timer = setInterval(() => (characters.length > 0 ? res.write(characters.shift()) : res.end()), TRICKLE_STEP_MS);
        res.on('close', () => clearInterval(timer));
        return;
      }
      setTimeout(() => res.writeHead(reply.status, { 'content-type': 'application/json' }).end(reply.body), reply.delayMs ?? 0);
    });
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
    // set, not defaulted: a KYC_PROVIDER_BASE_URL from the shell or CI must never point this test at a real provider
    Object.assign(process.env, { KYC_PROVIDER_BASE_URL: baseUrl, KYC_PROVIDER_TIMEOUT_MS: String(TIMEOUT_MS), KYC_PROVIDER_API_KEY: 'test-api-key' });
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
      // the real env section parses the variables, so the timeout is a number as in production
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: (raw) => parseEnvSection(KycProviderEnv, raw) }), KycModule],
    }).overrideProvider(KYC_PROVIDER_POLICY).useValue(FAST_POLICY).compile(); // a fresh breaker per test
    await moduleRef.init(); // OutboundHttpLogger registers its interceptors
    provider = moduleRef.get(KycProvider);
  });

  afterEach(() => moduleRef.close());

  afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((resolve) => stub.close(resolve));
  });

  it('maps an approval to the domain result; one call, one masked http_out line', async () => {
    replies.push(ok());
    const result = await runWithRequestContext({ requestId: CONTEXT_REQUEST_ID, userId: 'alice', tenantId: 'tenant-a', roles: [] }, () => provider.verify(COMMAND));
    expect(result).toEqual({ decision: KycDecision.APPROVED, score: 97.5, providerReference: 'acme-tx-1' });
    expect(hits).toEqual([{ url: '/v1/verifications', idempotencyKey: VERIFICATION_ID, apiKey: 'test-api-key' }]);
    expect(hits[0].idempotencyKey).not.toBe(CONTEXT_REQUEST_ID); // the stored key, never the inbound request id
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'http_out', target: 'kyc-provider', method: 'POST', status: 200, url: `${baseUrl}/v1/verifications`,
      requestId: CONTEXT_REQUEST_ID, reqBody: `{"idNumber":"***","faceImageBase64":"<base64 2048 bytes>","traceRef":"${CONTEXT_REQUEST_ID}"}` });
  });

  it('retries 5xx and 429 with the same idempotency key, then succeeds', async () => {
    replies.push({ status: 503, body: '{}' }, { status: 429, body: '{}' }, ok());
    await expect(provider.verify(COMMAND)).resolves.toMatchObject({ decision: KycDecision.APPROVED });
    expect(hits.map((hit) => hit.idempotencyKey)).toEqual([VERIFICATION_ID, VERIFICATION_ID, VERIFICATION_ID]); // the same key on every attempt
    expect(lines.map((line) => line.status)).toEqual([503, 429, 200]); // one http_out line per attempt
  });

  it('gives up with ProviderUnavailableError after the first attempt and maxRetries retries', async () => {
    replies.push({ status: 500, body: '{}' }, { status: 502, body: '{}' }, { status: 500, body: '{}' });
    await expect(provider.verify(COMMAND)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(hits).toHaveLength(FAST_POLICY.maxRetries + 1);
  });

  it('retries a timeout: the slow attempt logs its error and no status', async () => {
    replies.push({ status: 200, body: APPROVED, delayMs: TIMEOUT_MS * 3 }, ok());
    await expect(provider.verify(COMMAND)).resolves.toMatchObject({ decision: KycDecision.APPROVED });
    expect(hits).toHaveLength(2);
    expect(['ECONNABORTED', 'ERR_CANCELED']).toContain(lines[0].error); // axios timeout or the attempt bound, whichever fires first
    expect(lines[0].status).toBeUndefined();
  });

  it('bounds the whole attempt: a reply that trickles past the timeout after its headers is cut (ERR_CANCELED) and retried', async () => {
    replies.push({ ...ok(), trickle: true }, ok());
    await expect(provider.verify(COMMAND)).resolves.toMatchObject({ decision: KycDecision.APPROVED });
    expect(hits).toHaveLength(2);
    expect(lines[0]).toMatchObject({ event: 'http_out', error: 'ERR_CANCELED' });
  });

  it('refuses a reply over maxContentLength as ProviderProtocolError, without retrying', async () => {
    replies.push(ok(JSON.stringify({ resultCode: 'OK', matchScore: 1, transactionId: 'x'.repeat(MAX_RESPONSE_BYTES) })));
    await expect(provider.verify(COMMAND)).rejects.toBeInstanceOf(ProviderProtocolError);
    expect(hits).toHaveLength(1);
  });

  it.each([400, 404, 409, 422])('does not retry a %i: ProviderRejectedError after one call', async (status) => {
    replies.push({ status, body: '{"error":"bad request","idNumber":"079201001234"}' });
    await expect(provider.verify(COMMAND)).rejects.toBeInstanceOf(ProviderRejectedError);
    expect(hits).toHaveLength(1);
    expect(lines[0].resBody).toBe('{"error":"bad request","idNumber":"***"}');
  });

  it.each([
    ['not JSON', 'not json'],
    ['a missing field', JSON.stringify({ resultCode: 'OK', transactionId: 'acme-tx-1' })],
    ['an unknown result code', JSON.stringify({ resultCode: 'MAYBE', matchScore: 10, transactionId: 'acme-tx-1' })],
  ])('rejects a reply with %s as ProviderProtocolError, without retrying', async (_case, body) => {
    replies.push(ok(body));
    await expect(provider.verify(COMMAND)).rejects.toBeInstanceOf(ProviderProtocolError);
    expect(hits).toHaveLength(1);
  });

  it('opens the circuit after breakAfter failed calls and then fails fast without calling the provider', async () => {
    for (let call = 0; call < FAST_POLICY.breakAfter; call++) {
      await expect(provider.verify(COMMAND)).rejects.toBeInstanceOf(ProviderUnavailableError); // no scripted reply: 500
    }
    const before = hits.length;
    await expect(provider.verify(COMMAND)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(hits).toHaveLength(before);
  });
});
```
