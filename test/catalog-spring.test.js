import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { validateCatalog } from '../src/catalog/validate.js';
import { detectProject } from '../src/detect.js';
import { compileGuardRules, scanLines } from '../src/guard/scan.js';
import { createProfile } from '../src/profile.js';
import { buildContext } from '../src/render/context.js';
import { renderProject } from '../src/render/index.js';
import { renderShared } from '../src/render/shared.js';
import { renderAgentsMdBlock } from '../src/render/agents-md.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL = ['claude', 'cursor', 'codex', 'antigravity'];
const SKILLS = ['stackcrew-spring-integration-provider', 'stackcrew-spring-rest-endpoint', 'stackcrew-spring-boot-testing'];

async function withRealCatalog(fn) {
  const saved = process.env.STACKCREW_CATALOG_DIR;
  delete process.env.STACKCREW_CATALOG_DIR;
  try {
    return await fn(await loadCatalog());
  } finally {
    if (saved !== undefined) process.env.STACKCREW_CATALOG_DIR = saved;
  }
}

async function withDir(files, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sc-spring-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const profileFor = (catalog, extra = {}) =>
  createProfile({ stack: 'spring-boot', tools: ALL, mode: 'greenfield', basePackage: 'com.acme.kyc', ...extra }, catalog);

test('spring-boot stack loads with 4 skills (kafka one gated by its add-on) and validates', async () => {
  await withRealCatalog(async (c) => {
    assert.deepEqual(validateCatalog(c), []);
    const s = c.stacks.get('spring-boot');
    assert.equal(s.name, 'Spring Boot');
    assert.equal(s.language, 'java');
    assert.equal(s.category, 'backend');
    assert.equal(s.minVersion, '3.0');
    assert.equal(s.priority, 10);
    assert.deepEqual(s.aliases, ['spring', 'springboot']);
    assert.deepEqual(s.globs, ['**/*.java']);
    assert.deepEqual(s.skills.map((k) => k.name).sort(), [...SKILLS, 'stackcrew-spring-kafka-consumer'].sort());
    const byName = Object.fromEntries(s.skills.map((k) => [k.name, k]));
    assert.equal(byName['stackcrew-spring-boot-testing'].kind, 'testing');
    assert.equal(byName['stackcrew-spring-integration-provider'].kind, 'task');
    for (const k of s.skills) {
      assert.deepEqual(k.paths, []);
      assert.ok(k.description.includes('Spring Boot'));
    }
    assert.ok(c.languages.has('java'));
  });
});

test('integration-provider skill carries the provider playbook', async () => {
  await withRealCatalog(async (c) => {
    const body = c.stacks.get('spring-boot').skills.find((k) => k.name === 'stackcrew-spring-integration-provider').body;
    for (const needle of ['ProviderPort', 'Adapter', 'Map<String, ProviderPort>', 'Template Method', '@CircuitBreaker', '@Retry', '@TimeLimiter', 'WireMock', 'dempoten', 'traceId', 'Camel variant', 'ProviderRejectedException', 'ResourceAccessException', 'CircuitBreakerRegistry', 'ignoreExceptions', 'enableRandomizedWait', 'BulkheadRegistry', 'ON CONFLICT', 'by bean name', 'configs:', 'baseConfig: default', '@Valid Endpoint', 'serialVersionUID', 'OUTCOME_ERROR', 'fallbackExecution', '@Async', 'ON DUPLICATE KEY UPDATE id = id', 'useAffectedRows=true']) {
      assert.ok(body.includes(needle), `missing ${needle}`);
    }
    assert.ok(!body.includes('public final VerifyResult verify'), 'template method must not be final (CGLIB)');
    assert.ok(!body.includes('public final String code'), 'code() must not be final');
    assert.ok(!body.includes('BigDecimal.ZERO'), 'missing score is a protocol error');
    assert.ok(body.includes('public ProviderClientFactory('), 'public factory constructor');
    assert.ok(!body.includes('@Qualifier("'), 'no literal qualifier');
    assert.ok(!body.includes('"providerCode"'), 'no literal property key');
  });
});

test('javax ban is scoped to Jakarta EE packages', async () => {
  await withRealCatalog(async (c) => {
    const s = c.stacks.get('spring-boot');
    for (const text of [c.languages.get('java').rule.body, s.rules.body]) {
      assert.ok(text.includes('javax.persistence|validation|servlet|annotation|transaction|inject|ws.rs'));
      assert.ok(text.includes('javax.crypto') && text.includes('javax.sql') && text.includes('javax.net.ssl'));
      assert.ok(!text.includes('(never `javax.*`)'));
    }
    assert.ok(!s.rules.body.includes('Map<String, ProviderPort> keyed'), 'registry keyed by bean name is not claimed');
  });
});

test('detects spring-boot and not quarkus', async () => {
  await withRealCatalog(async (c) => {
    const pom = (extra) => `<project><parent><groupId>org.springframework.boot</groupId>${extra}</parent></project>`;
    await withDir({ 'pom.xml': pom('') }, async (dir) => {
      const r = await detectProject(dir, c);
      assert.equal(r.stack, 'spring-boot');
    });
    await withDir({ 'build.gradle.kts': 'plugins { id("org.springframework.boot") version "3.3.0" }' }, async (dir) => {
      assert.equal((await detectProject(dir, c)).stack, 'spring-boot');
    });
    await withDir({ 'pom.xml': pom('<x>io.quarkus</x>') }, async (dir) => {
      assert.ok(!(await detectProject(dir, c)).candidates.includes('spring-boot'));
    });
  });
});

test('java guard blocks JsonNode, Map<String, Object>, Map<?, ?>, hardcoded URL; allows static final URL', async () => {
  await withRealCatalog(async (c) => {
    const guard = c.languages.get('java').guard;
    const compiled = compileGuardRules(guard);
    assert.deepEqual([...new Set(guard.map((r) => r.id))].sort(), ['SC-CONST', 'SC-TYPE']);
    for (const r of guard) {
      assert.deepEqual(r.globs, ['**/*.java']);
      assert.deepEqual(r.excludeGlobs, ['**/src/test/**']);
      assert.ok(r.message.includes('stackcrew-allow: ' + r.id), `${r.id} message names the waiver`);
    }
    const scan = (file, text) => scanLines(file, [{ line: 1, text }], compiled).map((v) => v.ruleId);
    const MAIN = 'src/main/java/com/acme/Foo.java';
    assert.deepEqual(scan(MAIN, '    JsonNode root = mapper.readTree(body);'), ['SC-TYPE']);
    assert.deepEqual(scan(MAIN, '    ObjectNode n = mapper.createObjectNode();'), ['SC-TYPE']);
    assert.deepEqual(scan(MAIN, '    Map<String, Object> payload = new HashMap<>();'), ['SC-TYPE']);
    assert.deepEqual(scan(MAIN, '    Map< String ,Object > payload;'), ['SC-TYPE']);
    assert.deepEqual(scan(MAIN, '    Map<?, ?> raw;'), ['SC-TYPE']);
    assert.deepEqual(scan(MAIN, '    String url = "https://api.hyperverge.co/v1/verify";'), ['SC-CONST']);
    assert.deepEqual(scan(MAIN, '    String url = "http://localhost:8080";'), ['SC-CONST']);
    assert.deepEqual(scan(MAIN, '    private static final String BASE_URL = "https://api.hyperverge.co";'), []);
    assert.deepEqual(scan(MAIN, '    Map<String, KycResult> byCode = Map.of();'), []);
    assert.deepEqual(scan(MAIN, '    JsonNodeFactory f; // no word-boundary hit'), []);
    assert.deepEqual(scan(MAIN, '    Map<String, Object> m; // stackcrew-allow: SC-TYPE dynamic webhook payload mapped right away'), []);
    // Edge cases: not code, or an allowed shape.
    assert.deepEqual(scan(MAIN, 'import com.fasterxml.jackson.databind.JsonNode;'), []);
    assert.deepEqual(scan(MAIN, '   * Parsed from {@link JsonNode} by the mapper.'), []);
    assert.deepEqual(scan(MAIN, '    // returns Map<String, Object> today'), []);
    assert.deepEqual(scan(MAIN, '     * See <a href="https://docs.example.com/api">the docs</a>'), []);
    assert.deepEqual(scan(MAIN, '    /* https://docs.example.com */'), []);
    assert.deepEqual(scan(MAIN, '            "https://xml.example.com/ns/v1";'), []);
    assert.deepEqual(scan(MAIN, '            "https://xml.example.com/ns/v1")'), []);
    // Flagged shapes.
    assert.deepEqual(scan(MAIN, '    private Map<String, Object> attributes;'), ['SC-TYPE']);
    assert.deepEqual(scan(MAIN, '        return client.get().uri("https://api.example.com/v1/x").retrieve();'), ['SC-CONST']);
    assert.deepEqual(scan('src/test/java/com/acme/FooTest.java', '    JsonNode root = null;'), []);
    assert.deepEqual(scan('module/src/test/java/com/acme/FooTest.java', '    String u = "https://x.test";'), []);
    assert.deepEqual(scan('src/main/resources/x.json', '    JsonNode'), []);
  });
});

test('guard.json keeps its regex escapes byte-exact', async () => {
  const text = await readFile(path.join(ROOT, 'catalog', 'languages', 'java', 'guard.json'), 'utf8');
  const regexes = JSON.parse(text).rules.map((r) => r.regex);
  const BS = String.fromCharCode(92);
  const SKIP = `^(?!${BS}s*(import${BS}s|${BS}*|//|/${BS}*)).*`;
  assert.ok(regexes.includes(`${SKIP}${BS}b(JsonNode|ObjectNode)${BS}b`));
  assert.ok(regexes.includes(`${SKIP}Map<${BS}s*String${BS}s*,${BS}s*Object${BS}s*>`));
  assert.ok(regexes.includes(`${SKIP}Map<${BS}s*${BS}?${BS}s*,${BS}s*${BS}?${BS}s*>`));
  // Ruling R20 regex (supersedes the plan's verbatim one).
  assert.ok(
    regexes.includes(`^(?!${BS}s*(${BS}*|//|/${BS}*))(?!.*${BS}bstatic${BS}s+final${BS}b)(?!${BS}s*"[^"]*"${BS}s*[;,)]*${BS}s*$).*"https?://`),
  );
  assert.ok(!text.includes(String.fromCharCode(8)), 'no raw backspace byte');
});

test('without add-ons only the three base spring skills are rendered', async () => {
  await withRealCatalog(async (c) => {
    const ctx = buildContext(c, profileFor(c), { cli: 'npx stackcrew', version: '0.0.0' });
    assert.deepEqual(ctx.skills.filter((k) => k.name.startsWith('stackcrew-spring-')).map((k) => k.name).sort(), [...SKILLS].sort());
  });
});

test('wire template fills basePackage and keeps the ArchUnit rules', async () => {
  await withRealCatalog(async (c) => {
    const profile = profileFor(c);
    profile.java.wired = true;
    const ctx = buildContext(c, profile, { cli: 'npx stackcrew', version: '0.0.0' });
    const op = renderShared(ctx).find((o) => o.path === 'src/test/java/com/acme/kyc/stackcrew/StackcrewArchitectureTest.java');
    assert.ok(op, 'wire file rendered');
    assert.ok(op.content.includes('package com.acme.kyc.stackcrew;'));
    assert.ok(op.content.includes('@AnalyzeClasses(packages = "com.acme.kyc"'));
    assert.ok(!op.content.includes('{{sc:'));
    for (const needle of ['freeze(', 'freeze.store.default.allowStoreCreation', 'domain_does_not_depend_on_infrastructure', '"..infrastructure..", "..adapter.."']) {
      assert.ok(op.content.includes(needle), `missing ${needle}`);
    }
    for (const needle of ['com.fasterxml.jackson.databind.JsonNode', 'com.fasterxml.jackson.databind.node.ObjectNode', 'JavaParameterizedType', 'getActualTypeArguments', 'org.springframework.beans.factory.annotation.Autowired']) {
      assert.ok(op.content.includes(needle), `missing ${needle}`);
    }
    assert.equal(op.content.split('{').length, op.content.split('}').length, 'braces balance');
  });
});

// Surefire 3.5.3 (SUREFIRE-1643) drops results of tests whose JUnit TestSource is neither a MethodSource nor a
// ClassSource. ArchUnit gives @ArchTest fields its own FieldSource, so field rules ran but were never reported:
// "Tests run: 0" and a green build even with violations. @ArchTest methods carry a MethodSource and are reported.
const FIELD_RULE = /@ArchTest\s+(?:public\s+)?static\s+final\s+ArchRule\b/;
const RULE_METHODS = ['no_untyped_payloads_in_service_and_domain', 'no_field_injection',
  'controllers_do_not_depend_on_repositories', 'domain_does_not_depend_on_infrastructure'];

test('wire template declares every rule as an @ArchTest method, plus a non-empty import check', async () => {
  assert.match('@ArchTest\n    static final ArchRule x = y;', FIELD_RULE, 'FIELD_RULE regex lost its escapes');
  await withRealCatalog(async (c) => {
    const profile = profileFor(c);
    profile.java.wired = true;
    const ctx = buildContext(c, profile, { cli: 'npx stackcrew', version: '0.0.0' });
    const { content } = renderShared(ctx).find((o) => o.path === 'src/test/java/com/acme/kyc/stackcrew/StackcrewArchitectureTest.java');
    assert.doesNotMatch(content, FIELD_RULE);
    assert.ok(content.includes('import com.tngtech.archunit.core.domain.JavaClasses;'));
    for (const name of RULE_METHODS) {
      assert.match(content, new RegExp(`@ArchTest\\n {4}static void ${name}\\(JavaClasses classes\\) \\{\\n {8}freeze\\(`), name);
    }
    assert.equal(content.split('.check(classes);').length - 1, RULE_METHODS.length);
    assert.match(content, /@ArchTest\n {4}static void base_package_contains_classes\(JavaClasses classes\) \{\n {8}if \(classes\.isEmpty\(\)\) \{/);
    assert.ok(content.includes('"StackcrewArchitectureTest imported no classes from com.acme.kyc'));
    assert.ok(content.includes('java.basePackage in stackcrew.json'));
    assert.equal(content.match(/^ {4}@ArchTest$/gm).length, RULE_METHODS.length + 1);
    assert.ok(c.stacks.get('spring-boot').testing.body.includes('`@ArchTest static void rule_name(JavaClasses classes)'),
      'testing guidance tells agents to write project rules as methods');
  });
});

test('lint config carries the required modules', async () => {
  await withRealCatalog(async (c) => {
    const f = c.stacks.get('spring-boot').lintFiles.find((x) => x.relPath === 'checkstyle.xml');
    assert.ok(f, 'checkstyle.xml');
    for (const needle of ['MagicNumber', 'IllegalType', 'JsonNode', 'ObjectNode', 'MethodLength', 'value="60"', 'AvoidStarImport', 'illegalClassNames', 'SuppressWithNearbyCommentFilter', 'stackcrew-allow: SC-TYPE [^ ]', 'stackcrew-allow: SC-CONST [^ ]', 'influenceFormat', 'value="-1, 0, 1"']) {
      assert.ok(f.content.includes(needle), `missing ${needle}`);
    }
    assert.ok(!f.content.includes(String.fromCharCode(92)), 'no backslash in checkstyle.xml');
  });
});

test('spring-boot with all four tools renders within every budget', async () => {
  await withRealCatalog(async (c) => {
    const ctx = buildContext(c, profileFor(c), { cli: 'npx stackcrew', version: '0.0.0' });
    const { ops } = renderProject(ctx); // throws StackcrewError BUDGET when over
    const agents = renderAgentsMdBlock(ctx).op;
    assert.ok(Buffer.byteLength(agents.content) <= 16000, `AGENTS block ${Buffer.byteLength(agents.content)}`);
    for (const o of ops.filter((x) => x.path.startsWith('.cursor/rules/stackcrew/'))) {
      assert.ok(o.content.split('\n').length <= 500, `${o.path} lines`);
    }
    for (const o of ops.filter((x) => x.path.startsWith('.agents/rules/stackcrew-'))) {
      assert.ok(Buffer.byteLength(o.content) <= 24000, `${o.path} bytes`);
    }
    assert.ok(ops.some((o) => o.path.includes('stackcrew-spring-integration-provider')));
  });
});

test('rule files have id, title and a bounded Essentials list', async () => {
  await withRealCatalog(async (c) => {
    const s = c.stacks.get('spring-boot');
    const rules = [c.languages.get('java').rule, s.rules, s.testing];
    assert.deepEqual(rules.map((r) => r.id), ['lang-java', 'stack-spring-boot', 'stack-spring-boot-testing']);
    for (const r of rules) {
      assert.ok(r.title);
      const n = r.essentials.split('\n').filter((l) => /^- /.test(l)).length;
      assert.ok(n >= 5 && n <= 15, `${r.id} essentials ${n}`);
      assert.ok(Buffer.byteLength(r.body) < 24000);
    }
  });
});
