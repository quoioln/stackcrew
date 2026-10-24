import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { validateCatalog } from '../src/catalog/validate.js';
import { detectProject } from '../src/detect.js';
import { createProfile, validateProfile } from '../src/profile.js';
import { buildContext } from '../src/render/context.js';
import { renderProject } from '../src/render/index.js';
import { renderAgentsMdBlock } from '../src/render/agents-md.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL_TOOLS = ['claude', 'cursor', 'codex', 'antigravity'];
const ADDON_IDS = ['kafka', 'rabbitmq', 'camel', 'observability'];
const KAFKA_SKILL = 'stackcrew-spring-kafka-consumer';
const OPTS = { cli: 'npx stackcrew', version: '0.0.0' };

async function withRealCatalog(fn) {
  const saved = process.env.STACKCREW_CATALOG_DIR;
  delete process.env.STACKCREW_CATALOG_DIR;
  try {
    return await fn(await loadCatalog());
  } finally {
    if (saved !== undefined) process.env.STACKCREW_CATALOG_DIR = saved;
  }
}

const profileFor = (catalog, addons) =>
  createProfile({ stack: 'spring-boot', addons, tools: ALL_TOOLS, mode: 'greenfield', basePackage: 'com.acme.kyc' }, catalog);

test('four addons load and validate', async () => {
  await withRealCatalog(async (c) => {
    assert.deepEqual(validateCatalog(c), []);
    assert.deepEqual([...c.addons.keys()].sort(), [...ADDON_IDS].sort());
    for (const id of ADDON_IDS) {
      const a = c.addons.get(id);
      assert.equal(a.id, id);
      assert.ok(a.name);
      assert.equal(a.rules.id, `addon-${id}`);
      assert.ok(a.rules.title);
      const n = a.rules.essentials.split('\n').filter((l) => /^- /.test(l)).length;
      assert.ok(n >= 5 && n <= 15, `${id} essentials ${n}`);
      assert.ok(Buffer.byteLength(a.rules.body) < 24000, `${id} bytes`);
      assert.ok(a.rules.body.split('\n').length < 500, `${id} lines`);
      assert.deepEqual(Object.keys(a.detect).sort(), ['contains', 'excludeContains', 'files', 'packageDeps']);
    }
    assert.deepEqual(c.addons.get('kafka').languages, []);
    assert.deepEqual(c.addons.get('rabbitmq').languages, []);
    assert.deepEqual(c.addons.get('camel').languages, ['java']);
    assert.deepEqual(c.addons.get('observability').languages, []);
    assert.deepEqual(c.addons.get('observability').detect, { files: [], contains: [], excludeContains: [], packageDeps: [] });
    const manifests = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'package.json', 'go.mod'];
    assert.deepEqual(c.addons.get('kafka').detect.files, manifests);
    assert.deepEqual(c.addons.get('rabbitmq').detect.files, manifests);
    assert.deepEqual(c.addons.get('camel').detect.files, ['pom.xml', 'build.gradle', 'build.gradle.kts']);
    assert.deepEqual(c.addons.get('kafka').detect.packageDeps, ['kafkajs']);
    assert.deepEqual(c.addons.get('rabbitmq').detect.packageDeps, ['amqplib']);
    assert.ok(!c.addons.get('kafka').detect.contains.includes('kafkajs'), 'npm names are packageDeps, not contains');
  });
});

test('camel is not applicable to a non-java stack', async () => {
  await withRealCatalog(async (c) => {
    const nest = { ...c.stacks.get('spring-boot'), id: 'nest', name: 'NestJS', language: 'typescript' };
    const cat = { ...c, stacks: new Map([...c.stacks, ['nest', nest]]) };
    const p = createProfile({ stack: 'nest', addons: ['camel'], tools: ['claude'], mode: 'greenfield' }, cat);
    const errs = validateProfile(p, cat);
    assert.ok(errs.some((e) => e.startsWith('addons[0]') && e.includes('camel') && e.includes('typescript')), errs.join('\n'));
    const ok = createProfile({ stack: 'nest', addons: ['kafka', 'observability'], tools: ['claude'], mode: 'greenfield' }, cat);
    assert.deepEqual(validateProfile(ok, cat), []);
  });
});

