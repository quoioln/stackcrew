import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('npm pack ships bin/src only, no tests', () => {
  const r = spawnSync('npm pack --dry-run --json', { cwd: root, encoding: 'utf8', shell: true });
  assert.equal(r.status, 0, r.stderr);
  const paths = JSON.parse(r.stdout)[0].files.map((f) => f.path.split(String.fromCharCode(92)).join('/'));
  assert.ok(paths.includes('bin/stackcrew.js'));
  assert.ok(paths.includes('src/cli.js'));
  for (const p of paths) {
    for (const bad of ['test/', 'fixtures/', 'plugin/', 'docs/']) {
      assert.ok(!p.startsWith(bad), `${p} must not be published`);
    }
  }
});

test('npm pack ships catalog', () => {
  const r = spawnSync('npm pack --dry-run --json', { cwd: root, encoding: 'utf8', shell: true });
  assert.equal(r.status, 0, r.stderr);
  const paths = JSON.parse(r.stdout)[0].files.map((f) => f.path.split(String.fromCharCode(92)).join('/'));
  assert.ok(paths.includes('catalog/core/always-on.md'));
});
