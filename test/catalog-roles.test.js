import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../src/catalog/load.js';
import { validateCatalog, BANNED_ORCHESTRATION } from '../src/catalog/validate.js';
import { createProfile, validateProfile, TOOLS } from '../src/profile.js';
import { buildContext } from '../src/render/context.js';
import { renderProject } from '../src/render/index.js';

async function withRealCatalog(fn) {
  const saved = process.env.STACKCREW_CATALOG_DIR;
  delete process.env.STACKCREW_CATALOG_DIR;
  try {
    return await fn(await loadCatalog());
  } finally {
    if (saved !== undefined) process.env.STACKCREW_CATALOG_DIR = saved;
  }
}

const initSkill = (c) => c.sharedSkills.find((s) => s.name === 'stackcrew-init');
const refFile = (c, name) => initSkill(c).files.find((f) => f.relPath === `references/${name}`);

test('three roles with models and skill kinds', async () => {
  await withRealCatalog(async (c) => {
    const by = Object.fromEntries(c.roles.map((r) => [r.id, r]));
    assert.deepEqual(Object.keys(by).sort(), ['developer', 'tech-lead', 'tester']);
    assert.equal(by['tech-lead'].model, 'opus');
    assert.deepEqual(by['tech-lead'].skillKinds, ['advisor']);
    assert.equal(by.developer.model, 'sonnet');
    assert.deepEqual(by.developer.skillKinds, ['task', 'advisor']);
    assert.equal(by.tester.model, 'sonnet');
    assert.deepEqual(by.tester.skillKinds, ['testing']);
  });
});

test('role descriptions start with "Use only when" and name the stack placeholder', async () => {
  await withRealCatalog(async (c) => {
    for (const r of c.roles) {
      assert.ok(r.description.startsWith('Use only when the user or a plan explicitly asks for the stackcrew {{sc:stackName}}'), r.id);
    }
  });
});

test('role bodies are concise, have a Decision gate and chain to nothing', async () => {
  await withRealCatalog(async (c) => {
    for (const r of c.roles) {
      const lines = r.body.trim().split('\n').length;
      assert.ok(lines >= 20 && lines <= 60, `${r.id} body has ${lines} lines`);
      assert.ok(r.body.includes('## Decision gate'), r.id);
      assert.ok(r.body.includes('SC-PREFLIGHT'), r.id);
      assert.ok(r.body.includes('stackcrew.json'), r.id);
      assert.ok(r.body.includes('decisions[]'), r.id);
      const lower = r.body.toLowerCase();
      for (const p of BANNED_ORCHESTRATION) assert.ok(!lower.includes(p), `${r.id}: ${p}`);
    }
    const tester = c.roles.find((x) => x.id === 'tester').body;
    for (const k of ['WireMock', 'Testcontainers', 'contract', 'End-to-end']) assert.ok(tester.includes(k), k);
    assert.ok(/not an approval gate/.test(c.roles.find((x) => x.id === 'tech-lead').body));
  });
});

test('init skill is a command skill using {{sc:cli}} and references both files', async () => {
  await withRealCatalog(async (c) => {
    const s = initSkill(c);
    assert.ok(s, 'stackcrew-init exists');
    assert.equal(s.kind, 'command');
    assert.equal(s.description, "Use only when the user explicitly asks to run the stackcrew setup interview or to re-profile this project's architecture decisions.");
    for (const cmd of ['{{sc:cli}} detect', '{{sc:cli}} init --stack', '{{sc:cli}} sync']) assert.ok(s.body.includes(cmd), cmd);
    assert.ok(s.body.includes('references/stack-selection.md'));
    assert.ok(s.body.includes('references/profile-schema.md'));
    assert.deepEqual(s.files.map((f) => f.relPath).sort(), ['references/profile-schema.md', 'references/stack-selection.md']);
    const used = [...s.body.matchAll(/\{\{sc:([^}]*)\}\}/g)].map((m) => m[1]);
    assert.ok(used.every((n) => ['cli', 'version'].includes(n)), used.join(','));
  });
});

test('init skill covers every spec 6.1 interview topic and the flow rules', async () => {
  await withRealCatalog(async (c) => {
    const body = initSkill(c).body.toLowerCase();
    const topics = ['domain', 'integrations', 'scale', 'timeline', 'stability', 'extensibility', 'team skills', 'stack', 'ai tools'];
    for (const t of topics) assert.ok(body.includes(t), `topic ${t}`);
    for (const t of ['one question per message', 'architecture style', 'messaging', 'observability', 'test strategy', 'idempotency', 'wiremock', '--wire', 're-profile', 'wait for approval', 'never start another workflow']) {
      assert.ok(body.includes(t), t);
    }
  });
});

