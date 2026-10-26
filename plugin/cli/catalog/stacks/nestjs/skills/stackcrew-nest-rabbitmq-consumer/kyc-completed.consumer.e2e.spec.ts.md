Goes to `test/kyc-completed.consumer.e2e.spec.ts`.

```ts
// Default location: test/kyc-completed.consumer.e2e.spec.ts
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RabbitMQContainer, type StartedRabbitMQContainer } from '@testcontainers/rabbitmq';
import { connect, type ConfirmChannel, type GetMessage } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { currentContext, runCrossTenant, runWithRequestContext, type RequestContext } from '../src/common/context/request-context';
import { CAPTURE_LIMIT_BYTES } from '../src/common/logging/body-masker';
import { MessagePublisher } from '../src/common/messaging/message-publisher';
import { ProcessedMessage } from '../src/common/messaging/processed-message.entity';
import { RabbitMqConnection } from '../src/common/messaging/rabbitmq.connection';
import { parkingQueue } from '../src/common/messaging/work-queue';
import type { RabbitMqEnv } from '../src/config/env';
import { CustomerProfileRepository } from '../src/modules/customer-profiles/customer-profile.repository';
import { CustomerProfileStatus } from '../src/modules/customer-profiles/entities/customer-profile.entity';
import { KycCompletedConsumer } from '../src/modules/customer-profiles/messaging/kyc-completed.consumer';
import { KycCompletedHandler } from '../src/modules/customer-profiles/messaging/kyc-completed.handler';
import { KYC_COMPLETED_TYPE, KYC_COMPLETED_VERSION, KycOutcome, type KycCompletedMessage } from '../src/modules/customer-profiles/messaging/kyc-completed.message';
import { KYC_COMPLETED_QUEUE } from '../src/modules/customer-profiles/messaging/kyc-messaging.constants';
import { CapturingLogger, createTestApp } from './support/test-app';
import { TestIssuer } from './support/test-issuer';

type Line = Record<string, unknown>;
type Isolated = {
  consumer: KycCompletedConsumer;
  channel: ConfirmChannel;
  publish: (content: Buffer, messageId: string, headers: Record<string, string>) => Promise<void>;
  close: () => Promise<void>;
};

const CONTAINERS_MS = 180_000;
const RETRY_TEST_MS = 60_000; // retryDelayMs is 5 s per wait-queue cycle
const WAIT_MS = 30_000;
const POLL_MS = 50;
const IN_FLIGHT_MS = 500;
/** Well under RECONNECT_SECONDS (5 s): readiness drops when the channel closes, not when the reconnect comes. */
const NOT_READY_WITHIN_MS = 2_000;
const { exchange, routingKey } = KYC_COMPLETED_QUEUE;

/** ConfigService reads process.env first: point RABBITMQ_URL at another vhost while a connection is created. */
function withRabbitUrl<T>(url: string, create: () => T): T {
  const saved = process.env.RABBITMQ_URL;
  process.env.RABBITMQ_URL = url;
  try {
    return create();
  } finally {
    process.env.RABBITMQ_URL = saved;
  }
}

describe('kyc.completed consumer (e2e: RabbitMQ and Postgres in Testcontainers)', () => {
  const issuer = new TestIssuer();
  const logger = new CapturingLogger();
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedRabbitMQContainer;
  let app: NestExpressApplication;
  let broker: Awaited<ReturnType<typeof connect>>;
  let channel: ConfirmChannel;

  beforeAll(async () => {
    [postgres, rabbit] = await Promise.all([new PostgreSqlContainer('postgres:16-alpine').start(), new RabbitMQContainer('rabbitmq:4-alpine').start()]);
    process.env.DATABASE_URL = postgres.getConnectionUri();
    process.env.RABBITMQ_URL = rabbit.getAmqpUrl();
    await issuer.start();
    app = await createTestApp(logger); // imports AppModule only now, after the env is set
    await app.get(DataSource).runMigrations();
    await app.get(KycCompletedConsumer).ready(); // topology declared, consumer registered
    broker = await connect(rabbit.getAmqpUrl());
    channel = await broker.createConfirmChannel(); // the test's own producer and parking-queue reader
  }, CONTAINERS_MS);

  afterAll(async () => {
    await channel.close();
    await broker.close();
    await app.close();
    await issuer.stop();
    await Promise.all([postgres.stop(), rabbit.stop()]);
  }, CONTAINERS_MS);

  const lines = (event: string, key: string, value: string): Line[] =>
    logger.records.map((record) => record.fields).filter((fields) => fields.event === event && fields[key] === value);
  const outcomes = (messageId: string): Line[] => lines('message_outcome', 'messageId', messageId);
  const messageIns = (requestId: string): Line[] => lines('message_in', 'requestId', requestId);
  const payload = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
  const kycCompleted = (profileId: string, outcome: KycOutcome = KycOutcome.APPROVED): KycCompletedMessage => ({
    messageId: randomUUID(), type: KYC_COMPLETED_TYPE, version: KYC_COMPLETED_VERSION, occurredAt: new Date().toISOString(), profileId, outcome,
  });

  /** Polls until done(value) holds or WAIT_MS passed; the assertions that follow report what was seen. */
  async function eventually<T>(read: () => T | Promise<T>, done: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + WAIT_MS;
    let value = await read();
    while (!done(value) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      value = await read();
    }
    return value;
  }

  /** Publishes raw bytes with the given headers, as any producer could, and waits for the broker confirm. */
  async function publishRaw(content: Buffer, messageId: string, headers: Record<string, string>): Promise<void> {
    channel.publish(exchange, routingKey, content, { persistent: true, contentType: 'application/json', messageId, headers });
    await channel.waitForConfirms();
  }

  async function takeParked(messageId: string): Promise<GetMessage | undefined> {
    return eventually(async () => {
      for (let next = await channel.get(parkingQueue(KYC_COMPLETED_QUEUE), { noAck: true }); next !== false;
        next = await channel.get(parkingQueue(KYC_COMPLETED_QUEUE), { noAck: true })) {
        if (next.properties.messageId === messageId) {
          return next;
        }
      }
      return undefined;
    }, (found) => found !== undefined);
  }

  /**
   * A vhost of its own, with its own connection and consumer, for the rows that stop, cancel or break a consumer: the
   * app's consumer is untouched, so every row passes in any order. `prepare` runs on the empty vhost first.
   */
  async function isolatedVhost(vhost: string, prepare: (raw: ConfirmChannel) => Promise<unknown> = async () => undefined): Promise<Isolated> {
    await rabbit.exec(['rabbitmqctl', 'add_vhost', vhost]);
    await rabbit.exec(['rabbitmqctl', 'set_permissions', '-p', vhost, 'guest', '.*', '.*', '.*']);
    const url = `${rabbit.getAmqpUrl()}/${vhost}`;
    const raw = await connect(url);
    const rawChannel = await raw.createConfirmChannel();
    await prepare(rawChannel);
    const connection = withRabbitUrl(url, () => new RabbitMqConnection(new ConfigService<RabbitMqEnv, true>()));
    const consumer = new KycCompletedConsumer(connection, app.get(KycCompletedHandler));
    consumer.onApplicationBootstrap();
    return {
      consumer,
      channel: rawChannel,
      publish: async (content, messageId, headers) => {
        rawChannel.publish(exchange, routingKey, content, { persistent: true, contentType: 'application/json', messageId, headers });
        await rawChannel.waitForConfirms();
      },
      close: async () => {
        await consumer.onModuleDestroy();
        await connection.onApplicationShutdown();
        await raw.close();
        await rabbit.exec(['rabbitmqctl', 'delete_vhost', vhost]);
      },
    };
  }

  const asUser = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    runWithRequestContext({ requestId: randomUUID(), userId: 'seeder', tenantId, roles: [] }, fn);
  async function seedProfile(tenantId: string): Promise<string> {
    const profiles = app.get(CustomerProfileRepository);
    const saved = await asUser(tenantId, () => profiles.save(profiles.create({ reference: `ref-${randomUUID()}`, fullName: 'Nguyen Van A', status: CustomerProfileStatus.PENDING })));
    return saved.id;
  }
  const profileOf = (tenantId: string, id: string): Promise<unknown> => asUser(tenantId, () => app.get(CustomerProfileRepository).findOneBy({ id }));

  it('applies kyc.completed in the tenant of x-tenant-id, as the user of x-user-id, with one masked message_in line', async () => {
    expect(app.get(KycCompletedConsumer).isConsuming()).toBe(true); // what the readiness probe reads
    const profileId = await seedProfile('tenant-a');
    const handler = app.get(KycCompletedHandler);
    const original = handler.handle.bind(handler);
    const seen: (RequestContext | undefined)[] = [];
    const spy = jest.spyOn(handler, 'handle').mockImplementation(async (message) => {
      seen.push(currentContext());
      return original(message);
    });
    try {
      const message = kycCompleted(profileId);
      // fullName is unknown to the schema: the codec drops it, the message_in line shows it masked
      await publishRaw(payload({ ...message, fullName: 'Nguyen Van A' }), message.messageId,
        { 'x-request-id': 'req-kyc-1', 'x-tenant-id': 'tenant-a', 'x-user-id': 'kyc-service' });
      expect(await eventually(() => outcomes(message.messageId), (found) => found.length > 0)).toEqual([expect.objectContaining({ outcome: 'applied' })]);
      expect(await profileOf('tenant-a', profileId)).toMatchObject({ status: CustomerProfileStatus.VERIFIED, updatedBy: 'kyc-service' });
      expect(seen).toEqual([expect.objectContaining({ requestId: 'req-kyc-1', tenantId: 'tenant-a', userId: 'kyc-service', roles: [] })]);
      expect(seen[0]?.system).toBeUndefined();
      expect(messageIns('req-kyc-1')).toHaveLength(1);
      expect(messageIns('req-kyc-1')[0]).toMatchObject({ tenantId: 'tenant-a', userId: 'kyc-service' });
      expect(messageIns('req-kyc-1')[0].reqBody).toContain('"fullName":"***"');
    } finally {
      spy.mockRestore();
    }
  });

  it('applies a duplicate delivery once; the producer sends the three context headers', async () => {
    const profileId = await seedProfile('tenant-a');
    const message = kycCompleted(profileId);
    const context: RequestContext = { requestId: 'req-dup', tenantId: 'tenant-a', userId: 'kyc-service', roles: [] };
    await app.get(MessagePublisher).publish(exchange, routingKey, message, context);
    await app.get(MessagePublisher).publish(exchange, routingKey, message, context); // the duplicate: same messageId
    // with prefetch > 1 both deliveries run concurrently, so wait for both outcomes (a later message proves nothing)
    const found = await eventually(() => outcomes(message.messageId), (seen) => seen.length >= 2);
    expect(found.map((line) => line.outcome).sort()).toEqual(['applied', 'duplicate']);
    expect(await app.get(DataSource).getRepository(ProcessedMessage).countBy({ messageId: message.messageId })).toBe(1);
    expect(messageIns('req-dup')).toHaveLength(2);
    expect(messageIns('req-dup')[0]).toMatchObject({ tenantId: 'tenant-a', userId: 'kyc-service' });
  });

  it.each([
    ['a poison message (not JSON)', Buffer.from('{"messageId":'), 'not_json', '<application/json 13 bytes>'],
    ['a tombstone (empty payload)', Buffer.alloc(0), 'empty_payload', undefined],
    ['a message that breaks the schema', payload({ type: KYC_COMPLETED_TYPE, version: 2, cardNumber: '4111' }), 'invalid_message', '{"type":"kyc.completed","version":2,"cardNumber":"***"}'],
  ])('parks %s at once: one delivery, no retry', async (_case, content, reason, reqBody) => {
    const messageId = randomUUID();
    const requestId = `req-${messageId}`;
    await publishRaw(content, messageId, { 'x-request-id': requestId, 'x-tenant-id': 'tenant-a' });
    expect(await eventually(() => outcomes(messageId), (found) => found.length > 0)).toEqual([expect.objectContaining({ outcome: 'parked', reason })]);
    expect(messageIns(requestId)).toHaveLength(1);
    expect(messageIns(requestId)[0].reqBody).toEqual(reqBody);
    const parked = await takeParked(messageId);
    expect(parked?.content.equals(content)).toBe(true);
    expect(parked?.properties.headers?.['x-parked-reason']).toBe(reason);
    expect(parked?.properties.headers?.['x-death']).toBeUndefined(); // it never went through the wait queue
  });

  it('never lets x-user-id: {{sc:systemUser}} read or write across tenants', async () => {
    const profileOfA = await seedProfile('tenant-a');
    const handler = app.get(KycCompletedHandler);
    const original = handler.handle.bind(handler);
    const crossTenant: unknown[] = [];
    const spy = jest.spyOn(handler, 'handle').mockImplementation(async (message) => {
      crossTenant.push(await runCrossTenant('consumer probe', async () => 'read').catch((denied: unknown) => (denied instanceof Error ? denied.name : denied)));
      return original(message);
    });
    try {
      const message = kycCompleted(profileOfA);
      await publishRaw(payload(message), message.messageId, { 'x-tenant-id': 'tenant-b', 'x-user-id': '{{sc:systemUser}}' });
      expect(await eventually(() => outcomes(message.messageId), (found) => found.length > 0))
        .toEqual([expect.objectContaining({ outcome: 'parked', reason: 'business_rule' })]); // not in tenant-b: nothing changed
      expect(crossTenant).toEqual(['CrossTenantDeniedError']);
      expect(await profileOf('tenant-a', profileOfA)).toMatchObject({ status: CustomerProfileStatus.PENDING, updatedBy: 'seeder' });
    } finally {
      spy.mockRestore();
    }
  });

  it('parks a message without x-tenant-id: MissingTenantError does not go away on a retry', async () => {
    const profileId = await seedProfile('tenant-a');
    const message = kycCompleted(profileId);
    await publishRaw(payload(message), message.messageId, { 'x-user-id': 'kyc-service' });
    expect(await eventually(() => outcomes(message.messageId), (found) => found.length > 0))
      .toEqual([expect.objectContaining({ outcome: 'parked', reason: 'missing_tenant', error: 'MissingTenantError' })]);
    expect(await profileOf('tenant-a', profileId)).toMatchObject({ status: CustomerProfileStatus.PENDING });
  });

  it('retries a transient failure through the wait queue, then applies the message', async () => {
    const profileId = await seedProfile('tenant-a');
    const spy = jest.spyOn(app.get(KycCompletedHandler), 'handle').mockRejectedValueOnce(new Error('database unavailable'));
    try {
      const message = kycCompleted(profileId, KycOutcome.REJECTED);
      await publishRaw(payload(message), message.messageId, { 'x-tenant-id': 'tenant-a', 'x-user-id': 'kyc-service' });
      const found = await eventually(() => outcomes(message.messageId), (seen) => seen.length >= 2);
      expect(found.map((line) => line.outcome)).toEqual(['retry', 'applied']);
      expect(await profileOf('tenant-a', profileId)).toMatchObject({ status: CustomerProfileStatus.REJECTED });
    } finally {
      spy.mockRestore();
    }
  }, RETRY_TEST_MS);

  it('parks a message whose transient failure outlasts maxAttempts, counted by the broker', async () => {
    const profileId = await seedProfile('tenant-a');
    const spy = jest.spyOn(app.get(KycCompletedHandler), 'handle').mockRejectedValue(new Error('database unavailable'));
    try {
      const message = kycCompleted(profileId);
      await publishRaw(payload(message), message.messageId, { 'x-tenant-id': 'tenant-a', 'x-user-id': 'kyc-service' });
      const found = await eventually(() => outcomes(message.messageId), (seen) => seen.length >= KYC_COMPLETED_QUEUE.maxAttempts);
      expect(found.map((line) => line.outcome)).toEqual(['retry', 'retry', 'parked']);
      expect(found[2]).toMatchObject({ reason: 'attempts_exhausted' });
      const parked = await takeParked(message.messageId);
      expect(parked?.properties.headers?.['x-parked-reason']).toBe('attempts_exhausted');
    } finally {
      spy.mockRestore();
    }
  }, RETRY_TEST_MS);

  it('logs only the size of a payload over 2 MiB in message_in, and still applies the message', async () => {
    const message = kycCompleted(await seedProfile('tenant-a'));
    const big = payload({ ...message, note: 'x'.repeat(CAPTURE_LIMIT_BYTES + 1) }); // a field the codec drops
    await publishRaw(big, message.messageId, { 'x-request-id': 'req-big', 'x-tenant-id': 'tenant-a', 'x-user-id': 'kyc-service' });
    expect(await eventually(() => outcomes(message.messageId), (found) => found.length > 0)).toEqual([expect.objectContaining({ outcome: 'applied' })]);
    expect(messageIns('req-big')[0].reqBody).toBe(`<application/json ${big.length} bytes>`); // never parsed for the line
  });

  it('on shutdown stops new deliveries, lets the delivery in flight finish and ack, then closes', async () => {
    const isolated = await isolatedVhost('shutdown-drain');
    const handler = app.get(KycCompletedHandler);
    const original = handler.handle.bind(handler);
    let started = false;
    const spy = jest.spyOn(handler, 'handle').mockImplementation(async (message) => {
      started = true;
      await new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_MS)); // still running when the shutdown starts
      return original(message);
    });
    try {
      await isolated.consumer.ready();
      const inFlight = kycCompleted(await seedProfile('tenant-a'));
      await isolated.publish(payload(inFlight), inFlight.messageId, { 'x-tenant-id': 'tenant-a', 'x-user-id': 'kyc-service' });
      await eventually(() => started, (yes) => yes);
      await isolated.consumer.onModuleDestroy(); // what app.close() calls
      expect(outcomes(inFlight.messageId)).toEqual([expect.objectContaining({ outcome: 'applied' })]); // acked before the close
      expect(isolated.consumer.isConsuming()).toBe(false);
      const later = kycCompleted(await seedProfile('tenant-a'));
      await isolated.publish(payload(later), later.messageId, { 'x-tenant-id': 'tenant-a', 'x-user-id': 'kyc-service' });
      const queue = await eventually(() => isolated.channel.checkQueue(KYC_COMPLETED_QUEUE.queue), (state) => state.messageCount === 1);
      expect(queue).toMatchObject({ messageCount: 1, consumerCount: 0 }); // waits in the queue for the next consumer
      expect(outcomes(later.messageId)).toEqual([]);
    } finally {
      spy.mockRestore();
      await isolated.close();
    }
  });

  it('logs a failed setup (PRECONDITION_FAILED), keeps the process alive and reports the consumer not ready', async () => {
    const channelErrors = (): Line[] => lines('rabbitmq_channel_error', 'channel', 'kyc-completed');
    const earlier = channelErrors().length; // other rows may have logged channel errors of their own
    // the queue already exists with other arguments than assertWorkQueue declares, as after a changed retryDelayMs
    const isolated = await isolatedVhost('failed-setup', (raw) => raw.assertQueue(KYC_COMPLETED_QUEUE.queue, { durable: true, arguments: { 'x-queue-type': 'quorum' } }));
    try {
      const errors = (await eventually(channelErrors, (found) => found.length > earlier)).slice(earlier);
      expect(errors[0]).toMatchObject({ code: 406, error: expect.any(String) }); // 406 = PRECONDITION_FAILED
      expect(errors.flatMap((line) => Object.keys(line))).not.toContain('message'); // the AMQP reply text is never logged
      expect(isolated.consumer.isConsuming()).toBe(false); // the readiness probe reports it; the process is still here to say so
    } finally {
      await isolated.close();
    }
  });

  it('re-registers after the broker cancels it (its queue deleted) and consumes again, without a restart', async () => {
    const isolated = await isolatedVhost('broker-cancel');
    try {
      await isolated.consumer.ready();
      expect(isolated.consumer.isConsuming()).toBe(true);
      const deletedAt = Date.now();
      await isolated.channel.deleteQueue(KYC_COMPLETED_QUEUE.queue); // the broker cancels the consumer
      expect(await eventually(() => isolated.consumer.isConsuming(), (consuming) => !consuming)).toBe(false); // not ready meanwhile
      expect(Date.now() - deletedAt).toBeLessThan(NOT_READY_WITHIN_MS);
      expect(await eventually(() => isolated.consumer.isConsuming(), (consuming) => consuming)).toBe(true); // the reconnect ran setup
      const message = kycCompleted(await seedProfile('tenant-a'));
      await isolated.publish(payload(message), message.messageId, { 'x-tenant-id': 'tenant-a', 'x-user-id': 'kyc-service' });
      expect(await eventually(() => outcomes(message.messageId), (found) => found.length > 0)).toEqual([expect.objectContaining({ outcome: 'applied' })]);
      expect(await isolated.channel.checkQueue(KYC_COMPLETED_QUEUE.queue)).toMatchObject({ consumerCount: 1 }); // re-declared, consumed again
    } finally {
      await isolated.close();
    }
  }, RETRY_TEST_MS);
});
```
