import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { createProfile } from '../src/profile.js';
import { planSkillDirs } from '../src/render/writeset.js';
import { buildContext, loadCustomRules } from '../src/render/context.js';

const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'catalog-mini');
const OPTS = { cli: 'npx stackcrew', version: '9.9.9' };

const rows = [
  [['claude'], ['.claude/skills'], [], false],
  [['cursor'], ['.agents/skills'], ['.agents/skills'], false],
  [['codex'], ['.agents/skills'], ['.agents/skills'], false],
  [['antigravity'], ['.agents/skills'], ['.agents/skills'], false],
  [['claude', 'cursor'], ['.claude/skills'], ['.cursor/skills'], false],
  [['claude', 'codex'], ['.claude/skills', '.agents/skills'], ['.agents/skills'], false],
  [['claude', 'antigravity'], ['.claude/skills', '.agents/skills'], ['.agents/skills'], false],
  [['claude', 'cursor', 'antigravity'], ['.claude/skills', '.agent/skills'], ['.agent/skills', '.cursor/skills'], false],
  [['claude', 'cursor', 'codex'], ['.claude/skills', '.agents/skills'], ['.agents/skills'], true],
  [['claude', 'cursor', 'codex', 'antigravity'], ['.claude/skills', '.agents/skills'], ['.agents/skills'], true],
  [['cursor', 'codex'], ['.agents/skills'], ['.agents/skills'], false],
  [['cursor', 'antigravity'], ['.agents/skills'], ['.agents/skills'], false],
];

test('planSkillDirs table', () => {
  for (const [tools, task, cmd, warn] of rows) {
    const p = planSkillDirs(tools);
    const label = tools.join('+');
    assert.deepEqual(p.taskDirs.map((d) => d.dir), task, `taskDirs ${label}`);
    assert.deepEqual(p.commandDirs.map((d) => d.dir), cmd, `commandDirs ${label}`);
    assert.equal(p.warnings.length > 0, warn, `warning ${label}`);
    if (warn) assert.match(p.warnings[0], /^cursor-duplicate-skills/);
    for (const d of p.taskDirs) assert.equal(d.format, d.dir === '.claude/skills' ? 'claude' : 'generic');
    assert.ok(p.commandDirs.every((d) => d.format === 'generic'));
  }
});

async function ctxFor(over = {}, opts = OPTS) {
  const catalog = await loadCatalog(MINI);
  const profile = {
    ...createProfile({ stack: 'demo-java', addons: ['demo-addon'], mode: 'greenfield', basePackage: 'com.acme' }, catalog),
    ...over,
  };
  return { catalog, profile, ctx: buildContext(catalog, profile, opts) };
}

test('buildContext orders and filters rules', async () => {
  const { ctx } = await ctxFor({ addons: [] });
  assert.deepEqual(ctx.rules.map((r) => r.id), ['core-backend-api', 'core-testing', 'lang-java', 'stack-demo-java', 'stack-demo-java-testing']);
  assert.equal(ctx.language.id, 'java');
});

test('addon rules follow in profile order', async () => {
  const { ctx } = await ctxFor();
  assert.equal(ctx.rules.length, 6);
  assert.deepEqual(ctx.addons.map((a) => a.id), ['demo-addon']);
});

test('skills requiring a missing addon are excluded', async () => {
  const without = (await ctxFor({ addons: [] })).ctx;
  assert.ok(!without.skills.some((s) => s.name === 'stackcrew-demo-kafka'));
  const withAddon = (await ctxFor()).ctx;
  assert.ok(withAddon.skills.some((s) => s.name === 'stackcrew-demo-kafka'));
  assert.ok(withAddon.skills.some((s) => s.name === 'stackcrew-demo-advisor'));
  assert.deepEqual(withAddon.commandSkills.map((s) => s.name), ['stackcrew-init']);
});

test('roles get names, models and skill lists', async () => {
  const { ctx } = await ctxFor();
  assert.deepEqual(ctx.roles.map((r) => r.name).sort(), ['stackcrew-demo-java-developer', 'stackcrew-demo-java-tester', 'stackcrew-tech-lead']);
  const dev = ctx.roles.find((r) => r.name.endsWith('developer'));
  assert.ok(dev.skills.includes('stackcrew-demo-task'));
  assert.ok(!dev.skills.includes('stackcrew-demo-testing'));
  assert.ok(ctx.roles.every((r) => typeof r.model === 'string' && r.model));
});

test('templates are filled; no {{sc: left anywhere; catalog not mutated', async () => {
  const { ctx } = await ctxFor();
  const out = JSON.stringify({ r: ctx.rules, s: ctx.skills, c: ctx.commandSkills, ro: ctx.roles, a: ctx.alwaysOn });
  assert.ok(!out.includes('{{sc:'));
  assert.deepEqual(ctx.vars, { stackId: 'demo-java', stackName: ctx.stack.name, cli: 'npx stackcrew', version: '9.9.9', basePackage: 'com.acme' });
});

