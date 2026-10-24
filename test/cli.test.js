import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'stackcrew.js');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

function run(...args) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
}

test('version prints package.json version', () => {
  const r = run('version');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), pkg.version);
});

test('help lists every command', () => {
  const r = run('help');
  assert.equal(r.status, 0);
  for (const c of ['init', 'sync', 'add', 'list', 'detect', 'check', 'plugin', 'version']) {
    assert.ok(r.stdout.includes(c), `help should mention ${c}`);
  }
});

test('unknown command exits 1 with usage', () => {
  const r = run('bogus');
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('Usage: stackcrew'));
});

test('unimplemented command prints not implemented and exits 1', () => {
  const r = run('check');
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('not implemented'));
});
