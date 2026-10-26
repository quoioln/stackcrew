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

test('a stack skill sibling file that matches the stack globs is a catalog error; its .md form is fine', async () => {
  const c = await loadCatalog(MINI);
  task(c).files.push({ relPath: 'BodyMasker.java', content: 'class BodyMasker {}\n' }, { relPath: 'examples/Repo.java', content: 'class Repo {}\n' });
  task(c).files.push({ relPath: 'BodyMasker.java.md', content: 'Goes to `src/main/java/BodyMasker.java`.\n\n```java\nclass BodyMasker {}\n```\n' });
  const errs = validateCatalog(c).filter((e) => e.includes('matches the stack globs'));
  assert.equal(errs.length, 2, errs.join('\n'));
  assert.ok(errs[0].startsWith('stacks/demo-java/skills/stackcrew-demo-task/BodyMasker.java: '), errs[0]);
  assert.ok(errs[0].includes('**/*.java') && errs[0].includes('BodyMasker.java.md'), errs[0]);
  assert.ok(errs[1].includes('examples/Repo.java') && errs[1].includes('examples/Repo.java.md'), errs[1]);
});

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
  const g = c.languages.get('java').guard[0];
  const re = new RegExp(g.regex, g.flags);
  assert.ok(re.test('private JsonNode data;'));
  assert.ok(!re.test('JsonNodes'));
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

test('rejects paths on a catalog skill', async () => {
  const c = await loadCatalog(MINI);
  task(c).paths = ['**/*.java'];
  assert.ok(validateCatalog(c).some((e) => e.includes('stackcrew-demo-task') && /paths/.test(e)));
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

test('add-on languages: missing key is a CATALOG error, [] is valid, unknown language is reported', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'sc-cat-'));
  try {
    await cp(MINI, tmp, { recursive: true });
    const file = path.join(tmp, 'addons', 'demo-addon', 'addon.json');
    const addon = JSON.parse(await readFile(file, 'utf8'));
    const { languages, ...withoutLanguages } = addon;
    assert.deepEqual(languages, ['java']);
    await writeFile(file, JSON.stringify(withoutLanguages));
    await assert.rejects(loadCatalog(tmp), (e) => e.code === 'CATALOG' && e.message.includes('addons/demo-addon/addon.json') && e.message.includes('languages'));
    for (const bad of [null, 'java', {}]) {
      await writeFile(file, JSON.stringify({ ...addon, languages: bad }));
      await assert.rejects(loadCatalog(tmp), (e) => e.code === 'CATALOG' && e.message.includes('languages'), String(bad));
    }
    await writeFile(file, JSON.stringify({ ...addon, languages: [] }));
    assert.deepEqual(validateCatalog(await loadCatalog(tmp)), []);
    await writeFile(file, JSON.stringify({ ...addon, languages: ['cobol'] }));
    assert.ok(validateCatalog(await loadCatalog(tmp)).some((e) => /cobol/.test(e)));
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('lintSkillDescription checks command prefix and length', () => {
  const base = { name: 'stackcrew-x', kind: 'command', source: 'skills/stackcrew-x/SKILL.md' };
  assert.deepEqual(lintSkillDescription({ ...base, description: 'Use only when asked.' }), []);
  assert.ok(lintSkillDescription({ ...base, description: 'Use when asked.' }).length > 0);
  assert.ok(lintSkillDescription({ ...base, description: 'Use only when ' + 'x'.repeat(500) }).some((e) => /500/.test(e)));
});

test('validator rejects an unknown placeholder in stack rules and a convention placeholder in a shared skill', async () => {
  const c = await loadCatalog(MINI);
  demo(c).rules.body += '\n{{sc:baseEntity}} ok, {{sc:nope}} not\n';
  demo(c).lintFiles[0].content += '{{sc:alsoNope}}';
  demo(c).wireFiles[0].content += '{{sc:tenantClaim}}';
  c.roles[0].body += '{{sc:roleNope}}';
  const advisor = c.sharedSkills.find((s) => s.name === 'stackcrew-demo-advisor');
  advisor.body += '{{sc:baseEntity}}';
  task(c).body += '{{sc:stackName}}{{sc:typeFreeFiles}}';
  const errs = validateCatalog(c);
  assert.ok(errs.some((e) => e.startsWith(demo(c).rules.source + ': ') && e.includes('{{sc:nope}}')));
  assert.ok(!errs.some((e) => e.startsWith(demo(c).rules.source + ': ') && e.includes('placeholder {{sc:baseEntity}}')));
  assert.ok(errs.some((e) => e.includes('{{sc:alsoNope}}') && e.includes('lint/demo.xml')));
  assert.ok(!errs.some((e) => e.includes('placeholder {{sc:tenantClaim}}')));
  assert.ok(errs.some((e) => e.includes('{{sc:roleNope}}') && e.startsWith('roles/')));
  assert.ok(errs.some((e) => e.includes(advisor.source) && e.includes('{{sc:baseEntity}}')));
  assert.ok(errs.some((e) => e.includes(task(c).source) && e.includes('{{sc:typeFreeFiles}}')));
  assert.ok(!errs.some((e) => e.includes(task(c).source) && e.includes('placeholder {{sc:stackName}}')));
});