test('custom alwaysOn rule appends to alwaysOn; others join rules', async () => {
  const catalog = await loadCatalog(MINI);
  const profile = createProfile({ stack: 'demo-java', mode: 'greenfield' }, catalog);
  const base = buildContext(catalog, profile, OPTS);
  const custom = [
    { id: 'custom-a', title: 'A', categories: [], languages: [], essentials: '', body: 'ALWAYS-A\n', source: '.stackcrew/custom/a.md', alwaysOn: true },
    { id: 'custom-b', title: 'B', categories: [], languages: [], essentials: '', body: 'B\n', source: '.stackcrew/custom/b.md' },
  ];
  const ctx = buildContext(catalog, profile, { ...OPTS, customRules: custom });
  assert.ok(ctx.alwaysOn.startsWith(base.alwaysOn));
  assert.ok(ctx.alwaysOn.includes('ALWAYS-A'));
  assert.equal(ctx.rules.at(-1).id, 'custom-b');
  assert.ok(!ctx.rules.some((r) => r.id === 'custom-a'));
});

test('buildContext throws RENDER for unknown stack', async () => {
  const catalog = await loadCatalog(MINI);
  assert.throws(() => buildContext(catalog, { stack: 'nope', addons: [], tools: ['claude'] }, OPTS), { code: 'RENDER' });
});

test('loadCustomRules reads, sorts and validates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sc-custom-'));
  try {
    assert.deepEqual(await loadCustomRules(dir), []);
    const cdir = path.join(dir, '.stackcrew', 'custom');
    await mkdir(cdir, { recursive: true });
    await writeFile(path.join(cdir, 'b.md'), '\uFEFF---\r\ntitle: Bee\r\nglobs: ["src/**"]\r\nalwaysOn: true\r\n---\r\n## Essentials\r\n- x\r\n\r\nmore\r\n');
    await writeFile(path.join(cdir, 'a.md'), '---\ntitle: Ay\n---\nbody only\n');
    await writeFile(path.join(cdir, 'skip.txt'), 'nope');
    const rules = await loadCustomRules(dir);
    assert.deepEqual(rules.map((r) => r.id), ['custom-a', 'custom-b']);
    assert.equal(rules[0].essentials, '');
    assert.equal(rules[0].alwaysOn, false);
    assert.equal('globs' in rules[0], false);
    assert.deepEqual(rules[1].globs, ['src/**']);
    assert.equal(rules[1].alwaysOn, true);
    assert.equal(rules[1].source, '.stackcrew/custom/b.md');
    assert.equal(rules[1].essentials, '- x' + String.fromCharCode(10, 10) + 'more');
    assert.ok(!rules[1].body.includes('\r'));
    await writeFile(path.join(cdir, 'c.md'), '---\nfoo: bar\n---\nx\n');
    await assert.rejects(loadCustomRules(dir), (e) => e.code === 'PROFILE' && e.message === '.stackcrew/custom/c.md: title is required');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('alwaysOn pieces are separated by a blank line', async () => {
  const catalog = await loadCatalog(MINI);
  const profile = createProfile({ stack: 'demo-java', mode: 'greenfield' }, catalog);
  const mk = (id, body) => ({ id, title: id, categories: [], languages: [], essentials: '', body, source: `.stackcrew/custom/${id}.md`, alwaysOn: true });
  const one = buildContext(catalog, profile, { ...OPTS, customRules: [mk('custom-a', '# A')] });
  assert.equal(one.alwaysOn, catalog.alwaysOn.trimEnd() + '\n\n# A\n');
  const two = buildContext(catalog, profile, { ...OPTS, customRules: [mk('custom-a', '# A\n\n\n'), mk('custom-b', '- B')] });
  assert.equal(two.alwaysOn, catalog.alwaysOn.trimEnd() + '\n\n# A\n\n- B\n');
  const none = buildContext(catalog, profile, OPTS);
  assert.equal(none.alwaysOn, catalog.alwaysOn.trimEnd() + '\n');
});

test('custom rule essentials use the shared extractor', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sc-ess-'));
  try {
    const cdir = path.join(dir, '.stackcrew', 'custom');
    await mkdir(cdir, { recursive: true });
    await writeFile(path.join(cdir, 'last.md'), '---\ntitle: L\n---\nintro\n## Essentials');
    await writeFile(path.join(cdir, 'mid.md'), '---\ntitle: M\n---\n## Essentials\n- one\n- two\n## Other\n- no\n');
    const rules = await loadCustomRules(dir);
    assert.equal(rules.find((r) => r.id === 'custom-last').essentials, '');
    assert.equal(rules.find((r) => r.id === 'custom-mid').essentials, '- one\n- two');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