test('observability rules mention Loki, Grafana and low-cardinality labels', async () => {
  await withRealCatalog(async (c) => {
    const body = c.addons.get('observability').rules.body;
    for (const needle of [
      'Loki', 'Grafana', 'low-cardinality', '`service`', '`env`', '`level`', 'traceId', 'never as a label', 'Promtail', 'Alloy',
      'RED', 'provider', 'Tempo', 'Prometheus', 'consumer lag', 'DLQ', 'p95', 'p99', 'default',
      'logging.structured.format.console', 'logstash-logback-encoder', 'MDC', 'stdout',
      'Deep redaction', 'Operability gates',
    ]) {
      assert.ok(body.includes(needle), `missing ${needle}`);
    }
  });
});

test('kafka, rabbitmq and camel rules carry the verified API facts', async () => {
  await withRealCatalog(async (c) => {
    const kafka = c.addons.get('kafka').rules.body;
    for (const needle of ['enable.idempotence', 'acks=all', 'DeadLetterPublishingRecoverer', 'DefaultErrorHandler', 'Outbox', 'traceparent', 'stackcrew-spring-kafka-consumer']) {
      assert.ok(kafka.includes(needle), `kafka missing ${needle}`);
    }
    const rabbit = c.addons.get('rabbitmq').rules.body;
    for (const needle of ['DLX', 'prefetch', 'publisher confirms', 'Outbox', 'traceparent']) {
      assert.ok(rabbit.toLowerCase().includes(needle.toLowerCase()), `rabbitmq missing ${needle}`);
    }
    const camel = c.addons.get('camel').rules.body;
    for (const needle of ['JVM', 'RouteBuilder', 'errorHandler(deadLetterChannel(', 'maximumRedeliveries', 'useOriginalMessage', 'idempotentConsumer', 'throttle(', 'JsonLibrary.Jackson', 'CamelSpringBootTest', 'camel-test-spring-junit5', 'MockEndpoints']) {
      assert.ok(camel.includes(needle), `camel missing ${needle}`);
    }
  });
});

