import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'stackcrew.js');
const hookJs = path.join(root, 'src', 'guard', 'hook.js');
const fixture = path.join(root, 'fixtures', 'spring-boot-minimal');

const BEGIN = '<!-- stackcrew:begin';
const END = '<!-- stackcrew:end -->';
const BAD_SERVICE = 'src/main/java/com/example/kyc/service/BadService.java';

// The real catalog is under test: the override variable must not leak into the child.
function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.STACKCREW_CATALOG_DIR;
  return env;
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: childEnv() });
}

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** Temp copy of the fixture, git-initialised on main. */
function project(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'stackcrew-e2e-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(fixture, dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}

const ALL_TOOLS = ['--stack', 'spring-boot', '--addons', 'kafka,camel,observability', '--tools', 'claude,cursor,codex,antigravity'];

function initAll(dir) {
  const r = run(dir, 'init', ...ALL_TOOLS);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return r;
}

function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '.git') return [];
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

const read = (dir, rel) => readFileSync(path.join(dir, rel), 'utf8');

function hook(dir, toolInput) {
  const payload = { tool_name: 'Write', cwd: dir, tool_input: toolInput };
  return spawnSync(process.execPath, [hookJs], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: childEnv({ CLAUDE_PROJECT_DIR: dir }),
  });
}

test('init all tools renders the expected spring-boot file set', (t) => {
  const dir = project(t);
  const r = initAll(dir);
  const expected = [
    '.claude/rules/stackcrew/core.md',
    '.claude/rules/stackcrew/stack-spring-boot.md',
    '.cursor/rules/stackcrew/stack-spring-boot.mdc',
    '.agents/rules/stackcrew-stack-spring-boot.md',
    '.agents/skills/stackcrew-spring-boot-rules/SKILL.md',
    '.claude/skills/stackcrew-spring-integration-provider/SKILL.md',
    '.agents/skills/stackcrew-spring-integration-provider/SKILL.md',
    '.claude/agents/stackcrew-spring-boot-developer.md',
    '.codex/agents/stackcrew-spring-boot-developer.toml',
    '.agents/agents/stackcrew-spring-boot-developer.md',
    'docs/stackcrew/architecture-profile.md',
    '.stackcrew/guard.json',
    '.stackcrew/lint/checkstyle.xml',
    '.stackcrew/ci/Jenkinsfile.stackcrew.groovy',
  ];
  for (const p of expected) assert.ok(existsSync(path.join(dir, p)), `missing ${p}`);
  assert.ok(r.stdout.includes('cursor-duplicate-skills'), r.stdout);
  assert.deepEqual(walk(dir).filter((p) => p.startsWith('docs/sdlc/')), []);
});

test('budgets hold on the real render', (t) => {
  const dir = project(t);
  const r = initAll(dir);
  assert.ok(!r.stdout.includes('agents-md-essentials-reduced'), r.stdout);

  const agents = read(dir, 'AGENTS.md');
  const begin = agents.indexOf(BEGIN);
  const end = agents.indexOf(END);
  assert.ok(begin >= 0 && end > begin, 'AGENTS.md has a stackcrew block');
  const block = agents.slice(begin, end + END.length);
  assert.ok(Buffer.byteLength(block) <= 16000, `AGENTS.md block is ${Buffer.byteLength(block)} bytes`);

  const files = walk(dir);
  const mdc = files.filter((p) => p.startsWith('.cursor/rules/stackcrew/') && p.endsWith('.mdc'));
  assert.ok(mdc.length > 0);
  for (const p of mdc) {
    const lines = read(dir, p).split('\n').length;
    assert.ok(lines <= 500, `${p} has ${lines} lines`);
  }
  const ag = files.filter((p) => p.startsWith('.agents/rules/stackcrew-'));
  assert.ok(ag.length > 0);
  for (const p of ag) {
    const bytes = Buffer.byteLength(read(dir, p));
    assert.ok(bytes <= 24000, `${p} is ${bytes} bytes`);
  }
});

test('existing SDLC CLAUDE.md and AGENTS.md survive byte-for-byte', (t) => {
  const dir = project(t);
  const seeds = {
    'CLAUDE.md': '## SDLC Workflow\r\n\r\nTrigger on idea.\r\nA line with a tab\tand text.\r\n',
    'AGENTS.md': '## SDLC Workflow\r\n\r\nAGENTS content, CRLF kept.\r\n',
  };
  for (const [file, seed] of Object.entries(seeds)) writeFileSync(path.join(dir, file), seed);

  initAll(dir);
  for (const [file, seed] of Object.entries(seeds)) {
    const after = read(dir, file);
    assert.ok(after.startsWith(seed), `${file} prefix changed after init`);
    assert.ok(after.includes(BEGIN), `${file} has the block`);
  }

  const second = run(dir, 'sync');
  assert.equal(second.status, 0, second.stderr + second.stdout);
  for (const [file, seed] of Object.entries(seeds)) {
    assert.ok(read(dir, file).startsWith(seed), `${file} prefix changed after sync`);
  }
});

test('check flags the seeded violation', (t) => {
  const dir = project(t);
  initAll(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');

  const clean = run(dir, 'check', '--base', 'main');
  assert.equal(clean.status, 0, clean.stderr + clean.stdout);

  git(dir, 'checkout', '-q', '-b', 'feature');
  const svc = path.join(dir, 'src/main/java/com/example/kyc/service');
  mkdirSync(svc, { recursive: true });
  const lines = [
    'package com.example.kyc.service;',
    '',
    'import com.fasterxml.jackson.databind.JsonNode;',
    '',
    'public class BadService2 {',
    '',
    '    private JsonNode raw;',
    '}',
    '',
  ];
  writeFileSync(path.join(svc, 'BadService2.java'), lines.join('\n'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feature');

  const bad = run(dir, 'check', '--base', 'main');
  assert.equal(bad.status, 1, bad.stderr + bad.stdout);
  assert.ok(bad.stdout.includes('BadService2.java:7'), bad.stdout);
  assert.ok(bad.stdout.includes('SC-TYPE'), bad.stdout);
  assert.ok(!bad.stdout.includes('BadService2.java:3'), 'import lines are skipped');
});

test('hook blocks writing BadService content', (t) => {
  const dir = project(t);
  initAll(dir);
  const content = read(dir, BAD_SERVICE).replaceAll('BadService', 'BadServiceCopy');
  const target = path.join(dir, 'src/main/java/com/example/kyc/service/BadServiceCopy.java');

  const blocked = hook(dir, { file_path: target, content });
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.ok(blocked.stderr.includes('SC-TYPE'), blocked.stderr);

  const waivedContent = content
    .split('\n')
    .map((l) => (l.includes('Map<String, Object>') ? `${l} // stackcrew-allow: SC-TYPE boundary payload mapped next` : l))
    .join('\n');
  const waived = hook(dir, { file_path: target, content: waivedContent });
  assert.equal(waived.status, 0, waived.stderr);
});

test('sync is idempotent', (t) => {
  const dir = project(t);
  initAll(dir);
  const second = run(dir, 'sync');
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.match(second.stdout, /stackcrew sync: 0 written, /);
});
