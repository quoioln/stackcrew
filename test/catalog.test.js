import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { cp, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { validateCatalog, lintSkillDescription } from '../src/catalog/validate.js';

const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'catalog-mini');
const demo = (c) => c.stacks.get('demo-java');
const task = (c) => demo(c).skills.find((s) => s.name === 'stackcrew-demo-task');

test('loads mini catalog', async () => {
  const c = await loadCatalog(MINI);
  assert.equal(demo(c).skills.length, 3);
  assert.equal(c.coreRules.length, 2);
  assert.match(demo(c).rules.essentials, /\S/);
  assert.equal(c.roles.length, 3);
  assert.deepEqual(demo(c).wireFiles.map((f) => f.relPath), ['StackcrewArchitectureTest.java']);
  assert.deepEqual(demo(c).lintFiles.map((f) => f.relPath), ['demo.xml']);
  assert.deepEqual(c.sharedSkills.find((s) => s.name === 'stackcrew-demo-advisor').files.map((f) => f.relPath), ['patterns/x.md']);
  assert.equal(c.languages.get('java').guard[0].id, 'SC-TYPE');
  assert.equal(demo(c).guard.length, 0);
  assert.equal(c.alwaysOn, '# Always\nSC-TYPE\n');
  assert.equal(c.pluginCommands[0].name, 'sync');
  assert.equal(c.coreRules[0].source, 'core/rules/backend-api.md');
  assert.deepEqual(c.coreRules[0].categories, ['backend']);
  assert.deepEqual(c.addons.get('demo-addon').languages, ['java']);
});

test('mini catalog validates clean', async () => {
  const c = await loadCatalog(MINI);
  assert.deepEqual(validateCatalog(c), []);
});

test('missing dirs load as empty; validate reports missing always-on', async () => {
  const c = await loadCatalog(path.join(MINI, 'does-not-exist'));
  assert.equal(c.alwaysOn, '');
  assert.equal(c.stacks.size, 0);
  const errs = validateCatalog(c);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /^core\/always-on\.md: /);
});

test('malformed json throws CATALOG naming the file', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'sc-cat-'));
  try {
    await cp(MINI, tmp, { recursive: true });
    await writeFile(path.join(tmp, 'languages', 'java', 'guard.json'), '{ nope');
    await assert.rejects(loadCatalog(tmp), (e) => e.code === 'CATALOG' && /languages\/java\/guard\.json/.test(e.message));
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('strips BOM and CRLF when loading', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'sc-cat-'));
  try {
    await cp(MINI, tmp, { recursive: true });
    const f = path.join(tmp, 'core', 'rules', 'testing.md');
    const text = await readFile(f, 'utf8');
    await writeFile(f, '﻿' + text.replace(/\n/g, '\r\n'));
    const c = await loadCatalog(tmp);
    const r = c.coreRules.find((x) => x.id === 'core-testing');
    assert.equal(r.title, 'Testing');
    assert.ok(!r.body.includes('\r'));
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('rejects description not starting with Use when', async () => {
  const c = await loadCatalog(MINI);
  task(c).description = 'Adds endpoints in the Demo Java service.';
  assert.ok(validateCatalog(c).some((e) => e.includes('stackcrew-demo-task') && /Use when/.test(e)));
});

test('rejects banned description word', async () => {
  const c = await loadCatalog(MINI);
  task(c).description = 'Use when writing any code in Demo Java.';
  assert.ok(validateCatalog(c).some((e) => e.includes('any code')));
});

test('rejects task skill description missing stack name', async () => {
  const c = await loadCatalog(MINI);
  task(c).description = 'Use when adding a demo endpoint.';
  assert.ok(validateCatalog(c).some((e) => e.includes('Demo Java')));
});

test('rejects banned orchestration phrase in body', async () => {
  const c = await loadCatalog(MINI);
  task(c).body = 'Do it, then invoke the next phase.';
  assert.ok(validateCatalog(c).some((e) => /orchestration/.test(e) && e.includes('next phase')));
});

test('rejects rule without Essentials', async () => {
  const c = await loadCatalog(MINI);
  c.coreRules[0].body = '# No essentials here';
  assert.ok(validateCatalog(c).some((e) => e.startsWith('core/rules/backend-api.md: ') && /Essentials/.test(e)));
});

test('rejects more than 15 essentials bullets', async () => {
  const c = await loadCatalog(MINI);
  c.coreRules[0].essentials = Array.from({ length: 16 }, (_, i) => `- b${i}`).join('\n');
  assert.ok(validateCatalog(c).some((e) => /15/.test(e)));
});

test('rejects invalid guard regex', async () => {
  const c = await loadCatalog(MINI);
  c.languages.get('java').guard[0].regex = '(';
  assert.ok(validateCatalog(c).some((e) => e.includes('SC-TYPE') && /regex/.test(e)));
});

test('command skills and plugin commands allow only cli/version placeholders', async () => {
  const c = await loadCatalog(MINI);
  c.sharedSkills.find((s) => s.name === 'stackcrew-init').body = '{{sc:cli}} {{sc:version}} {{sc:stackName}}';
  c.pluginCommands[0].body = '{{sc:basePackage}}';
  const errs = validateCatalog(c);
  assert.ok(errs.some((e) => e.includes('stackcrew-init') && e.includes('stackName')));
  assert.ok(errs.some((e) => e.startsWith('plugin-commands/sync.md: ') && e.includes('basePackage')));
  assert.ok(!errs.some((e) => e.includes('placeholder {{sc:cli}}') || e.includes('placeholder {{sc:version}}')));
});

test('rejects bad ids, names, kinds, enums and unknown languages', async () => {
  const c = await loadCatalog(MINI);
  c.coreRules[0].id = 'core-wrong';
  task(c).name = 'other';
  demo(c).skills[1].kind = 'advisor';
  demo(c).category = 'mobile';
  c.addons.get('demo-addon').languages = ['cobol'];
  c.roles[0].model = 'gpt';
  const errs = validateCatalog(c);
  for (const re of [/core-wrong/, /name.*folder|folder.*name/, /kind/, /category/, /cobol/, /model/]) {
    assert.ok(errs.some((e) => re.test(e)), String(re));
  }
});

test('lintSkillDescription checks command prefix and length', () => {
  const base = { name: 'stackcrew-x', kind: 'command', source: 'skills/stackcrew-x/SKILL.md' };
  assert.deepEqual(lintSkillDescription({ ...base, description: 'Use only when asked.' }), []);
  assert.ok(lintSkillDescription({ ...base, description: 'Use when asked.' }).length > 0);
  assert.ok(lintSkillDescription({ ...base, description: 'Use only when ' + 'x'.repeat(500) }).some((e) => /500/.test(e)));
});
