import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { validateCatalog } from '../src/catalog/validate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_IDS = ['type-safety', 'error-handling', 'logging', 'testing', 'performance', 'security', 'backend-api', 'frontend', 'delivery', 'brownfield'].map((n) => `core-${n}`);

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
