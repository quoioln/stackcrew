Goes to `src/modules/kyc/kyc-verification.service.spec.ts`.

```ts
// Default location: src/modules/kyc/kyc-verification.service.spec.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { runWithRequestContext } from '../../common/context/request-context';
import { AuditSubscriber } from '../../common/database/audit.subscriber';
import { TenantSubscriber } from '../../common/database/tenant.subscriber';
import { ProviderRejectedError, ProviderUnavailableError } from '../../common/providers/provider.errors';
import { CreateKycVerification1730000000002 } from '../../database/migrations/1730000000002-create-kyc-verification';
import { KycVerification, KycVerificationStatus } from './entities/kyc-verification.entity';
import { KycDecision, type VerifyIdentityResult } from './interfaces/kyc-verification';
import type { KycProvider } from './kyc-provider.port';
import { KycVerificationFailed, KycVerificationNotFound } from './kyc-verification.errors';
import { KycVerificationRepository } from './kyc-verification.repository';
import { KycVerificationService } from './kyc-verification.service';

const EVIDENCE = { documentNumber: '079201001234', selfie: Buffer.alloc(16, 1) };
const APPROVED: VerifyIdentityResult = { decision: KycDecision.APPROVED, score: 97.5, providerReference: 'acme-tx-1' };
const CONCURRENT_STARTS = 3;

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

  /** Other sessions of this database inside a transaction, waiting: what a remote call made inside a transaction looks like. */
  const openTransactions = async (): Promise<number> => {
    const rows: { open: number }[] = await dataSource.query(
      `SELECT count(*)::int AS open FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`);
    return rows[0].open;
  };

  it('stores the operation before any call, and a business retry reuses its stored id as the idempotency key', async () => {
    const id = await inRequest('req-1', () => service.start(randomUUID()));
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
    const id = await inRequest('req-3', () => service.start(randomUUID()));
    provider.verify.mockResolvedValueOnce(APPROVED);
    await inRequest('req-3', () => service.run(id, EVIDENCE));
    await expect(inRequest('req-4', () => service.run(id, EVIDENCE))).resolves.toBe(KycDecision.APPROVED);
    expect(provider.verify).toHaveBeenCalledTimes(1);
  });

  it('returns the pending operation of the profile instead of a second one, also to concurrent starts', async () => {
    const profileId = randomUUID();
    const first = await inRequest('req-5', () => service.start(profileId));
    expect(await inRequest('req-6', () => service.start(profileId))).toBe(first);
    const concurrent = await Promise.all(Array.from({ length: CONCURRENT_STARTS }, () => inRequest('req-7', () => service.start(profileId))));
    expect(concurrent).toEqual(Array.from({ length: CONCURRENT_STARTS }, () => first));
    expect(await inRequest('test-read', () => verifications.count({ where: { profileId } }))).toBe(1);
  });

  it('starts a new operation, with a new key, once the previous one completed', async () => {
    const profileId = randomUUID();
    const first = await inRequest('req-8', () => service.start(profileId));
    provider.verify.mockResolvedValueOnce(APPROVED);
    await inRequest('req-8', () => service.run(first, EVIDENCE));
    expect(await inRequest('req-9', () => service.start(profileId))).not.toBe(first);
  });

  it('ends the operation FAILED when the provider rejects it: no further call, and a new start gets a new key', async () => {
    const profileId = randomUUID();
    const id = await inRequest('req-10', () => service.start(profileId));
    provider.verify.mockRejectedValueOnce(new ProviderRejectedError());
    await expect(inRequest('req-10', () => service.run(id, EVIDENCE))).rejects.toBeInstanceOf(ProviderRejectedError);
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.FAILED, decision: null });

    await expect(inRequest('req-11', () => service.run(id, EVIDENCE))).rejects.toBeInstanceOf(KycVerificationFailed);
    expect(provider.verify).toHaveBeenCalledTimes(1);
    expect(await inRequest('req-11', () => service.start(profileId))).not.toBe(id);
  });

  it('calls the provider with no transaction open', async () => {
    const id = await inRequest('req-12', () => service.start(randomUUID()));
    const openDuringCall: number[] = [];
    provider.verify.mockImplementationOnce(async () => {
      openDuringCall.push(await openTransactions());
      return APPROVED;
    });
    await inRequest('req-12', () => service.run(id, EVIDENCE));
    expect(openDuringCall).toEqual([0]);
  });

  it('answers not found to another tenant, without calling the provider', async () => {
    const id = await inRequest('req-13', () => service.start(randomUUID()));
    await expect(inRequest('req-14', () => service.run(id, EVIDENCE), 'tenant-b')).rejects.toBeInstanceOf(KycVerificationNotFound);
    expect(provider.verify).not.toHaveBeenCalled();
  });
});
```
