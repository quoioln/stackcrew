Goes to `test/customer-profiles.e2e.spec.ts`.

```ts
// Default location: test/customer-profiles.e2e.spec.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { CapturingLogger, createTestApp } from './support/test-app';
import { TestIssuer } from './support/test-issuer';

const PROFILES = '/v1/customer-profiles';
const RESPONSE_KEYS = ['createdAt', 'fullName', 'id', 'reference', 'status'];
const ERROR_KEYS = ['success', 'message', 'timestamp', 'supportCode', 'requestId', 'error'];
const SUCCESS_KEYS = ['success', 'timestamp', 'supportCode', 'requestId', 'data'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('customer profiles (e2e)', () => {
  const issuer = new TestIssuer();
  const logger = new CapturingLogger();
  let container: StartedPostgreSqlContainer;
  let app: NestExpressApplication;

  const bearer = (sub: string, tenant: string): string =>
    `Bearer ${issuer.token({ sub, '{{sc:tenantClaim}}': tenant, '{{sc:rolesClaim}}': ['user'] })}`;
  const create = (tenant: string, reference: string): request.Test =>
    request(app.getHttpServer()).post(PROFILES).set('authorization', bearer('alice', tenant)).send({ reference, fullName: 'Nguyen Van A' });

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    process.env.DATABASE_URL = container.getConnectionUri(); // SERVICE_NUMBER comes from createTestApp
    await issuer.start();
    app = await createTestApp(logger); // imports AppModule only now, after the env is set
    await app.get(DataSource).runMigrations();
  });

  afterAll(async () => {
    await app.close();
    await issuer.stop();
    await container.stop();
  });

  /** The envelope's own contract: key order, the ids equal to the headers, an ISO timestamp. */
  const envelopeOf = (res: request.Response, keys: string[]): void => {
    expect(Object.keys(res.body)).toEqual(keys);
    expect(res.body.supportCode).toMatch(/^[A-Z]{6}$/);
    expect(res.body.requestId).toMatch(UUID);
    expect(res.headers['x-support-code']).toBe(res.body.supportCode);
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  };

  it('creates a profile and answers with the success envelope around the response DTO, never the entity', async () => {
    const res = await create('tenant-a', 'ref-create').expect(201);
    envelopeOf(res, SUCCESS_KEYS);
    expect(Object.keys(res.body.data).sort()).toEqual(RESPONSE_KEYS); // no {{sc:tenantColumn}}, createdBy, updatedAt, updatedBy or deletedAt
    expect(res.body).toMatchObject({ success: true, data: { reference: 'ref-create', fullName: 'Nguyen Van A', status: 'PENDING' } });
  });

  it('reads a profile of the caller tenant, and answers 404 to another tenant', async () => {
    const { body } = await create('tenant-a', 'ref-read').expect(201);
    const own = await request(app.getHttpServer()).get(`${PROFILES}/${body.data.id}`).set('authorization', bearer('alice', 'tenant-a')).expect(200);
    expect(own.body.data).toEqual(body.data);
    const other = await request(app.getHttpServer()).get(`${PROFILES}/${body.data.id}`).set('authorization', bearer('bob', 'tenant-b')).expect(404);
    envelopeOf(other, ERROR_KEYS);
    expect(other.body).toMatchObject({ success: false, message: 'The resource does not exist', error: { errorCode: 'RESOURCE_NOT_FOUND', details: [] } });
    expect(other.body.error.errorNumber).toMatch(/^\d{7}$/);
    expect(other.body.error.errorNumber).toBe('0730101'); // SERVICE_NUMBER 07, category 30, seq 101
  });

  it('pages the caller tenant only, 0-based, with the pagination block', async () => {
    await create('tenant-c', 'ref-c1').expect(201);
    await create('tenant-c', 'ref-c2').expect(201);
    await create('tenant-c', 'ref-c3').expect(201);
    await create('tenant-d', 'ref-d1').expect(201);
    const first = await request(app.getHttpServer()).get(PROFILES).query({ size: 2, sort: 'reference', direction: 'asc' })
      .set('authorization', bearer('carol', 'tenant-c')).expect(200);
    envelopeOf(first, SUCCESS_KEYS);
    expect(first.body.data).toMatchObject({ pagination: expect.objectContaining({ page: 0, size: 2, totalElements: 3, totalPages: 2, hasNext: true, hasPrevious: false }) });
    expect(first.body.data.items.map((item: { reference: string }) => item.reference)).toEqual(['ref-c1', 'ref-c2']);
    const second = await request(app.getHttpServer()).get(PROFILES).query({ page: 1, size: 2, sort: 'reference', direction: 'asc' })
      .set('authorization', bearer('carol', 'tenant-c')).expect(200);
    expect(second.body.data.items.map((item: { reference: string }) => item.reference)).toEqual(['ref-c3']);
    expect(second.body.data.pagination).toEqual(expect.objectContaining({ page: 1, hasNext: false, hasPrevious: true }));
  });

  it('caps a size over the maximum and reports the capped size', async () => {
    const res = await request(app.getHttpServer()).get(PROFILES).query({ size: 500 }).set('authorization', bearer('dave', 'tenant-e')).expect(200);
    expect(res.body.data).toEqual({ items: [], pagination: { page: 0, size: 100, totalElements: 0, totalPages: 0, hasNext: false, hasPrevious: false } });
  });

  it('answers 400 VALIDATION_FAILED with one detail per field and constraint for an invalid body or an unknown field', async () => {
    const auth = bearer('alice', 'tenant-a');
    const missing = await request(app.getHttpServer()).post(PROFILES).set('authorization', auth).send({ fullName: 'Nguyen Van A' }).expect(400);
    envelopeOf(missing, ERROR_KEYS);
    expect(missing.body).toMatchObject({ success: false, message: 'Request validation failed', error: { errorCode: 'VALIDATION_FAILED' } });
    expect(missing.body.error.errorNumber).toMatch(/^\d{7}$/);
    expect(missing.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'reference', code: 'INVALID_TYPE' })]));
    const extra = await request(app.getHttpServer()).post(PROFILES).set('authorization', auth)
      .send({ reference: 'r', fullName: 'n', {{sc:tenantColumn}}: 'tenant-b' }).expect(400);
    expect(extra.body.error.details).toEqual([{ field: '{{sc:tenantColumn}}', code: 'INVALID_VALUE', message: 'property {{sc:tenantColumn}} should not exist' }]);
  });

  it('answers 400 VALIDATION_FAILED for a page or size out of range, a bad sort key and a non-numeric size', async () => {
    const auth = bearer('alice', 'tenant-a');
    for (const query of [{ size: 0 }, { page: -1 }, { page: 1000 }, { sort: 'fullName' }, { size: 'ten' }]) { // page 1000 is the first page past MAX_PAGE
      const res = await request(app.getHttpServer()).get(PROFILES).query(query).set('authorization', auth).expect(400);
      expect(res.body.error.errorCode).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.length).toBeGreaterThan(0);
    }
  });

  it('answers 400 INVALID_PARAMETER for a bad id, and 400 MALFORMED_REQUEST for a body that is not JSON', async () => {
    const auth = bearer('alice', 'tenant-a');
    const badId = await request(app.getHttpServer()).get(`${PROFILES}/not-a-uuid`).set('authorization', auth).expect(400);
    expect(badId.body.error.errorCode).toBe('INVALID_PARAMETER');
    const malformed = await request(app.getHttpServer()).post(PROFILES).set('authorization', auth).set('content-type', 'application/json').send('{"reference":').expect(400);
    envelopeOf(malformed, ERROR_KEYS);
    expect(malformed.body.error.errorCode).toBe('MALFORMED_REQUEST');
    expect(JSON.stringify(malformed.body)).not.toContain('reference'); // the parser's message quotes the input: never in the body
  });

  it('answers 401 UNAUTHENTICATED without a token, with the ids on the envelope and in the headers', async () => {
    const res = await request(app.getHttpServer()).get(PROFILES).expect(401);
    envelopeOf(res, ERROR_KEYS);
    expect(res.body.error.errorCode).toBe('UNAUTHENTICATED');
  });

  it('logs one http_in line for the call with the PII masked in both bodies', async () => {
    await create('tenant-a', 'ref-log').expect(201);
    const lines = await linesWith('ref-log'); // the line is written after the client has the response
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ method: 'POST', route: PROFILES, status: 201, userId: 'alice', tenantId: 'tenant-a',
      reqBody: '{"reference":"ref-log","fullName":"***"}' });
    expect(lines[0].resBody).toContain('"fullName":"***"');
  });

  async function linesWith(reference: string): Promise<Record<string, unknown>[]> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const found = (await logger.lines('http_in', 0)).filter((line) => String(line.reqBody).includes(reference));
      if (found.length > 0) {
        return found;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    return [];
  }
});
```
