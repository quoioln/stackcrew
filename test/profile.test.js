import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { PROFILE_FILE, TOOLS, readProfile, writeProfile, createProfile, validateProfile } from '../src/profile.js';

const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'catalog-mini');

test('createProfile sets java block and defaults', async () => {
  const c = await loadCatalog(MINI);
  const p = createProfile({ stack: 'demo-java', mode: 'greenfield', basePackage: 'com.x' }, c);
  assert.deepEqual(p, {
    version: 1, stack: 'demo-java', addons: [], tools: TOOLS, mode: 'greenfield', guard: true,
    context: {}, decisions: [], java: { basePackage: 'com.x', wired: false },
  });
  assert.equal(createProfile({ stack: 'demo-java', mode: 'brownfield' }, c).java.basePackage, '');
  assert.deepEqual(validateProfile(p, c), []);
});

test('validateProfile rejects addon not applicable to stack language', async () => {
  const c = await loadCatalog(MINI);
  const stacks = new Map(c.stacks);
  stacks.set('ts-app', { ...c.stacks.get('demo-java'), id: 'ts-app', language: 'ts' });
  const cat = { ...c, stacks };
  const p = createProfile({ stack: 'ts-app', addons: ['demo-addon'], mode: 'greenfield' }, cat);
  assert.equal(p.java, undefined);
  const errs = validateProfile(p, cat);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /^addons\[0\]: /);
  assert.deepEqual(validateProfile({ ...p, addons: ['nope'] }, cat).map((e) => e.split(':')[0]), ['addons[0]']);
});

test('validateProfile rejects unknown tool and bad basePackage', async () => {
  const c = await loadCatalog(MINI);
  const p = createProfile({ stack: 'demo-java', mode: 'greenfield' }, c);
  const errs = validateProfile({ ...p, tools: ['claude', 'vim'], java: { basePackage: 'Com.Bad-pkg', wired: false } }, c);
  assert.ok(errs.some((e) => e.startsWith('tools: ')));
  assert.ok(errs.some((e) => e.startsWith('java.basePackage: ')));
  assert.ok(validateProfile({ ...p, tools: [] }, c).some((e) => e.startsWith('tools: ')));
});

test('validateProfile rejects duplicate addons and tools with a field path', async () => {
  const c = await loadCatalog(MINI);
  const p = createProfile({ stack: 'demo-java', addons: ['demo-addon'], mode: 'greenfield' }, c);
  assert.deepEqual(validateProfile({ ...p, addons: ['demo-addon', 'demo-addon'] }, c), ['addons: duplicate "demo-addon"']);
  assert.deepEqual(validateProfile({ ...p, tools: ['claude', 'codex', 'claude'] }, c), ['tools: duplicate "claude"']);
});

test('validateProfile checks version, stack, mode, guard, decisions', async () => {
  const c = await loadCatalog(MINI);
  const p = createProfile({ stack: 'demo-java', mode: 'greenfield' }, c);
  const bad = { ...p, version: 2, stack: 'zzz', mode: 'x', guard: 'yes', decisions: [{ id: 'a' }] };
  const fields = validateProfile(bad, c).map((e) => e.split(':')[0]);
  for (const f of ['version', 'stack', 'mode', 'guard', 'decisions[0]']) assert.ok(fields.includes(f), f);
  assert.ok(validateProfile(null, c).length > 0);
});

test('readProfile returns null when missing; throws PROFILE on bad JSON; write round-trips', async () => {
  const c = await loadCatalog(MINI);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sc-profile-'));
  try {
    assert.equal(await readProfile(dir), null);
    const p = createProfile({ stack: 'demo-java', mode: 'greenfield' }, c);
    await writeProfile(dir, p);
    const raw = await readFile(path.join(dir, PROFILE_FILE), 'utf8');
    assert.equal(raw, JSON.stringify(p, null, 2) + '\n');
    assert.deepEqual(await readProfile(dir), p);
    await writeFile(path.join(dir, PROFILE_FILE), '\uFEFF' + JSON.stringify(p));
    assert.deepEqual(await readProfile(dir), p);
    await writeFile(path.join(dir, PROFILE_FILE), '{nope');
    await assert.rejects(readProfile(dir), (e) => e.code === 'PROFILE');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
