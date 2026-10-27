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
import { KycDecision, type KycOutcomeEffects, type VerifyIdentityResult } from './interfaces/kyc-verification';
import type { KycProvider } from './kyc-provider.port';
import { KycVerificationFailed, KycVerificationNotFound } from './kyc-verification.errors';
import { KycVerificationRepository } from './kyc-verification.repository';
import { KycVerificationService } from './kyc-verification.service';

const EVIDENCE = { documentNumber: '079201001234', selfie: Buffer.alloc(16, 1) };
const APPROVED: VerifyIdentityResult = { decision: KycDecision.APPROVED, score: 97.5, providerReference: 'acme-tx-1' };
const CONCURRENT_STARTS = 3;
/** The side write of an outcome in this test: one row per effect that ran, in the transaction that wrote the status. */
const OUTCOME_PROBE = 'kyc_outcome_probe';

type Actor = { tenantId?: string; userId?: string };
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };
/** A run held in flight: `started` resolves once its provider call is registered; the test then releases it. */
type Held = { started: Promise<void>; resolve: (result: VerifyIdentityResult) => void; reject: (reason: unknown) => void };

/** Runs fn in a request with the given request id, as the controller or consumer would: tenant A as alice unless told otherwise. */
const inRequest = <T>(requestId: string, fn: () => Promise<T>, actor: Actor = {}): Promise<T> =>
  runWithRequestContext({ requestId, userId: actor.userId ?? 'alice', tenantId: actor.tenantId ?? 'tenant-a', roles: [] }, fn);

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('KycVerificationService (Postgres, a fake KycProvider)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let verifications: KycVerificationRepository;
  let service: KycVerificationService;
  const provider: jest.Mocked<KycProvider> = { verify: jest.fn() };
  /** Set by a test: the effects write their probe row, then throw this. */
  let effectFailure: Error | undefined;
  /** What a feature writes with an outcome (the profile status, an outbox row): here a probe row, through the transaction's manager. */
  const effects: KycOutcomeEffects = {
    completed: async (manager, verification, result) => {
      await manager.query(`INSERT INTO ${OUTCOME_PROBE} ("verificationId", outcome) VALUES ($1, $2)`, [verification.id, result.decision]);
      if (effectFailure !== undefined) {
        throw effectFailure;
      }
    },
    failed: async (manager, verification) => {
      await manager.query(`INSERT INTO ${OUTCOME_PROBE} ("verificationId", outcome) VALUES ($1, $2)`, [verification.id, KycVerificationStatus.FAILED]);
      if (effectFailure !== undefined) {
        throw effectFailure;
      }
    },
  };

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
    await dataSource.query(`CREATE TABLE ${OUTCOME_PROBE} (seq serial PRIMARY KEY, "verificationId" uuid NOT NULL, outcome varchar(16) NOT NULL)`);
    verifications = new KycVerificationRepository(dataSource.getRepository(KycVerification));
    service = new KycVerificationService(verifications, provider, dataSource, effects);
  });

  beforeEach(() => {
    provider.verify.mockReset();
    effectFailure = undefined;
  });

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  });

  /** The row as tenant A sees it, through the tenant repository like any other read. */
  const stored = (id: string): Promise<KycVerification | null> => inRequest('test-read', () => verifications.findOneBy({ id }));

  /** The side writes that committed for the operation, in order. */
  const sideWrites = async (id: string): Promise<string[]> => {
    const rows: { outcome: string }[] = await dataSource.query(`SELECT outcome FROM ${OUTCOME_PROBE} WHERE "verificationId" = $1 ORDER BY seq`, [id]);
    return rows.map((row) => row.outcome);
  };

  /** Other sessions of this database inside a transaction, waiting: what a remote call made inside a transaction looks like. */
  const openTransactions = async (): Promise<number> => {
    const rows: { open: number }[] = await dataSource.query(
      `SELECT count(*)::int AS open FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`);
    return rows[0].open;
  };

  /** The run of `heldRequestId` stays in flight until the test releases it; every other run gets `other` at once. */
  function raceProvider(heldRequestId: string, other: () => Promise<VerifyIdentityResult>): Held {
    const held = deferred<VerifyIdentityResult>();
    const started = deferred<void>();
    provider.verify.mockImplementation((command) => {
      if (command.traceRef !== heldRequestId) {
        return other();
      }
      started.resolve();
      return held.promise;
    });
    return { started: started.promise, resolve: held.resolve, reject: held.reject };
  }

  it('stores the operation before any call, and a business retry reuses its stored id as the idempotency key', async () => {
    const id = await inRequest('req-1', () => service.start(randomUUID()));
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.PENDING, decision: null }); // committed, no call yet
    expect(provider.verify).not.toHaveBeenCalled();

    provider.verify.mockRejectedValueOnce(new ProviderUnavailableError()); // the client's own retries are exhausted
    await expect(inRequest('req-1', () => service.run(id, EVIDENCE))).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.PENDING });
    expect(await sideWrites(id)).toEqual([]);

    provider.verify.mockResolvedValueOnce(APPROVED); // the business retry: a later request, or a redelivered message
    await expect(inRequest('req-2', () => service.run(id, EVIDENCE))).resolves.toBe(KycDecision.APPROVED);

    const commands = provider.verify.mock.calls.map(([command]) => command);
    expect(commands.map((command) => command.idempotencyKey)).toEqual([id, id]); // the stored key, both times
    expect(commands.map((command) => command.traceRef)).toEqual(['req-1', 'req-2']); // the request id is correlation only
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.COMPLETED, decision: KycDecision.APPROVED, providerReference: 'acme-tx-1' });
    expect(await sideWrites(id)).toEqual([KycDecision.APPROVED]); // committed with the status, once
  });

  it('returns the stored decision of a completed operation without calling the provider again', async () => {
    const id = await inRequest('req-3', () => service.start(randomUUID()));
    provider.verify.mockResolvedValueOnce(APPROVED);
    await inRequest('req-3', () => service.run(id, EVIDENCE));
    await expect(inRequest('req-4', () => service.run(id, EVIDENCE))).resolves.toBe(KycDecision.APPROVED);
    expect(provider.verify).toHaveBeenCalledTimes(1);
  });

  it('returns the pending operation of the profile instead of a second one: to concurrent starts of a new profile, and to a later start by another user', async () => {
    const profileId = randomUUID();
    // no row exists yet: the concurrent inserts race on the partial unique index, and all of them get the one row
    const concurrent = await Promise.all(Array.from({ length: CONCURRENT_STARTS }, (_, i) => inRequest(`req-5-${i}`, () => service.start(profileId))));
    const [first] = concurrent;
    expect(concurrent).toEqual(Array.from({ length: CONCURRENT_STARTS }, () => first));
    expect(await inRequest('req-6', () => service.start(profileId), { userId: 'bob' })).toBe(first);
    expect(await stored(first)).toMatchObject({ createdBy: 'alice', updatedBy: 'bob' }); // the conflict update is audited like any update
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
    expect(await sideWrites(id)).toEqual([KycVerificationStatus.FAILED]); // the failure's own side write, committed with the status

    await expect(inRequest('req-11', () => service.run(id, EVIDENCE))).rejects.toBeInstanceOf(KycVerificationFailed);
    expect(provider.verify).toHaveBeenCalledTimes(1);
    expect(await inRequest('req-11', () => service.start(profileId))).not.toBe(id);
  });

  it('two concurrent runs, one answered 409 (the key is in use) and one approved: the row is COMPLETED and both callers end with that outcome', async () => {
    const id = await inRequest('req-15', () => service.start(randomUUID()));
    // a 409 reaches the service as ProviderUnavailableError (the adapter's mapping): the provider is still working on this key
    const held = raceProvider('req-15', () => Promise.reject(new ProviderUnavailableError()));
    const heldRun = inRequest('req-15', () => service.run(id, EVIDENCE));
    await held.started; // its call is in flight before the second run begins
    await expect(inRequest('req-16', () => service.run(id, EVIDENCE))).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.PENDING }); // left open for the run in flight and for a retry
    held.resolve(APPROVED);
    await expect(heldRun).resolves.toBe(KycDecision.APPROVED);
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.COMPLETED, decision: KycDecision.APPROVED });
    await expect(inRequest('req-16', () => service.run(id, EVIDENCE))).resolves.toBe(KycDecision.APPROVED); // the 409 caller's retry: stored, no call
    expect(provider.verify).toHaveBeenCalledTimes(2);
  });

  it('a refusal while another run succeeds: COMPLETED replaces FAILED, and the refused caller gets the decision on its retry', async () => {
    const id = await inRequest('req-17', () => service.start(randomUUID()));
    const held = raceProvider('req-17', () => Promise.reject(new ProviderRejectedError()));
    const heldRun = inRequest('req-17', () => service.run(id, EVIDENCE));
    await held.started;
    await expect(inRequest('req-18', () => service.run(id, EVIDENCE))).rejects.toBeInstanceOf(ProviderRejectedError);
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.FAILED });
    held.resolve(APPROVED); // the provider applied the operation after all: its success is authoritative
    await expect(heldRun).resolves.toBe(KycDecision.APPROVED);
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.COMPLETED, decision: KycDecision.APPROVED });
    expect(await sideWrites(id)).toEqual([KycVerificationStatus.FAILED, KycDecision.APPROVED]); // each status write that won carried its side write
    await expect(inRequest('req-18', () => service.run(id, EVIDENCE))).resolves.toBe(KycDecision.APPROVED);
    expect(provider.verify).toHaveBeenCalledTimes(2);
  });

  it('two concurrent runs that both get a reply: the result stored first is the outcome of both callers, and the losing run writes no side effect', async () => {
    const id = await inRequest('req-19', () => service.start(randomUUID()));
    const held = raceProvider('req-19', () => Promise.resolve(APPROVED));
    const heldRun = inRequest('req-19', () => service.run(id, EVIDENCE));
    await held.started;
    await expect(inRequest('req-20', () => service.run(id, EVIDENCE))).resolves.toBe(KycDecision.APPROVED); // stored first
    // the late reply differs (which an idempotent provider never does): the stored state decides, so both callers agree with the row
    held.resolve({ decision: KycDecision.REJECTED, score: 1, providerReference: 'acme-tx-late' });
    await expect(heldRun).resolves.toBe(KycDecision.APPROVED);
    expect(provider.verify).toHaveBeenCalledTimes(2); // the held run did call: its update affected no row
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.COMPLETED, decision: KycDecision.APPROVED, providerReference: 'acme-tx-1' });
    expect(await sideWrites(id)).toEqual([KycDecision.APPROVED]); // no REJECTED side write from the run that lost
  });

  it('a refusal arriving after a success: the FAILED write affects no row, nothing else is written, and the caller gets the stored decision', async () => {
    const id = await inRequest('req-21', () => service.start(randomUUID()));
    const held = raceProvider('req-21', () => Promise.resolve(APPROVED));
    const heldRun = inRequest('req-21', () => service.run(id, EVIDENCE));
    await held.started;
    await expect(inRequest('req-22', () => service.run(id, EVIDENCE))).resolves.toBe(KycDecision.APPROVED);
    held.reject(new ProviderRejectedError()); // a late refusal of a key the provider has already applied
    await expect(heldRun).resolves.toBe(KycDecision.APPROVED);
    expect(provider.verify).toHaveBeenCalledTimes(2);
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.COMPLETED, decision: KycDecision.APPROVED });
    expect(await sideWrites(id)).toEqual([KycDecision.APPROVED]); // no FAILED side write
  });

  it('an outcome side write that throws rolls back the status write: the operation stays as it was, with no side write, and run rejects', async () => {
    const id = await inRequest('req-23', () => service.start(randomUUID()));
    effectFailure = new Error('outbox write failed');
    provider.verify.mockResolvedValueOnce(APPROVED);
    await expect(inRequest('req-23', () => service.run(id, EVIDENCE))).rejects.toBe(effectFailure);
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.PENDING, decision: null });
    expect(await sideWrites(id)).toEqual([]); // the probe row was written, then rolled back with the status

    provider.verify.mockRejectedValueOnce(new ProviderRejectedError()); // the same for the failure's side write
    await expect(inRequest('req-24', () => service.run(id, EVIDENCE))).rejects.toBe(effectFailure);
    expect(await stored(id)).toMatchObject({ status: KycVerificationStatus.PENDING, decision: null });
    expect(await sideWrites(id)).toEqual([]);

    effectFailure = undefined; // fixed: the retry calls with the same key and commits the status with its side write
    provider.verify.mockResolvedValueOnce(APPROVED);
    await expect(inRequest('req-25', () => service.run(id, EVIDENCE))).resolves.toBe(KycDecision.APPROVED);
    expect(provider.verify.mock.calls.map(([command]) => command.idempotencyKey)).toEqual([id, id, id]);
    expect(await sideWrites(id)).toEqual([KycDecision.APPROVED]);
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
    await expect(inRequest('req-14', () => service.run(id, EVIDENCE), { tenantId: 'tenant-b' })).rejects.toBeInstanceOf(KycVerificationNotFound);
    expect(provider.verify).not.toHaveBeenCalled();
  });
});
```
