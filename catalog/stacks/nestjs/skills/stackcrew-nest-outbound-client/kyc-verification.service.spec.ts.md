Goes to `src/modules/kyc/kyc-verification.service.spec.ts`.

```ts
// Default location: src/modules/kyc/kyc-verification.service.spec.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { runWithRequestContext } from '../../common/context/request-context';
import { AuditSubscriber } from '../../common/database/audit.subscriber';
import { TenantSubscriber } from '../../common/database/tenant.subscriber';
import { ProviderUnavailableError } from '../../common/providers/provider.errors';
import { CreateKycVerification1730000000002 } from '../../database/migrations/1730000000002-create-kyc-verification';
import { KycVerification, KycVerificationStatus } from './entities/kyc-verification.entity';
import { KycDecision, type VerifyIdentityResult } from './interfaces/kyc-verification';
import type { KycProvider } from './kyc-provider.port';
import { KycVerificationNotFound } from './kyc-verification.errors';
import { KycVerificationRepository } from './kyc-verification.repository';
import { KycVerificationService } from './kyc-verification.service';

const PROFILE_ID = '9b2f6c1e-4d7a-4f3b-8e2d-5a6b7c8d9e0f';
const EVIDENCE = { documentNumber: '079201001234', selfie: Buffer.alloc(16, 1) };
const APPROVED: VerifyIdentityResult = { decision: KycDecision.APPROVED, score: 97.5, providerReference: 'acme-tx-1' };

/** Runs fn in a request of tenant A with the given request id, as the controller or consumer would. */
const inRequest = <T>(requestId: string, fn: () => Promise<T>, tenantId = 'tenant-a'): Promise<T> =>
  runWithRequestContext({ requestId, userId: 'alice', tenantId, roles: [] }, fn);

describe('KycVerificationService (Postgres, a fake KycProvider)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let verifications: KycVerificationRepository;
  let service: KycVerificationService;
  const provider: jest.Mocked<KycProvider> = { verify: jest.fn() };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [KycVerification],
      subscribers: [AuditSubscriber, TenantSubscriber],
      migrations: [CreateKycVerification1730000000002],
      uuidExtension: 'pgcrypto',
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    expect((await dataSource.driver.createSchemaBuilder().log()).upQueries).toEqual([]); // the migration matches the entity
    verifications = new KycVerificationRepository(dataSource.getRepository(KycVerification));
    service = new KycVerificationService(verifications, provider, dataSource);
  });

  beforeEach(() => provider.verify.mockReset());

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  });

  /** The row as tenant A sees it, through the tenant repository like any other read. */
  const stored = (id: string): Promise<KycVerification | null> => inRequest('test-read', () => verifications.findOneBy({ id }));

  it('stores the operation before any call, and a business retry reuses its stored id as the idempotency key', async () => {
    const id = await inRequest('req-1', () => service.start(PROFILE_ID));
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.PENDING, decision: null }); // committed, no call yet
    expect(provider.verify).not.toHaveBeenCalled();

    provider.verify.mockRejectedValueOnce(new ProviderUnavailableError()); // the client's own retries are exhausted
    await expect(inRequest('req-1', () => service.run(id, EVIDENCE))).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.PENDING });

    provider.verify.mockResolvedValueOnce(APPROVED); // the business retry: a later request, or a redelivered message
    await expect(inRequest('req-2', () => service.run(id, EVIDENCE))).resolves.toBe(KycDecision.APPROVED);

    const commands = provider.verify.mock.calls.map(([command]) => command);
    expect(commands.map((command) => command.idempotencyKey)).toEqual([id, id]); // the stored key, both times
    expect(commands.map((command) => command.traceRef)).toEqual(['req-1', 'req-2']); // the request id is correlation only
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.COMPLETED, decision: KycDecision.APPROVED, providerReference: 'acme-tx-1' });
  });

  it('returns the stored decision of a completed operation without calling the provider again', async () => {
    const id = await inRequest('req-3', () => service.start(PROFILE_ID));
    provider.verify.mockResolvedValueOnce(APPROVED);
    await inRequest('req-3', () => service.run(id, EVIDENCE));
    await expect(inRequest('req-4', () => service.run(id, EVIDENCE))).resolves.toBe(KycDecision.APPROVED);
    expect(provider.verify).toHaveBeenCalledTimes(1);
  });

  it('gives each new operation its own key', async () => {
    const first = await inRequest('req-5', () => service.start(PROFILE_ID));
    const second = await inRequest('req-5', () => service.start(PROFILE_ID));
    expect(first).not.toBe(second);
  });

  it('answers not found to another tenant, without calling the provider', async () => {
    const id = await inRequest('req-6', () => service.start(PROFILE_ID));
    await expect(inRequest('req-7', () => service.run(id, EVIDENCE), 'tenant-b')).rejects.toBeInstanceOf(KycVerificationNotFound);
    expect(provider.verify).not.toHaveBeenCalled();
  });
});
```