test('addons are detected from build files and package.json', async () => {
  await withRealCatalog(async (c) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sc-addons-'));
    try {
      await writeFile(
        path.join(dir, 'pom.xml'),
        '<project><parent><groupId>org.springframework.boot</groupId></parent><dependencies>' +
          '<artifactId>spring-kafka</artifactId><artifactId>spring-boot-starter-amqp</artifactId><artifactId>camel-spring-boot-starter</artifactId></dependencies></project>',
      );
      const r = await detectProject(dir, c);
      assert.equal(r.stack, 'spring-boot');
      assert.deepEqual([...r.addons].sort(), ['camel', 'kafka', 'rabbitmq']);
      assert.ok(!r.addons.includes('observability'), 'observability is opt-in');
      // npm names are matched through packageDeps. A fake npm stack stands in for NestJS (not in the catalog yet).
      const nest = { ...c.stacks.get('spring-boot'), id: 'nest', language: 'typescript', detect: { files: [], contains: [], excludeContains: [], packageDeps: ['@nestjs/core'] } };
      const cat = { ...c, stacks: new Map([['nest', nest]]) };
      await rm(path.join(dir, 'pom.xml'));
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0', kafkajs: '^2.0.0', amqplib: '^0.10.0' } }));
      const js = await detectProject(dir, cat);
      assert.equal(js.stack, 'nest');
      assert.deepEqual([...js.addons].sort(), ['kafka', 'rabbitmq']);
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }));
      assert.deepEqual((await detectProject(dir, cat)).addons, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('kafka skill only rendered with kafka addon', async () => {
  await withRealCatalog(async (c) => {
    const skill = c.stacks.get('spring-boot').skills.find((k) => k.name === KAFKA_SKILL);
    assert.ok(skill, 'skill exists');
    assert.equal(skill.kind, 'task');
    assert.deepEqual(skill.paths, ['**/*.java']);
    assert.deepEqual(skill.requiresAddons, ['kafka']);
    assert.ok(skill.description.startsWith('Use when'));
    assert.ok(skill.description.includes('Spring Boot'));
    assert.ok(skill.description.length <= 500);

    const without = buildContext(c, profileFor(c, []), OPTS);
    assert.ok(!without.skills.some((k) => k.name === KAFKA_SKILL));
    assert.ok(!renderProject(without).ops.some((o) => o.path.includes(KAFKA_SKILL)));
    const withKafka = buildContext(c, profileFor(c, ['kafka']), OPTS);
    assert.ok(withKafka.skills.some((k) => k.name === KAFKA_SKILL));
    assert.ok(renderProject(withKafka).ops.some((o) => o.path.includes(KAFKA_SKILL)));
  });
});

test('kafka consumer skill carries the consumer playbook', async () => {
  await withRealCatalog(async (c) => {
    const body = c.stacks.get('spring-boot').skills.find((k) => k.name === KAFKA_SKILL).body;
    for (const needle of [
      'processed_event', 'ON CONFLICT', 'useAffectedRows=true', 'AckMode.RECORD', 'DefaultErrorHandler', 'DeadLetterPublishingRecoverer',
      'addNotRetryableExceptions', 'ExponentialBackOffWithMaxRetries', 'setCommonErrorHandler', 'observation-enabled', 'MdcKeys', 'MDC.put',
      'EmbeddedKafka', 'Testcontainers', 'Outbox', 'record OrderPaid', 'KafkaTopics', 'stackcrew-allow: SC-TYPE',
    ]) {
      assert.ok(body.includes(needle), `missing ${needle}`);
    }
    const FENCE = '```';
    const code = body.split(FENCE + 'java').slice(1).map((part) => part.split(FENCE)[0]).join(String.fromCharCode(10));
    assert.ok(code.length > 1000, 'java examples present');
    for (const untyped of ['JsonNode', 'ObjectNode', 'Map<String, Object>', 'Map<?, ?>']) {
      assert.ok(!code.includes(untyped), `java examples must not use ${untyped}`);
    }
  });
});

test('spring-boot with all addons and all four tools stays inside the AGENTS.md budget', async (t) => {
  await withRealCatalog(async (c) => {
    const ctx = buildContext(c, profileFor(c, ADDON_IDS), OPTS);
    const { ops } = renderProject(ctx); // throws StackcrewError BUDGET when over a budget
    const agents = renderAgentsMdBlock(ctx);
    const size = Buffer.byteLength(agents.content);
    assert.ok(size <= 16000, `AGENTS block ${size}`);
    t.diagnostic(`AGENTS block with all four addons: ${size} bytes`);
    for (const id of ADDON_IDS) assert.ok(agents.content.includes(c.addons.get(id).rules.title), `${id} essentials in AGENTS block`);
    for (const o of ops.filter((x) => x.path.startsWith('.cursor/rules/stackcrew/'))) assert.ok(o.content.split('\n').length <= 500, o.path);
    for (const o of ops.filter((x) => x.path.startsWith('.agents/rules/stackcrew-'))) assert.ok(Buffer.byteLength(o.content) <= 24000, o.path);
  });
});

test('addon.json files are LF and parse', async () => {
  for (const id of ADDON_IDS) {
    const text = await readFile(path.join(ROOT, 'catalog', 'addons', id, 'addon.json'), 'utf8');
    assert.ok(!text.includes('\r'), `${id} LF`);
    assert.doesNotThrow(() => JSON.parse(text));
  }
});
