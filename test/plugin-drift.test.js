import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '../src/plugin/build.js';
import { loadCatalog } from '../src/catalog/load.js';
import { getCatalogDir } from '../src/paths.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listAll(base, sub) {
  const dir = path.join(base, sub);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${sub}/${e.name}`;
    if (e.isDirectory()) out.push(...listAll(base, rel));
    else out.push(rel);
  }
  return out;
}
const lf = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('committed plugin matches a fresh build', async () => {
  const saved = process.env.STACKCREW_CATALOG_DIR;
  delete process.env.STACKCREW_CATALOG_DIR;
  const outRoot = mkdtempSync(path.join(tmpdir(), 'sc-drift-'));
  try {
    copyFileSync(path.join(root, 'package.json'), path.join(outRoot, 'package.json'));
    const catalog = await loadCatalog(getCatalogDir());
    const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    await buildPlugin({ pkgRoot: root, outRoot, version, catalog });
  } finally {
    if (saved !== undefined) process.env.STACKCREW_CATALOG_DIR = saved;
  }
  const fresh = new Set([...listAll(outRoot, 'plugin'), ...listAll(outRoot, '.claude-plugin')]);
  const committed = new Set([...listAll(root, 'plugin'), ...listAll(root, '.claude-plugin')]);
  const problems = [];
  for (const f of [...fresh].sort()) {
    if (!committed.has(f)) problems.push(`missing: ${f}`);
    else if (lf(path.join(outRoot, f)) !== lf(path.join(root, f))) problems.push(`differs: ${f}`);
  }
  for (const f of [...committed].sort()) if (!fresh.has(f)) problems.push(`extra: ${f}`);
  assert.deepEqual(problems, [], `plugin is out of date:\n${problems.join('\n')}\nrun: node bin/stackcrew.js plugin`);
});