test('stack selection covers every stack, including Quarkus, with choose/avoid columns', async () => {
  await withRealCatalog(async (c) => {
    const text = refFile(c, 'stack-selection.md').content;
    assert.ok(text.includes('| Stack |') && text.includes('Choose when') && text.includes('Avoid when'));
    for (const s of ['Spring Boot', 'Quarkus', 'NestJS', 'Next.js', 'Go', 'React', 'Angular']) assert.ok(text.includes(`**${s}`), s);
    assert.ok(text.includes('Camel Quarkus'));
  });
});

test('profile-schema example JSON is valid and passes validateProfile', async () => {
  await withRealCatalog(async (c) => {
    const text = refFile(c, 'profile-schema.md').content;
    const m = /```json\n([\s\S]*?)\n```/.exec(text);
    assert.ok(m, 'json example block');
    const profile = JSON.parse(m[1]);
    assert.deepEqual(validateProfile(profile, c), []);
    assert.equal(profile.stack, 'spring-boot');
    assert.deepEqual(profile.addons, ['kafka', 'observability']);
    assert.deepEqual(profile.decisions.map((d) => d.id), ['D-001', 'D-002']);
    assert.ok(profile.decisions.every((d) => d.rejected.length > 0));
    assert.ok(Object.values(profile.context).every((v) => typeof v === 'string'));
  });
});

test('plugin commands sync, check, add', async () => {
  await withRealCatalog(async (c) => {
    const by = Object.fromEntries(c.pluginCommands.map((p) => [p.name, p]));
    assert.deepEqual(Object.keys(by).sort(), ['add', 'check', 'sync']);
    for (const n of ['sync', 'check', 'add']) {
      assert.ok(by[n].description.startsWith(`Use only when the user runs /stackcrew:${n}`), n);
      assert.ok(by[n].body.includes(`{{sc:cli}} ${n} $ARGUMENTS`), n);
    }
    for (const f of ['--force', '--wire', '--dry-run']) assert.ok(by.sync.body.includes(f), f);
    for (const f of ['--base <ref>', '--staged', '0: clean', '1: violations', '2: the check could not run']) assert.ok(by.check.body.includes(f), f);
  });
});

test('real catalog validates clean (full)', async () => {
  await withRealCatalog(async (c) => assert.deepEqual(validateCatalog(c), []));
});

test('real catalog renders for spring-boot without unknown placeholders', async () => {
  await withRealCatalog(async (c) => {
    const profile = createProfile({ stack: 'spring-boot', addons: ['kafka', 'observability'], tools: TOOLS, mode: 'greenfield', basePackage: 'com.acme.app' }, c);
    const ctx = buildContext(c, profile, { cli: 'npx --yes stackcrew@0.0.0-test', version: '0.0.0-test' });
    assert.deepEqual(ctx.roles.map((r) => r.name).sort(), ['stackcrew-spring-boot-developer', 'stackcrew-spring-boot-tester', 'stackcrew-tech-lead']);
    const by = Object.fromEntries(ctx.roles.map((r) => [r.name, r]));
    assert.ok(by['stackcrew-spring-boot-tester'].skills.includes('stackcrew-spring-boot-testing'));
    assert.ok(by['stackcrew-spring-boot-developer'].skills.includes('stackcrew-spring-integration-provider'));
    assert.ok(by['stackcrew-tech-lead'].skills.includes('stackcrew-pattern-guide'));
    assert.ok(by['stackcrew-tech-lead'].description.includes('Spring Boot'));
    const { ops } = renderProject(ctx); // throws BUDGET / TEMPLATE on violation
    assert.ok(ops.length > 0);
    for (const op of ops) assert.ok(!/\{\{sc:/.test(op.content), `unfilled placeholder in ${op.path}`);
    const init = ops.filter((o) => o.path.includes('stackcrew-init/'));
    assert.ok(init.length > 0, 'init skill rendered');
    assert.ok(init.every((o) => !o.content.includes('{{sc:cli}}')));
    assert.ok(init.some((o) => o.content.includes('npx --yes stackcrew@0.0.0-test detect')));
  });
});
