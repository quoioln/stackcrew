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
  // Safe under git hooks: inherited GIT_DIR / GIT_INDEX_FILE would redirect the child's git calls.
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return env;
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: childEnv() });
}

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8', env: childEnv() });
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
    const appended = after.slice(seed.length);
    assert.ok(appended.includes('\r\n'), `${file} block uses CRLF`);
    assert.ok(!/(^|[^\r])\n/.test(appended), `${file} block has a bare LF`);
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

// Calls src/guard/hook.js directly; the plugin-wired path (hooks.json) is covered by manual checklist L4.
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

test('half marker aborts init and writes nothing', (t) => {
  const dir = project(t);
  const seed = '# Agents\n<!-- stackcrew:begin -->\nhalf a block\n';
  writeFileSync(path.join(dir, 'AGENTS.md'), seed);
  // ALL_TOOLS passes --stack spring-boot, so exit 1 can only come from the marker check.
  const r = run(dir, 'init', ...ALL_TOOLS);
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.match(r.stderr, /stackcrew:begin/);
  assert.match(r.stderr, /nothing was written/);
  assert.equal(read(dir, 'AGENTS.md'), seed);
  assert.ok(!existsSync(path.join(dir, 'CLAUDE.md')));
  assert.ok(!existsSync(path.join(dir, '.claude/rules/stackcrew/core.md')));
  assert.ok(!existsSync(path.join(dir, '.stackcrew/manifest.json')));
});

test('check fails loudly when the base ref is missing or outside git', (t) => {
  const dir = project(t);
  initAll(dir);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const r = run(dir, 'check', '--base', 'origin/nope');
  assert.equal(r.status, 2, r.stderr + r.stdout);
  assert.match(r.stderr, /base ref not found/);
  assert.doesNotMatch(r.stdout, /0 violations/);

  const bare = mkdtempSync(path.join(tmpdir(), 'stackcrew-nogit-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  const n = run(bare, 'check');
  assert.equal(n.status, 2, n.stderr + n.stdout);
  assert.match(n.stderr, /not a git repository/);
  assert.doesNotMatch(n.stdout, /0 violations/);
});

test('sync refuses to overwrite a hand-edited file; --force restores it', (t) => {
  const dir = project(t);
  initAll(dir);
  const rel = '.claude/rules/stackcrew/core.md';
  const generated = read(dir, rel);
  const edited = generated + '\nMy own note.\n';
  writeFileSync(path.join(dir, rel), edited);

  const r = run(dir, 'sync');
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.ok(r.stdout.includes('skipped (edited by hand)'), r.stdout);
  assert.equal(read(dir, rel), edited);

  const f = run(dir, 'sync', '--force');
  assert.equal(f.status, 0, f.stderr + f.stdout);
  assert.equal(read(dir, rel), generated);
});

// 'valid' is the positive control: it proves addon removal really deletes, so the other two are not vacuous.
for (const [label, corrupt] of [['valid', undefined], ['missing', null], ['corrupt', '{']]) {
  test(`${label} manifest ${label === 'valid' ? 'deletes the dropped addon rule' : 'deletes nothing'}`, (t) => {
    const dir = project(t);
    const r = run(dir, 'init', '--stack', 'spring-boot', '--addons', 'kafka', '--tools', 'claude');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const stale = '.claude/rules/stackcrew/addon-kafka.md';
    assert.ok(existsSync(path.join(dir, stale)));

    const profile = JSON.parse(read(dir, 'stackcrew.json'));
    profile.addons = [];
    writeFileSync(path.join(dir, 'stackcrew.json'), JSON.stringify(profile, null, 2) + '\n');
    const manifest = path.join(dir, '.stackcrew/manifest.json');
    if (corrupt === null) rmSync(manifest);
    else if (corrupt !== undefined) writeFileSync(manifest, corrupt);

    const s = run(dir, 'sync');
    if (label === 'valid') {
      assert.equal(s.status, 0, s.stderr + s.stdout);
      assert.ok(!existsSync(path.join(dir, stale)), `${stale} must be deleted with a valid manifest`);
    } else {
      // Without a trusted manifest, changed files look hand-edited: skipped, exit 1, nothing deleted.
      assert.equal(s.status, 1, s.stderr + s.stdout);
      assert.match(s.stdout, /, 0 deleted, /);
      assert.ok(existsSync(path.join(dir, stale)), `${stale} must survive a ${label} manifest`);
    }
  });
}

test('hook fails open', (t) => {
  const dir = project(t);
  initAll(dir);
  const content = read(dir, BAD_SERVICE).replaceAll('BadService', 'BadServiceCopy');
  const target = path.join(dir, 'src/main/java/com/example/kyc/service/BadServiceCopy.java');
  const spawnHook = (input, projectDir) => spawnSync(process.execPath, [hookJs], {
    input,
    encoding: 'utf8',
    env: childEnv({ CLAUDE_PROJECT_DIR: projectDir }),
  });
  const payload = (file, cwd) => JSON.stringify({ tool_name: 'Write', cwd, tool_input: { file_path: file, content } });

  // Sanity: the same payload is blocked in the initialized project.
  assert.equal(spawnHook(payload(target, dir), dir).status, 2);

  assert.equal(spawnHook('{ not json', dir).status, 0, 'malformed stdin');

  const outside = mkdtempSync(path.join(tmpdir(), 'stackcrew-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  assert.equal(spawnHook(payload(path.join(outside, 'BadServiceCopy.java'), dir), dir).status, 0, 'file outside project');

  const bare = mkdtempSync(path.join(tmpdir(), 'stackcrew-noguard-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  assert.equal(spawnHook(payload(path.join(bare, 'BadServiceCopy.java'), bare), bare).status, 0, 'no guard.json');

  const guardPath = path.join(dir, '.stackcrew/guard.json');
  const guard = JSON.parse(readFileSync(guardPath, 'utf8'));
  guard.enabled = false;
  writeFileSync(guardPath, JSON.stringify(guard));
  assert.equal(spawnHook(payload(target, dir), dir).status, 0, 'enabled: false');
});
