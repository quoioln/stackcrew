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
const NOT_FOUND_DETAIL = 'The customer profile does not exist.';
const PROBLEM_JSON = /application\/problem\+json/;

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
    process.env.DATABASE_URL = container.getConnectionUri();
    await issuer.start();
    app = await createTestApp(logger); // imports AppModule only now, after the env is set
    await app.get(DataSource).runMigrations();
  });

  afterAll(async () => {
    await app.close();
    await issuer.stop();
    await container.stop();
  });

  it('creates a profile and answers with the response DTO, never the entity', async () => {
    const res = await create('tenant-a', 'ref-create').expect(201);
    expect(Object.keys(res.body).sort()).toEqual(RESPONSE_KEYS); // no {{sc:tenantColumn}}, createdBy, updatedAt, updatedBy or deletedAt
    expect(res.body).toMatchObject({ reference: 'ref-create', fullName: 'Nguyen Van A', status: 'PENDING' });
  });

  it('reads a profile of the caller tenant, and answers 404 to another tenant', async () => {
    const { body } = await create('tenant-a', 'ref-read').expect(201);
    const own = await request(app.getHttpServer()).get(`${PROFILES}/${body.id}`).set('authorization', bearer('alice', 'tenant-a')).expect(200);
    expect(own.body).toEqual(body);
    const other = await request(app.getHttpServer()).get(`${PROFILES}/${body.id}`).set('authorization', bearer('bob', 'tenant-b'))
      .expect(404).expect('content-type', PROBLEM_JSON);
    expect(other.body).toEqual({ type: 'about:blank', title: 'Not Found', status: 404, detail: NOT_FOUND_DETAIL });
  });

  it('pages the caller tenant only, with a total', async () => {
    await create('tenant-c', 'ref-c1').expect(201);
    await create('tenant-c', 'ref-c2').expect(201);
    await create('tenant-c', 'ref-c3').expect(201);
    await create('tenant-d', 'ref-d1').expect(201);
    const first = await request(app.getHttpServer()).get(PROFILES).query({ size: 2, sort: 'reference', direction: 'asc' })
      .set('authorization', bearer('carol', 'tenant-c')).expect(200);
    expect(first.body).toMatchObject({ page: 1, size: 2, total: 3 });
    expect(first.body.items.map((item: { reference: string }) => item.reference)).toEqual(['ref-c1', 'ref-c2']);
    const second = await request(app.getHttpServer()).get(PROFILES).query({ page: 2, size: 2, sort: 'reference', direction: 'asc' })
      .set('authorization', bearer('carol', 'tenant-c')).expect(200);
    expect(second.body.items.map((item: { reference: string }) => item.reference)).toEqual(['ref-c3']);
  });

  it('answers 400 with field errors for an invalid body, an unknown field, a bad page or sort key, and a bad id', async () => {
    const auth = bearer('alice', 'tenant-a');
    const missing = await request(app.getHttpServer()).post(PROFILES).set('authorization', auth).send({ fullName: 'Nguyen Van A' }).expect(400);
    expect(missing.body).toMatchObject({ status: 400, detail: 'The request is invalid.', errors: [{ field: 'reference' }] });
    const extra = await request(app.getHttpServer()).post(PROFILES).set('authorization', auth)
      .send({ reference: 'r', fullName: 'n', {{sc:tenantColumn}}: 'tenant-b' }).expect(400);
    expect(extra.body.errors).toEqual([{ field: '{{sc:tenantColumn}}', messages: ['property {{sc:tenantColumn}} should not exist'] }]);
    for (const query of [{ size: 101 }, { page: 0 }, { sort: 'fullName' }, { size: 'ten' }]) {
      await request(app.getHttpServer()).get(PROFILES).query(query).set('authorization', auth).expect(400);
    }
    await request(app.getHttpServer()).get(`${PROFILES}/not-a-uuid`).set('authorization', auth).expect(400);
  });

  it('answers 401 without a token', async () => {
    await request(app.getHttpServer()).get(PROFILES).expect(401).expect('content-type', PROBLEM_JSON);
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
