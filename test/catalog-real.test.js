import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { validateCatalog } from '../src/catalog/validate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_IDS = ['type-safety', 'error-handling', 'logging', 'testing', 'performance', 'security', 'backend-api', 'persistence', 'frontend', 'delivery', 'brownfield'].map((n) => `core-${n}`);

async function withRealCatalog(fn) {
  const saved = process.env.STACKCREW_CATALOG_DIR;
  delete process.env.STACKCREW_CATALOG_DIR;
  try { return await fn(); } finally {
    if (saved !== undefined) process.env.STACKCREW_CATALOG_DIR = saved;
  }
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

test('real catalog validates clean', async () => {
  await withRealCatalog(async () => assert.deepEqual(validateCatalog(await loadCatalog()), []));
});

test('always-on has SC headings in order and fits 6000 bytes', async () => {
  const text = await readFile(path.join(ROOT, 'catalog', 'core', 'always-on.md'), 'utf8');
  assert.ok(Buffer.byteLength(text) <= 6000, `always-on is ${Buffer.byteLength(text)} bytes`);
  const heads = text.split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(heads, ['## Project profile', '## SC-PREFLIGHT', '## SC-TYPE', '## SC-CONST', '## SC-REUSE', '## SC-PATTERN', '## Decision gate', '## Exceptions']);
  for (const needle of ['docs/stackcrew/architecture-profile.md', 'stackcrew.json', 'stackcrew-pattern-guide', 'stackcrew-allow: <rule-id> <reason>']) {
    assert.ok(text.includes(needle), `missing ${needle}`);
  }
});

test('always-on content specifics', async () => {
  const text = await readFile(path.join(ROOT, 'catalog', 'core', 'always-on.md'), 'utf8');
  assert.ok(text.includes('JsonNode'));
  assert.ok(/Map<\?, ?\?>/.test(text));
  assert.ok(text.includes('stackcrew-allow: SC-TYPE'));
  const typeSec = text.split('## SC-TYPE')[1].split('\n## ')[0];
  assert.ok(typeSec.includes('first deserialized'), 'exception (a): dynamic payload');
  assert.ok(typeSec.includes('framework-required signature') && typeSec.includes('Jwt.getClaims()') && typeSec.includes('Kafka client config'), 'exception (b): framework signature');
  const pre = text.split('## SC-PREFLIGHT')[1].split('\n## ')[0];
  assert.equal(pre.split('\n').filter((l) => /^\d. /.test(l)).length, 5);
  const ts = await readFile(path.join(ROOT, 'catalog', 'core', 'rules', 'type-safety.md'), 'utf8');
  assert.ok(ts.includes('stackcrew-allow'));
});

test('core rules exist with ids and bounded essentials', async () => {
  await withRealCatalog(async () => {
    const c = await loadCatalog();
    assert.deepEqual(c.coreRules.map((r) => r.id).sort(), [...CORE_IDS].sort());
    for (const r of c.coreRules) {
      assert.ok(r.title, `${r.id} title`);
      const n = r.essentials.split('\n').filter((l) => /^- /.test(l)).length;
      assert.ok(n >= 1 && n <= 15, `${r.id} has ${n} essentials`);
    }
  });
});

test('no SDLC-only concepts leak', async () => {
  for (const f of await walk(path.join(ROOT, 'catalog'))) {
    const text = await readFile(f, 'utf8');
    for (const bad of ['docs/sdlc', 'Phase 8', 'guideline/']) {
      assert.ok(!text.includes(bad), `${f} contains ${bad}`);
    }
  }
});

test('recording a decision asks the user to re-sync (always-on and every role); always-on stays within budget', async () => {
  const files = ['core/always-on.md', 'roles/tech-lead.md', 'roles/developer.md', 'roles/tester.md'];
  for (const f of files) {
    const text = await readFile(path.join(ROOT, 'catalog', f), 'utf8');
    assert.ok(text.includes('ask the user to run sync again so `docs/stackcrew/architecture-profile.md` is updated'), f);
  }
  const alwaysOn = await readFile(path.join(ROOT, 'catalog/core/always-on.md'));
  assert.ok(alwaysOn.length <= 6000, `always-on is ${alwaysOn.length} bytes`);
});

test('stackcrew-init tells the agent where to find the reference skills on the first run', async () => {
  const text = await readFile(path.join(ROOT, 'catalog/skills/stackcrew-init/SKILL.md'), 'utf8');
  assert.ok(text.includes('${CLAUDE_PLUGIN_ROOT}/cli/catalog/skills/'));
  assert.ok(text.includes('re-check after the first sync'));
});

const readCatalogFile = (rel) => readFile(path.join(ROOT, 'catalog', rel), 'utf8');

test('stackcrew-init asks for project conventions and records them in conventions', async () => {
  const { CONVENTION_KEYS } = await import('../src/conventions.js');
  const text = await readCatalogFile('skills/stackcrew-init/SKILL.md');
  assert.match(text, /^10\. \*\*Project conventions\*\*/m);
  for (const needle of ['aliases.ui', 'components.json', 'BaseEntity', 'omit', 'conventions']) {
    assert.ok(text.includes(needle), `init skill is missing "${needle}"`);
  }
  for (const key of CONVENTION_KEYS.filter((k) => k !== 'typeFreeFiles' && k !== 'tenantColumn' && k !== 'systemUser')) {
    assert.ok(text.includes(key), `init skill never names convention key ${key}`);
  }
  // P2-R8: a shared skill may use only the cli and version placeholders (it is read raw, without a stack).
  const placeholders = [...text.matchAll(/\{\{sc:([\w]+)\}\}/g)].map((m) => m[1]);
  assert.deepEqual(placeholders.filter((p) => p !== 'cli' && p !== 'version'), []);
  assert.match(text, /internal shared libraries/i);
  assert.match(text, /--wire/);
  assert.match(text, /package\.json/);
  assert.match(text, /never edit `node`|`node` is never edited/i);
});

test('stackcrew-init summary points to slash commands, not a plugin-cache path', async () => {
  const text = await readCatalogFile('skills/stackcrew-init/SKILL.md');
  assert.doesNotMatch(text, /node .*stackcrew\.js/);
  for (const cmd of ['/stackcrew:sync', '/stackcrew:add <addon>', '/stackcrew:check']) {
    assert.ok(text.includes(cmd), `summary is missing ${cmd}`);
  }
  assert.ok(text.includes('`stackcrew sync|add|check`') && !text.includes('{{sc:cli}} sync|add|check'));
});

test('profile-schema documents every convention key with its default', async () => {
  const { CONVENTION_DEFAULTS, validateConventions } = await import('../src/conventions.js');
  const text = await readCatalogFile('skills/stackcrew-init/references/profile-schema.md');
  for (const [key, def] of Object.entries(CONVENTION_DEFAULTS)) {
    const row = text.split('\n').find((l) => l.startsWith(`| \`${key}\``));
    assert.ok(row, `profile-schema has no table row for ${key}`);
    assert.ok(row.includes(JSON.stringify(def)), `row for ${key} does not show default ${JSON.stringify(def)}`);
  }
  assert.ok(text.includes('node.wired') && text.includes('"node"'));
  const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)[1]);
  assert.ok(example.conventions, 'eKYC example has no conventions');
  assert.deepEqual(validateConventions(example.conventions), []);
  assert.doesNotMatch(text, /\{\{sc:(?!cli\}\}|version\}\})/);
});

test('sync command documents --wire for Java (ArchUnit) and TypeScript (ESLint)', async () => {
  const text = await readCatalogFile('plugin-commands/sync.md');
  assert.ok(text.includes('ArchUnit') && text.includes('ESLint'));
  assert.ok(text.includes('package.json'));
});

test('next feature-page skill: empty state and past-last-page bullets agree', async () => {
  const text = await readCatalogFile('stacks/nextjs/skills/stackcrew-next-feature-page/SKILL.md');
  assert.doesNotMatch(text, /shows the table's own empty row/);
  assert.match(text, /`total === 0`[^\n]*no rows at all/);
});
