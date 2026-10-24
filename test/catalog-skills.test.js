import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { validateCatalog, BANNED_DESCRIPTION_WORDS } from '../src/catalog/validate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BS = String.fromCharCode(92);
const GUIDE = 'stackcrew-pattern-guide';
const MESSAGING = 'stackcrew-messaging-choice';
const PATTERNS = [
  'template-method', 'factory', 'adapter', 'bridge', 'builder', 'strategy', 'singleton', 'outbox',
  'decorator', 'chain-of-responsibility', 'anti-corruption-layer', 'resilience', 'repository-unit-of-work',
];
const STYLES = ['layered', 'hexagonal', 'modular monolith', 'microservices', 'cqrs', 'event-driven'];
const IDIOM_HEADINGS = [
  '### Java (Spring Boot / Quarkus)',
  '### TypeScript (NestJS / Next.js / React / Angular)',
  '### Go',
];
const SECTION_HEADINGS = ['## Signals', '## Use when', '## Do not use when', '## Idioms', '## Example', '## AI anti-patterns'];

let cached;
async function catalog() {
  cached ??= await loadCatalog();
  return cached;
}
async function shared(name) {
  const skill = (await catalog()).sharedSkills.find((s) => s.name === name);
  assert.ok(skill, `${name} must be loaded as a shared skill`);
  return skill;
}
const fileOf = (skill, rel) => {
  const f = skill.files.find((x) => x.relPath === rel);
  assert.ok(f, `${rel} missing`);
  return f;
};

/** Text of a "## " section, up to the next "## " heading. */
function section(text, heading) {
  const marker = `\n${heading}\n`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `missing ${heading}`);
  const rest = text.slice(start + marker.length);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}
