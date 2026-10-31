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
const SKILLS = ['stackcrew-spring-integration-provider', 'stackcrew-spring-rest-endpoint', 'stackcrew-spring-boot-testing',
  'stackcrew-spring-jpa-entity', 'stackcrew-spring-request-logging'];
const NEW_SKILLS = ['stackcrew-spring-jpa-entity', 'stackcrew-spring-request-logging'];
const WAIVER = '// stackcrew-allow: SC-TYPE log masking walks arbitrary JSON before it is written';
const WIRE_PATH = 'src/test/java/com/acme/kyc/stackcrew/StackcrewArchitectureTest.java';

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

test('spring-boot stack loads with 6 skills (kafka one gated by its add-on) and validates', async () => {
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

test('without add-ons only the five base spring skills are rendered', async () => {
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
  'controllers_do_not_depend_on_repositories', 'domain_does_not_depend_on_infrastructure', 'entities_extend_the_base_entity'];

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

const renderedSkills = (c, conventions) => {
  const profile = profileFor(c);
  if (conventions) profile.conventions = conventions;
  return buildContext(c, profile, { cli: 'npx stackcrew', version: '0.0.0' }).skills;
};

const codeBlockLines = (md) => {
  const out = [];
  let inCode = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    else if (inCode) out.push(line);
  }
  return out;
};

test('spring request logging no longer forbids bodies and uses the shared masker', async () => {
  await withRealCatalog(async (c) => {
    const s = c.stacks.get('spring-boot');
    const rules = s.rules.body;
    assert.ok(!/never the body/i.test(rules), 'old no-body rule is gone');
    assert.ok(!/full bodies/i.test(rules), 'no "full bodies" ban left in the stack rule');
    for (const needle of ['BodyMasker', 'MaskingProperties', 'HttpLoggingFilter', 'LoggingClientInterceptor', 'app.logging.mask-fields',
      'app.logging.max-body-bytes', 'app.logging.log-bodies', 'BufferingClientHttpRequestFactory', 'stackcrew-spring-request-logging']) {
      assert.ok(rules.includes(needle), `rules.md missing ${needle}`);
    }
    const provider = s.skills.find((k) => k.name === 'stackcrew-spring-integration-provider').body;
    const s10 = provider.split('## 10.')[1].split('\n## ')[0];
    assert.ok(!/full bodies/i.test(s10), 'provider section 10 no longer bans bodies');
    for (const needle of ['LoggingClientInterceptor', 'traceId', 'MDC.get(MdcKeys.TRACE_ID)', 'size']) assert.ok(s10.includes(needle), `section 10 missing ${needle}`);
    assert.ok(provider.includes('new BufferingClientHttpRequestFactory('), 'provider client is buffered so the interceptor can read the body');
    assert.ok(provider.includes('public ProviderClientFactory('));
  });
});

test('spring data rules cover the entity base, auditing and tenant isolation', async () => {
  await withRealCatalog(async (c) => {
    const rules = c.stacks.get('spring-boot').rules.body;
    for (const needle of ['@MappedSuperclass', '@EnableJpaAuditing', 'JwtAuditorAware', '@TenantId', 'JwtTenantIdentifierResolver',
      'TenantContext.runCrossTenant', 'isRoot', 'native', 'stackcrew-spring-jpa-entity', '{{sc:baseEntity}}', '{{sc:baseTenantEntity}}']) {
      assert.ok(rules.includes(needle), `rules.md missing ${needle}`);
    }
    const profile = profileFor(c);
    profile.conventions = { baseEntity: 'AuditedEntity', baseTenantEntity: 'AuditedTenantEntity' };
    const rule = buildContext(c, profile, { cli: 'npx stackcrew', version: '0.0.0' }).rules.find((r) => r.id === 'stack-spring-boot');
    assert.ok(rule.body.includes('AuditedEntity') && rule.body.includes('AuditedTenantEntity'));
    assert.ok(!rule.body.includes('{{sc:'));
  });
});

test('wire template has SC-ENTITY with the configured base entity', async () => {
  await withRealCatalog(async (c) => {
    const render = (conventions) => {
      const profile = profileFor(c);
      profile.java.wired = true;
      if (conventions) profile.conventions = conventions;
      const ctx = buildContext(c, profile, { cli: 'npx stackcrew', version: '0.0.0' });
      return renderShared(ctx).find((o) => o.path === WIRE_PATH).content;
    };
    const custom = render({ baseEntity: 'AuditedEntity' });
    for (const needle of ['SC-ENTITY', 'entities_extend_the_base_entity', '"jakarta.persistence.Entity"', 'getAllRawSuperclasses', '"AuditedEntity"']) {
      assert.ok(custom.includes(needle), `missing ${needle}`);
    }
    assert.ok(!custom.includes('"BaseEntity"'));
    assert.ok(render().includes('"BaseEntity"'), 'default base entity');
    assert.ok(!custom.includes('{{sc:'));
  });
});

test('JsonNode lines in the request-logging skill carry an SC-TYPE waiver', async () => {
  await withRealCatalog(async (c) => {
    const compiled = compileGuardRules(c.languages.get('java').guard);
    const MAIN = 'src/main/java/com/acme/kyc/common/logging/Example.java';
    let jsonNodeLines = 0;
    for (const skill of renderedSkills(c).filter((k) => NEW_SKILLS.includes(k.name))) {
      const sources = [{ name: 'SKILL.md', lines: codeBlockLines(skill.body) }];
      for (const f of skill.files) sources.push({ name: f.relPath, lines: f.relPath.endsWith('.md') ? codeBlockLines(f.content) : f.content.split('\n') });
      for (const { name, lines } of sources) {
        const numbered = lines.map((text, i) => ({ line: i + 1, text }));
        const violations = scanLines(MAIN, numbered, compiled);
        assert.deepEqual(violations.map((v) => `${skill.name}/${name}:${v.line} ${v.ruleId} ${v.text.trim()}`), [], `${skill.name}/${name}`);
        for (const { text } of numbered.filter((l) => /\b(JsonNode|ObjectNode)\b/.test(l.text))) {
          jsonNodeLines += 1;
          assert.ok(text.includes(WAIVER), `${skill.name}/${name}: missing waiver on: ${text.trim()}`);
        }
      }
    }
    assert.ok(jsonNodeLines > 0, 'the masker walks a JsonNode tree');
  });
});

test('new spring skills are task skills under 350 lines with sibling code that is not a test file', async () => {
  await withRealCatalog(async (c) => {
    const skills = Object.fromEntries(c.stacks.get('spring-boot').skills.map((k) => [k.name, k]));
    for (const name of NEW_SKILLS) {
      const k = skills[name];
      assert.ok(k, name);
      assert.equal(k.kind, 'task');
      assert.ok(k.description.startsWith('Use when') && k.description.includes('Spring Boot'));
      assert.ok(k.body.split('\n').length <= 350, `${name} SKILL.md is ${k.body.split('\n').length} lines`);
      for (const f of k.files) {
        assert.ok(!/test/i.test(f.relPath), `${name}/${f.relPath}: sibling files are not named like tests`);
        assert.ok(/^[A-Za-z]+\.java\.md$/.test(f.relPath), `${name}/${f.relPath}: Java siblings ship as <File>.java.md`);
        assert.match(f.content, /^Goes to `src\/main\/java`, package `\{\{sc:basePackage\}\}\.common\.(logging|context|persistence)`, as `[^`]+\.java`\.\n\n```java\n/,
          `${name}/${f.relPath}: a "Goes to" line, then the code`);
        assert.equal(f.content.split('```').length, 3, `${name}/${f.relPath}: exactly one fenced block`);
        assert.ok(f.content.endsWith('```\n'), `${name}/${f.relPath}: nothing after the block`);
      }
    }
    const entity = skills['stackcrew-spring-jpa-entity'];
    const entityText = [entity.body, ...entity.files.map((f) => f.content)].join('\n');
    for (const needle of ['@MappedSuperclass', '@EntityListeners(AuditingEntityListener.class)', '@CreatedBy', '@LastModifiedBy', '@TenantId',
      'CurrentTenantIdentifierResolver<String>', 'isRoot', 'HibernatePropertiesCustomizer', 'MULTI_TENANT_IDENTIFIER_RESOLVER', 'Flyway', 'Liquibase',
      'timestamptz', 'runCrossTenant', 'PROPAGATION_REQUIRES_NEW', 'MissingTenantException', 'CrossTenantDeniedException', 'x-tenant-id', 'x-user-id',
      '{{sc:baseEntity}}', '{{sc:baseTenantEntity}}', '{{sc:tenantClaim}}', '{{sc:rolesClaim}}', '{{sc:systemUser}}', '{{sc:crossTenantRoles}}',
      'app.tenancy.cross-tenant-roles', 'stackcrew-spring-boot-testing']) {
      assert.ok(entityText.includes(needle), `jpa-entity missing ${needle}`);
    }
    const logging = skills['stackcrew-spring-request-logging'];
    const loggingText = [logging.body, ...logging.files.map((f) => f.content)].join('\n');
    for (const needle of ['MaskingProperties', 'BodyMasker', 'HttpLoggingFilter', 'LoggingClientInterceptor', 'ContentCachingRequestWrapper',
      'ContentCachingResponseWrapper', 'copyBodyToResponse()', 'finally', 'BufferingClientHttpRequestFactory', 'ClientHttpRequestInterceptor',
      '@ConfigurationProperties("app.logging")', 'app.logging.mask-fields', 'app.logging.max-body-bytes', 'app.logging.log-bodies', 'http_in', 'http_out',
      'message_in', 'durationMs', 'reqBody', 'resBody', '<base64 ', '...[truncated ', '<binary ', 'addFilterAfter', '%kvp']) {
      assert.ok(loggingText.includes(needle), `request-logging missing ${needle}`);
    }
    for (const k of [entity, logging]) assert.ok(!/always|proactively/i.test(k.description));
  });
});

test('spring testing guidance has the audit, tenant isolation and cross-tenant tests on Testcontainers Postgres', async () => {
  await withRealCatalog(async (c) => {
    const t = c.stacks.get('spring-boot').testing.body;
    for (const needle of ['PostgreSQLContainer', '@ServiceConnection', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt', '{{sc:systemUser}}',
      'tenant A', 'findById', 'runCrossTenant', 'CrossTenantDeniedException', 'app.tenancy.cross-tenant-roles', 'NOT_SUPPORTED', 'SC-ENTITY']) {
      assert.ok(t.includes(needle), `testing.md missing ${needle}`);
    }
  });
});

/** The code of a sibling `<rel>.md`: its one fenced block. */
const codeOfSibling = (md) => /```[a-z]*\n([\s\S]*?)```\n$/.exec(md ?? '')?.[1] ?? '';

const skillText = (c, name) => {
  const k = c.stacks.get('spring-boot').skills.find((s) => s.name === name);
  return { body: k.body, file: (rel) => codeOfSibling(k.files.find((f) => f.relPath === `${rel}.md`)?.content) };
};

test('request logging logs every request, clears MDC on every exit and never holds a response back', async () => {
  await withRealCatalog(async (c) => {
    const s = skillText(c, 'stackcrew-spring-request-logging');
    assert.ok(s.body.includes('.addFilterBefore(httpLogging, CorsFilter.class)'), 'filter runs before CORS and authentication');
    assert.ok(s.body.includes('.addFilterAfter(new HttpLoggingFilter.UserMdc(), BearerTokenAuthenticationFilter.class)'), 'user MDC after authentication');
    assert.ok(!s.body.includes('.addFilterAfter(httpLogging,') && !s.body.includes('.addFilterBefore(httpLogging, BearerTokenAuthenticationFilter.class)'));
    const filter = s.file('HttpLoggingFilter.java');
    assert.ok(!filter.includes('TenantContext'), 'the filter needs no JPA beans');
    assert.ok(filter.includes('JwtAuthenticationToken') && filter.includes('"{{sc:tenantClaim}}"'));
    assert.ok(filter.includes('putOrRemove(LogFields.USER_ID') && filter.includes('putOrRemove(LogFields.TENANT_ID'), 'absent user removes the key');
    assert.ok(!filter.includes('TEXT_EVENT_STREAM'), 'SSE requests are no longer skipped');
    assert.ok(!filter.includes('copyBodyToResponse') && !filter.includes('ContentCachingResponseWrapper'), 'the response is written through, never copied later');
    // MDC cleanup sits in an outer finally, after the inner finally that writes the line
    const line = filter.indexOf('writeLine(request, response, failure);');
    const cleanup = filter.indexOf('MDC.remove(LogFields.USER_ID);');
    assert.ok(line > 0 && cleanup > line, 'cleanup after the line');
    assert.match(filter.slice(line, cleanup), /\}\n\s+\}\n\s+\} finally \{/, 'cleanup in its own outer finally');
    const userMdc = filter.split('class UserMdc')[1];
    assert.match(userMdc, /try \{\n\s+chain\.doFilter\(request, response\);\n\s+\} finally \{\n\s+MDC\.remove\(LogFields\.USER_ID\);\n\s+MDC\.remove\(LogFields\.TENANT_ID\);/, 'UserMdc clears in finally');
    assert.equal(s.file('StreamAwareResponseWrapper.java'), '', 'the caching wrapper is gone');
    const tee = s.file('TeeResponseWrapper.java');
    for (const needle of ['extends HttpServletResponseWrapper', 'BodyMasker.isMaskable(getContentType())', 'request.isAsyncStarted()',
      'private long bytesWritten', '(long) captured.size() + length > captureLimit', 'delegate.write(bytes, offset, length);']) {
      assert.ok(tee.includes(needle), `tee wrapper missing ${needle}`);
    }
    assert.ok(!/setContentLength|flushBuffer|copyBodyToResponse/.test(tee), 'headers and flushes are never intercepted');
    const masker = s.file('BodyMasker.java');
    assert.ok(masker.includes('public static boolean isMaskable(String contentType)'));
    const interceptor = s.file('LoggingClientInterceptor.java');
    assert.match(interceptor, /try \{\n\s+responseBody = response\.getBody\(\)\.readAllBytes\(\);\n\s+\} catch \(IOException \| RuntimeException e\) \{/, 'a broken response body still logs');
    assert.ok(s.body.includes('cutsOnACharacterBoundary') && s.body.includes('\\u00e9'), 'multibyte truncation is pinned');
  });
});

test('only the system job entry grants the system identity, and roles come from the yml', async () => {
  await withRealCatalog(async (c) => {
    const s = skillText(c, 'stackcrew-spring-jpa-entity');
    const ctx = s.file('TenantContext.java');
    assert.ok(ctx.includes('public static <T> T runAsSystem(String tenantId, Supplier<T> work)'));
    assert.ok(ctx.includes('new Scope(tenantId, SYSTEM_USER, false, true)'), 'runAsSystem marks the scope');
    assert.ok(ctx.includes('withScope(new Scope(tenantId, userId, false, false), work)'), 'runAs never marks it');
    assert.ok(ctx.includes('boolean systemWork = scope != null && scope.systemJob();'), 'the check reads only the marker');
    assert.ok(!ctx.includes('SYSTEM_USER.equals('), 'no user-id string comparison grants anything');
    assert.ok(ctx.includes('reason.replaceAll("[\\\\r\\\\n]", " ")'), 'CR/LF stripped from the reason');
    assert.ok(ctx.includes('tenantId.isPresent() ? line.addKeyValue("tenantId"'), 'tenantId omitted when absent');
    assert.ok(s.body.includes('TenantContext.runAsSystem(tenantId, ...)') && !s.body.includes('runAs(tenantId, TenantContext.SYSTEM_USER'));
    const props = s.file('TenancyProperties.java');
    assert.ok(props.includes('crossTenantRoles == null ? List.of()') && props.includes('{{sc:crossTenantRoles}}'), 'no code default; yml is the source');
    assert.ok(s.body.includes('cross-tenant-roles: "{{sc:crossTenantRolesCsv}}"'), 'the yml renders the convention roles');
    assert.ok(!s.body.includes('- super_admin') && !s.body.includes('[super_admin]'), 'no role hardcoded in the skill');
    const yml = (conventions) => renderedSkills(c, conventions).find((k) => k.name === 'stackcrew-spring-jpa-entity').body;
    assert.ok(yml().includes('cross-tenant-roles: "super_admin"'), 'default conventions render super_admin');
    assert.ok(yml({ crossTenantRoles: ['ops', 'report_admin'] }).includes('cross-tenant-roles: "ops,report_admin"'));
    assert.ok(yml({ crossTenantRoles: [] }).includes('cross-tenant-roles: ""'), 'an empty list renders an empty string, which grants no role');
    const t = c.stacks.get('spring-boot').testing.body;
    for (const needle of ['aTokenWhoseSubIsTheSystemUserIsNotTheSystemIdentity', 'runAsWithTheSystemUserIdIsNotTheSystemIdentity',
      'TenantContext.runAsSystem(null, () -> transactions.execute(']) {
      assert.ok(t.includes(needle), `testing.md missing ${needle}`);
    }
    const noTenant = t.split('void withoutATenantReadsNothingAndInsertsNothing()')[1].split('@Test')[0];
    assert.ok(noTenant.includes('findOrDenied(rowOfTenantA)).isEmpty()'), 'load by id without a tenant is pinned');
    const core = c.coreRules.find((r) => r.id === 'core-persistence').body;
    assert.ok(core.includes('only for work started through the system job entry'), 'core rule scopes the system identity');
    assert.ok(c.stacks.get('spring-boot').rules.body.includes('`TenantContext.runAsSystem`'));
  });
});

test('kafka consumer restores sanitized context headers, survives tombstones, never becomes system, and producers send the headers', async () => {
  await withRealCatalog(async (c) => {
    const k = skillText(c, 'stackcrew-spring-kafka-consumer').body;
    for (const needle of ['TenantContext.runAs(context.tenantId(), context.userId()', 'LogFields.REQUEST_ID_HEADER', 'LogFields.TENANT_ID_HEADER',
      'LogFields.USER_ID_HEADER', 'LogFields.MESSAGE_IN', 'masker.mask(record.value()', 'MDC.remove(LogFields.REQUEST_ID)',
      'MDC.remove(LogFields.TENANT_ID)', 'MDC.remove(LogFields.USER_ID)', 'record MessageContext', 'addHeader(record, LogFields.TENANT_ID_HEADER',
      'LogFields.safeRequestIdOrNew(value(headers, LogFields.REQUEST_ID_HEADER))', 'LogFields.safeIdOrNull(value(headers, LogFields.TENANT_ID_HEADER))',
      'LogFields.safeIdOrNull(value(headers, LogFields.USER_ID_HEADER))', 'masker.logBodies() && record.value() != null']) {
      assert.ok(k.includes(needle), `kafka skill missing ${needle}`);
    }
    assert.ok(!k.includes('runAsSystem(') || /Only a scheduled job started with `TenantContext.runAsSystem`/.test(k), 'consumers never use the system entry');
    assert.ok(!/never the payload/i.test(k) && !k.includes('Do not log the payload,'), 'payload ban replaced by the masked line');
    const kafkaRules = c.addons.get('kafka').rules.body;
    assert.ok(!/never log the payload/i.test(kafkaRules) && kafkaRules.includes('message_in'));
    const logging = skillText(c, 'stackcrew-spring-request-logging');
    const s6 = logging.body.split('## 6.')[1].split('\n## ')[0];
    for (const needle of ['TenantContext.runAs(tenantId, userId', 'LogFields.safeRequestIdOrNew(requestIdHeader)', 'LogFields.safeIdOrNull(tenantIdHeader)',
      'LogFields.safeIdOrNull(userIdHeader)', 'masker.logBodies() && payload != null', 'MDC.remove(LogFields.REQUEST_ID)', 'finally']) {
      assert.ok(s6.includes(needle), `request-logging section 6 missing ${needle}`);
    }
    const fields = logging.file('LogFields.java');
    assert.ok(fields.includes('Pattern.compile("[A-Za-z0-9._-]{1,64}")') && fields.includes('Pattern.compile("\\\\p{Graph}{1,128}")'));
  });
});

test('spring logging never throws: depth-capped masker and guarded line writers', async () => {
  await withRealCatalog(async (c) => {
    const s = skillText(c, 'stackcrew-spring-request-logging');
    const masker = s.file('BodyMasker.java');
    assert.ok(masker.includes('MAX_NESTING_DEPTH = 64') && masker.includes('NestingTooDeep'), 'nesting is capped at 64');
    assert.match(masker, /if \(depth > MAX_NESTING_DEPTH\) \{\n\s+throw new NestingTooDeep\(\);/, 'the walk stops past the cap');
    assert.match(masker, /catch \(NestingTooDeep \| StackOverflowError tooDeep\)/, 'a too-deep body becomes a placeholder');
    const filter = s.file('HttpLoggingFilter.java');
    assert.ok(filter.includes('} catch (RuntimeException logFailure) {') && filter.includes('minimalLine('), 'the filter still writes one line when logging fails');
    const interceptor = s.file('LoggingClientInterceptor.java');
    assert.ok(interceptor.includes('} catch (RuntimeException logFailure) {'), 'logging never changes the outbound result');
    for (const [name, code, event] of [['HttpLoggingFilter', filter, 'HTTP_IN'], ['LoggingClientInterceptor', interceptor, 'HTTP_OUT']]) {
      assert.ok(code.includes('} catch (RuntimeException minimalFailure) {') && code.includes(`LogFields.warnLineNotWritten(LogFields.${event}, logFailure, minimalFailure);`),
        `${name}: a failing fallback line never replaces the in-flight exception`);
      assert.ok(!code.includes('.addSuppressed('), `${name}: suppression happens inside the guarded helper`);
    }
    assert.match(filter, /private void writeLine\([^)]*\) \{\n\s+try \{\n\s+putUserContext\(\);/, 'putUserContext is inside the guard');
    const fields = s.file('LogFields.java');
    assert.match(fields,
      /public static void warnLineNotWritten\(String event, RuntimeException failure, RuntimeException fallbackFailure\) \{\n\s+try \{\n\s+if \(fallbackFailure != failure\) \{[^\n]*\n\s+failure\.addSuppressed\(fallbackFailure\);\n\s+\}\n\s+System\.getLogger\(/,
      'the last-resort warning goes to the JDK logger, and a rethrown instance is never self-suppressed');
    assert.ok(fields.includes('} catch (RuntimeException bridgedToTheSameBackend) {'), 'the warning itself never throws (JUL may be bridged to the failing backend)');
    for (const needle of ['nestingOf64IsMaskedNormally', 'nestingOf65BecomesAPlaceholder', 'nestingOf50000BecomesAPlaceholderWithoutThrowing']) {
      assert.ok(s.body.includes(needle), `BodyMaskerTest missing ${needle}`);
    }
  });
});

test('spring provider follows the outbound idempotency decision: stored key before the call, no transaction around it', async () => {
  await withRealCatalog(async (c) => {
    const s = c.stacks.get('spring-boot');
    const rules = s.rules.body;
    const provider = s.skills.find((k) => k.name === 'stackcrew-spring-integration-provider').body;
    const endpoint = s.skills.find((k) => k.name === 'stackcrew-spring-rest-endpoint').body;
    for (const text of [rules, provider, endpoint]) {
      assert.ok(!/call first, then persist/i.test(text), 'no call-first wording left');
      assert.ok(!/derived from the business request id/i.test(text), 'the key is not derived from the request id');
    }
    assert.ok(/store the operation[^\n]*idempotency key[^\n]*commit[^\n]*no transaction open[^\n]*persist/.test(endpoint),
      'the rest-endpoint skill states the stored-operation order: store and commit, call with no transaction open, then persist');
    assert.ok(/stored before the call/.test(rules) && /never the inbound `x-request-id`/.test(rules), 'rules.md states the decision');
    // the domain command carries the stored key and a separate trace reference
    assert.ok(provider.includes('@NotBlank String idempotencyKey, @NotBlank String traceRef)') && !provider.includes('String requestId)'), 'VerifyCommand fields');
    assert.ok(provider.includes('c.idempotencyKey(), c.traceRef())'), 'the mapper puts the key and the trace reference into the provider request');
    assert.ok(!provider.includes('command.requestId()'), 'the template audits the trace reference');
    // §8 order: the stored row first, the call with no transaction open, then the result in another bean
    const s8 = provider.split('## 8.')[1].split('\n## ')[0];
    for (const needle of ['class VerificationOperations', '@Transactional', 'operations.keyOf(', 'operations.record(', 'never the inbound `x-request-id`']) {
      assert.ok(s8.includes(needle), `section 8 missing ${needle}`);
    }
    assert.ok(s8.indexOf('operations.keyOf(') < s8.indexOf('.verify(') && s8.indexOf('.verify(') < s8.indexOf('operations.record('), 'section 8 order');
    assert.ok(/a retried 5xx sends the same `clientReference`/.test(provider), 'WireMock row for the key on retries');
  });
});

test('spring provider follows the provider status classification decision (5xx/429/409/401/403 retried, 400/404/422 refused)', async () => {
  await withRealCatalog(async (c) => {
    const s = c.stacks.get('spring-boot');
    const provider = s.skills.find((k) => k.name === 'stackcrew-spring-integration-provider').body;
    for (const st of ['TOO_MANY_REQUESTS', 'CONFLICT', 'UNAUTHORIZED', 'FORBIDDEN']) {
      assert.ok(provider.includes(`HttpStatus.${st}.value()`), `retryable status ${st}`);
    }
    // a 401 drops the cached token before the retry
    const attempt = provider.split('private VerifyResult attempt(')[1].split('\n    }\n')[0];
    assert.ok(attempt.includes('dropCachedToken();'), 'attempt drops the cached token on a 401');
    assert.ok(attempt.indexOf('dropCachedToken();') < attempt.indexOf('throw isRetryableStatus'), 'token dropped before the retryable exception is thrown');
    assert.ok(provider.includes('protected void dropCachedToken()'), 'token providers override the drop hook');
    // §11 WireMock rows
    const s11 = provider.split('## 11.')[1].split('\n## ')[0];
    assert.ok(s11.includes('400, 404 and 422 give `ProviderRejectedException` with no retry'), '§11 refused statuses');
    assert.ok(s11.includes('5xx, 429, 409, 401 and 403 give `ProviderUnavailableException`'), '§11 retried statuses');
    assert.ok(/401 drops the cached token/.test(s11), '§11 token row');
    assert.ok(!/^- 4xx gives/m.test(s11), 'no blanket 4xx row left');
    for (const old of ['a 4xx or protocol error must neither retry', 'do not retry or trip the breaker on 4xx', '// 4xx: our request was refused']) {
      assert.ok(!provider.includes(old), `blanket 4xx wording left: ${old}`);
    }
    assert.ok(!s.rules.body.includes('5xx/429 to `ProviderUnavailableException`, other 4xx'), 'rules.md error translation names 409/401/403');
    // rules.md and testing docs carry the same classification
    const rules = s.rules.body;
    assert.ok(!rules.includes('4xx and protocol errors neither retry nor trip the breaker'), 'blanket 4xx wording gone from rules.md');
    assert.ok(rules.includes('5xx, 429, 409, 401 and 403 are retried and counted by the breaker; 400, 404 and 422 (a refusal) and protocol errors neither retry nor trip it'), 'rules.md classification');
    const testingSkill = s.skills.find((k) => k.name === 'stackcrew-spring-boot-testing').body;
    for (const text of [s.testing.body, testingSkill]) {
      assert.ok(text.includes('400, 404 or 422') && text.includes('409, 401 or 403'), 'testing docs name the precise classification');
      assert.ok(!/4xx \(one request, no retry\)|with a 4xx that must produce exactly one request/.test(text), 'no blanket 4xx case');
    }
  });
});

test('jpa-entity migration says the hardcoded tenant_id follows tenantColumn', async () => {
  await withRealCatalog(async (c) => {
    const body = c.stacks.get('spring-boot').skills.find((k) => k.name === 'stackcrew-spring-jpa-entity').body;
    const s4 = body.split('## 4.')[1].split('\n## ')[0];
    const note = '`tenant_id` here; rename to the snake_case of your `tenantColumn` if it is not the default';
    assert.ok(s4.split('```sql')[0].includes(note), 'the migration text names the rename');
    assert.ok(/tenant_id\s+varchar\(64\)\s+not null,\s+-- tenant_id here; rename to the snake_case of your tenantColumn if it is not the default/.test(s4), 'the migration comment names the rename');
  });
});

test('request logging: a chunked request that filled the 2 MiB cache logs the unknown-size form', async () => {
  await withRealCatalog(async (c) => {
    const s = skillText(c, 'stackcrew-spring-request-logging');
    const filter = s.file('HttpLoggingFilter.java');
    const requestBody = filter.split('private String requestBody(')[1].split('\n    }\n')[0];
    assert.ok(requestBody.includes('declared < 0 && cached.length >= CAPTURE_LIMIT_BYTES'), 'chunked + full cache is detected');
    assert.ok(requestBody.includes('masker.placeholderAtLeast(request.getContentType(), CAPTURE_LIMIT_BYTES)'), 'logs <CT N+ bytes>');
    const masker = s.file('BodyMasker.java');
    assert.ok(masker.includes('public String placeholderAtLeast(String contentType, long size)') && masker.includes('size + "+"'), 'the masker renders N+');
    assert.ok(s.body.includes('`<CT 2097152+ bytes>`'), 'SKILL.md documents the chunked case');
  });
});
