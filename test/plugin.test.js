import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '../src/plugin/build.js';
import { loadCatalog } from '../src/catalog/load.js';
import { parseFrontmatter } from '../src/util/frontmatter.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mini = path.join(root, 'test', 'fixtures', 'catalog-mini');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

async function build() {
  const outRoot = mkdtempSync(path.join(tmpdir(), 'sc-plugin-'));
  const catalog = await loadCatalog(mini);
  const written = await buildPlugin({ pkgRoot: root, outRoot, version, catalog });
  return { outRoot, written };
}
const read = (outRoot, rel) => readFileSync(path.join(outRoot, ...rel.split('/')), 'utf8');

test('builds marketplace, manifest, hooks, skills and bundled cli', async () => {
  const { outRoot, written } = await build();
  for (const rel of [
    '.claude-plugin/marketplace.json',
    'plugin/.claude-plugin/plugin.json',
    'plugin/hooks/hooks.json',
    'plugin/skills/init/SKILL.md',
    'plugin/skills/sync/SKILL.md',
    'plugin/cli/bin/stackcrew.js',
    'plugin/cli/src/guard/hook.js',
    'plugin/cli/package.json',
  ]) {
    assert.ok(written.includes(rel), `${rel} should be written`);
    assert.ok(existsSync(path.join(outRoot, ...rel.split('/'))), `${rel} should exist`);
  }
  const market = JSON.parse(read(outRoot, '.claude-plugin/marketplace.json'));
  assert.equal(market.plugins[0].source, './plugin');
  assert.equal(market.plugins[0].version, version);
  const manifest = JSON.parse(read(outRoot, 'plugin/.claude-plugin/plugin.json'));
  assert.equal(manifest.name, 'stackcrew');
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.author, undefined, 'author is left to the user');
  const pkg = JSON.parse(read(outRoot, 'plugin/cli/package.json'));
  assert.deepEqual(pkg, { name: 'stackcrew', version, type: 'module', bin: { stackcrew: 'bin/stackcrew.js' } });
  assert.ok(!written.some((p) => p.endsWith('.test.js')), 'no test files bundled');
  assert.ok(!written.some((p) => /^plugin\/cli\/(test|docs|node_modules|test-helpers)\//.test(p)));
  assert.ok(!read(outRoot, 'plugin/cli/src/cli.js').includes('\r'));
});

test('command skills are user-only and call the bundled CLI', async () => {
  const { outRoot } = await build();
  for (const name of ['init', 'sync']) {
    const { data, body } = parseFrontmatter(read(outRoot, `plugin/skills/${name}/SKILL.md`));
    assert.equal(data.name, name);
    assert.equal(data['disable-model-invocation'], true);
    assert.ok(body.includes('${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js'));
    assert.ok(!body.includes('{{sc:'));
  }
});

test('bundled cli runs from the plugin copy', async () => {
  const { outRoot } = await build();
  const r = spawnSync(process.execPath, [path.join(outRoot, 'plugin', 'cli', 'bin', 'stackcrew.js'), 'version'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), version);
});

test('hook matcher covers Edit, Write and MultiEdit', async () => {
  const { outRoot } = await build();
  const raw = read(outRoot, 'plugin/hooks/hooks.json');
  const hooks = JSON.parse(raw);
  const entry = hooks.hooks.PreToolUse[0];
  assert.equal(entry.matcher, 'Edit|Write|MultiEdit');
  assert.deepEqual(new Set(entry.matcher.split('|')), new Set(['Edit', 'Write', 'MultiEdit']));
  assert.equal(entry.hooks[0].command, 'node');
  assert.deepEqual(entry.hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/cli/src/guard/hook.js']);
  assert.equal(entry.hooks[0].timeout, 10);
  assert.ok(raw.endsWith('}\n'));
});

test('rebuild removes stale plugin files but keeps everything else', async () => {
  const { outRoot } = await build();
  writeFileSync(path.join(outRoot, 'plugin', 'stale.txt'), 'x');
  writeFileSync(path.join(outRoot, 'package.json'), JSON.stringify({ name: 'stackcrew' }));
  writeFileSync(path.join(outRoot, 'keep.txt'), 'keep');
  await buildPlugin({ pkgRoot: root, outRoot, version, catalog: await loadCatalog(mini) });
  assert.ok(!existsSync(path.join(outRoot, 'plugin', 'stale.txt')));
  assert.equal(read(outRoot, 'keep.txt'), 'keep');
});

test('refuses to build into a foreign non-empty directory', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sc-foreign-'));
  mkdirSync(path.join(dir, 'plugin'));
  writeFileSync(path.join(dir, 'plugin', 'mine.txt'), 'precious');
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'someone-else' }));
  await assert.rejects(
    buildPlugin({ pkgRoot: root, outRoot: dir, version, catalog: await loadCatalog(mini) }),
    (e) => e.code === 'RENDER',
  );
  assert.equal(readFileSync(path.join(dir, 'plugin', 'mine.txt'), 'utf8'), 'precious');
  rmSync(dir, { recursive: true, force: true });
});

test('skips init skill when the catalog has no stackcrew-init', async () => {
  const outRoot = mkdtempSync(path.join(tmpdir(), 'sc-noinit-'));
  const catalog = await loadCatalog(mini);
  catalog.sharedSkills = catalog.sharedSkills.filter((s) => s.name !== 'stackcrew-init');
  const written = await buildPlugin({ pkgRoot: root, outRoot, version, catalog });
  assert.ok(!written.some((p) => p.startsWith('plugin/skills/init/')));
});