/** Text of a "### " subsection inside an idioms block. */
function subsection(block, heading) {
  const marker = `${heading}\n`;
  const start = block.indexOf(marker);
  assert.notEqual(start, -1, `missing ${heading}`);
  const rest = block.slice(start + marker.length);
  const end = rest.search(/\n### /);
  return end === -1 ? rest : rest.slice(0, end);
}

test('pattern guide has 13 pattern files with exact headings incl. Java/TypeScript/Go idioms', async () => {
  const skill = await shared(GUIDE);
  assert.equal(skill.kind, 'advisor');
  assert.deepEqual(skill.paths, []);
  for (const id of PATTERNS) {
    const f = fileOf(skill, `patterns/${id}.md`);
    let last = -1;
    for (const h of SECTION_HEADINGS) {
      const idx = f.content.indexOf(`\n${h}\n`);
      assert.ok(idx > last, `${id}: heading "${h}" missing or out of order`);
      last = idx;
    }
    const lines = f.content.split('\n').length;
    assert.ok(lines >= 40 && lines <= 160, `${id}: ${lines} lines is outside the focused range`);
  }
  const listed = skill.files.map((f) => f.relPath).filter((p) => p.startsWith('patterns/')).sort();
  assert.deepEqual(listed, PATTERNS.map((p) => `patterns/${p}.md`).sort());
});

test('every pattern file has three non-empty idiom subsections and a named example language', async () => {
  const skill = await shared(GUIDE);
  for (const id of PATTERNS) {
    const f = fileOf(skill, `patterns/${id}.md`);
    const idioms = section(f.content, '## Idioms');
    for (const h of IDIOM_HEADINGS) {
      const body = subsection(idioms, h).trim();
      assert.ok(body.length > 40, `${id}: ${h} is empty or too thin`);
    }
    const example = section(f.content, '## Example');
    assert.match(example, /\b(Java|TypeScript|Go)\b/, `${id}: the example must name its language`);
    assert.equal((example.match(/```/g) ?? []).length, 2, `${id}: exactly one example code block`);
  }
});

test('pattern examples avoid untyped payloads', async () => {
  const skill = await shared(GUIDE);
  for (const id of PATTERNS) {
    const example = section(fileOf(skill, `patterns/${id}.md`).content, '## Example');
    assert.doesNotMatch(example, /Map<String,\s*Object>|interface\{\}|:\s*any\b|<any>|JsonNode/, `${id}: untyped payload in example`);
  }
});

test('SKILL.md links every pattern file, each link resolves, and states the core rules', async () => {
  const skill = await shared(GUIDE);
  const paths = new Set(skill.files.map((f) => f.relPath));
  const links = [...skill.body.matchAll(/\]\((patterns\/[^)\s]+\.md)\)/g)].map((m) => m[1]);
  for (const l of links) assert.ok(paths.has(l), `SKILL.md links ${l} which does not exist`);
  for (const id of PATTERNS) assert.ok(links.includes(`patterns/${id}.md`), `SKILL.md does not link patterns/${id}.md`);
  assert.ok(paths.has('architecture-styles.md'));
  assert.match(skill.body, /\]\(architecture-styles\.md\)/);
  assert.match(skill.body, /SC-PATTERN/);
  assert.match(skill.body, /docs\/stackcrew\/architecture-profile\.md/);
  assert.match(skill.body, /rule of three/i);
  assert.match(skill.body, /language idiom/i);
  assert.match(skill.body, /stackcrew\.json/);
  assert.match(skill.body, /decisions\[\]/);
  assert.match(skill.body, /no pattern without a (present )?signal/i);
  assert.match(skill.body, /do not skip/i);
});

test('architecture styles cover the six styles and the frontend structure', async () => {
  const skill = await shared(GUIDE);
  const text = fileOf(skill, 'architecture-styles.md').content;
  const lower = text.toLowerCase();
  for (const s of STYLES) assert.ok(lower.includes(`\n## ${s}`), `missing style heading: ${s}`);
  for (const h of ['**Signals**', '**Use when**', '**Do not use when**', '**Fit**']) {
    assert.ok(text.split(h).length - 1 >= 6, `${h} must appear for each of the six styles`);
  }
  assert.match(text, /\n## Frontend structure\n/);
  for (const k of ['feature folders', 'container', 'presentational', 'TanStack Query', 'NgRx', 'signal store']) {
    assert.ok(text.includes(k), `frontend section must mention ${k}`);
  }
  for (const k of ['scale', 'timeline', 'stability', 'extensib']) assert.ok(lower.includes(k), `missing ${k}`);
});

test('Strategy, Factory and Template Method stay consistent with the Spring provider skill', async () => {
  const skill = await shared(GUIDE);
  const strategy = fileOf(skill, 'patterns/strategy.md').content;
  const template = fileOf(skill, 'patterns/template-method.md').content;
  const factory = fileOf(skill, 'patterns/factory.md').content;
  assert.match(strategy, /stackcrew-spring-integration-provider/);
  assert.match(strategy, /List<\w*Port>/);
  assert.match(strategy, /code\(\)/);
  assert.match(strategy, /bean name/i);
  assert.match(template, /stackcrew-spring-integration-provider/);
  assert.match(template, /AbstractProviderAdapter/);
  assert.match(template, /second provider/i);
  assert.match(factory, /List<\w*Port>/);
  assert.match(factory, /bean name/i);
});

test('Builder follows the record / Lombok rule and never touches entities', async () => {
  const b = fileOf(await shared(GUIDE), 'patterns/builder.md').content;
  assert.match(b, /record/);
  assert.match(b, /@Builder/);
  assert.match(b, /many optional/i);
  assert.match(b, /never[^.\n]*entit/i);
  assert.match(b, /functional options/i);
  assert.match(b, /zod|object literal/i);
});

test('Outbox and messaging choice agree on when a dual write needs an outbox', async () => {
  const guide = await shared(GUIDE);
  const outbox = fileOf(guide, 'patterns/outbox.md').content;
  assert.match(outbox, /dual.write/i);
  assert.match(outbox, /stackcrew-messaging-choice/);
  const m = await shared(MESSAGING);
  assert.equal(m.kind, 'advisor');
  assert.deepEqual(m.paths, []);
  assert.match(m.body, /outbox/i);
  assert.match(m.body, /stackcrew-pattern-guide/);
  for (const id of ['addon-kafka', 'addon-rabbitmq', 'addon-camel']) assert.ok(m.body.includes(id), `messaging must link ${id}`);
  for (const k of ['ApplicationEvent', 'EventEmitter2', 'channel', 'RabbitMQ', 'Redis', 'Pub/Sub', 'Kafka', 'replay', 'BullMQ', 'Watermill']) {
    assert.ok(m.body.includes(k), `messaging must mention ${k}`);
  }
  assert.match(m.body, /Camel[^.\n]*JVM/i);
});

test('advisor descriptions pass lint and contain no banned words', async () => {
  const c = await catalog();
  assert.deepEqual(validateCatalog(c), []);
  const want = {
    [GUIDE]: 'Use when deciding whether a concrete code change needs a design pattern (Template Method, Factory, Adapter, Bridge, Builder, Strategy, Singleton, Outbox, …) or when reviewing a pattern choice; gives signals, when not to use it, and idioms per language.',
    [MESSAGING]: 'Use when deciding between in-process events, a lightweight broker (RabbitMQ, Redis, cloud Pub/Sub) and Kafka for a concrete integration or event flow.',
  };
  for (const [name, description] of Object.entries(want)) {
    const s = await shared(name);
    assert.equal(s.description, description);
    assert.equal(s.kind, 'advisor');
    for (const w of BANNED_DESCRIPTION_WORDS) assert.ok(!s.description.toLowerCase().includes(w));
  }
});

test('skill files use LF line endings', async () => {
  const rels = [`${GUIDE}/SKILL.md`, `${GUIDE}/architecture-styles.md`, `${MESSAGING}/SKILL.md`, ...PATTERNS.map((p) => `${GUIDE}/patterns/${p}.md`)];
  for (const rel of rels) {
    const raw = await readFile(path.join(ROOT, 'catalog', 'skills', rel), 'utf8');
    assert.ok(!raw.includes('\r'), `${rel} has CR`);
  }
});

test('negative checks: no baseline-breaking advice in pattern files', async () => {
  const skill = await shared(GUIDE);
  const all = PATTERNS.map((id) => [id, fileOf(skill, `patterns/${id}.md`).content]);
  const byId = Object.fromEntries(all);

  // Template Method: the skeleton is never final (CGLIB proxies run final methods on a field-less proxy instance).
  const tm = byId['template-method'];
  const javaBlock = tm.match(/```java\n([\s\S]*?)```/)[1];
  assert.doesNotMatch(javaBlock, /\bpublic\s+final\s+\w+\s+verify\s*\(/, 'template method skeleton must not be final');
  assert.match(javaBlock, /audit\.success/);
  assert.match(javaBlock, /audit\.failure/);
  assert.match(javaBlock, /VerifyCommand\b/);
  assert.match(javaBlock, /requestId\(\)/);

  // Resilience: the breaker is declared last (outermost), the bulkhead first (innermost).
  const res = byId.resilience.match(/```java\n([\s\S]*?)```/)[1];
  const at = (s) => res.indexOf(s);
  assert.ok(at('.withBulkhead(') !== -1 && at('.withBulkhead(') < at('.withRetry(') && at('.withRetry(') < at('.withCircuitBreaker('), 'breaker must be declared last');
  assert.match(res, /CallNotPermittedException/);
  assert.match(res, /BulkheadFullException/);
  assert.match(res, /ProviderUnavailableException/);
  assert.match(byId.resilience, /gobreaker\/v2/);

  for (const [id, text] of all) {
    // NestJS has no multi providers.
    assert.doesNotMatch(text, /multi:\s*true/, `${id}: NestJS has no multi: true`);
    // Java 17 baseline: a pattern-matching switch needs a Java 21 qualifier.
    for (const m of text.matchAll(/```java\n([\s\S]*?)```/g)) {
      assert.doesNotMatch(m[1], /case\s+[A-Z]\w*\s+[a-z]\w*\s*->/, `${id}: Java example uses a Java 21 pattern switch`);
    }
    for (const line of text.split('\n')) {
      if (/sealed/i.test(line) && /switch/.test(line)) assert.match(line, /Java 21/, `${id}: sealed + switch needs a Java 21 qualifier: ${line}`);
    }
    // NestJS HttpService returns Observables.
    for (const m of text.matchAll(/await\s+this\.http\.post\(/g)) assert.fail(`${id}: await on HttpService without firstValueFrom (${m[0]})`);
    // Debezium or CDC is a relay, never a reason to skip the outbox.
    assert.doesNotMatch(text, /Do not use when[\s\S]*?Debezium[\s\S]*?##\s+Idioms/, `${id}: CDC must not be listed under Do not use when`);
  }
  assert.match(byId.adapter, /firstValueFrom/);
  assert.match(byId['chain-of-responsibility'], /proxy\.ts/);
  assert.match(byId.outbox, /upsertJobScheduler/);
  assert.match(byId.outbox, /Forwarder/);
  assert.match(byId.outbox, /SKIP LOCKED/);
  assert.doesNotMatch(byId.singleton, /sync\.Once\b(?!Value)/, 'use sync.OnceValue');
  assert.match(byId.singleton, /sync\.OnceValue/);
});

test('provider-integration timing matches playbook step 0', async () => {
  const skill = await shared(GUIDE);
  const text = [skill.body, fileOf(skill, 'patterns/strategy.md').content, fileOf(skill, 'patterns/template-method.md').content].join('\n');
  assert.match(text, /second provider/i);
  assert.match(text, /step 0/);
  assert.match(text, /exactly one/i);
});

test('Redis delivery guarantees are not lumped together', async () => {
  const c = await catalog();
  const m = (await shared(MESSAGING)).body;
  assert.match(m, /Redis Pub\/Sub[^\n]*at-most-once/i);
  assert.match(m, /Redis Streams[^\n]*(acks?|consumer-group)/i);
  for (const rel of ['kafka', 'rabbitmq']) {
    const addon = c.addons.get(rel);
    assert.ok(addon, `${rel} add-on loaded`);
    assert.match(addon.rules.body, /Redis Pub\/Sub[^\n]*at-most-once/i, `${rel}: Redis Pub/Sub guarantee`);
    assert.match(addon.rules.body, /Redis Streams/, `${rel}: Redis Streams`);
  }
});

test('backslash escapes survive in example code (Go regex)', async () => {
  const f = fileOf(await shared(GUIDE), 'patterns/singleton.md');
  const backslash = String.fromCharCode(92);
  assert.ok(f.content.includes('`^[A-Z]{3}-' + backslash + 'd{8}$`'), 'singleton Go example lost its backslash escape');
});
