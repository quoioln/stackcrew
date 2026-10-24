import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.js';
import { parseUnifiedDiff } from '../src/guard/diff.js';

function sh(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
}

function tmp() {
  return mkdtempSync(path.join(tmpdir(), 'sc-check-'));
}

function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

const GUARD = {
  version: 1,
  enabled: true,
  rules: [{
    id: 'SC-TYPE',
    globs: ['**/*.java'],
    excludeGlobs: ['**/src/test/**'],
    regex: '\\bJsonNode\\b',
    flags: '',
    message: 'Do not use JsonNode',
  }],
};

function initRepo({ guard = true } = {}) {
  const dir = tmp();
  sh(dir, 'init', '-b', 'main');
  if (guard) write(dir, '.stackcrew/guard.json', JSON.stringify(GUARD, null, 2) + '\n');
  write(dir, 'src/main/java/A.java', 'class A {\n  int x;\n}\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-m', 'init');
  return dir;
}

async function check(cwd, args) {
  let stdout = '';
  let stderr = '';
  const io = {
    cwd,
    stdout: { write: (s) => { stdout += s; } },
    stderr: { write: (s) => { stderr += s; } },
    isTTY: false,
  };
  const code = await main(['check', ...args], io);
  return { code, stdout, stderr };
}

test('the guard rule fixture keeps its regex backslash', () => {
  assert.equal(GUARD.rules[0].regex, '\\bJsonNode\\b');
  assert.equal(GUARD.rules[0].regex.length, 12);
  assert.ok(JSON.stringify(GUARD).includes('\\\\bJsonNode'));
});

test('parseUnifiedDiff: hunks, rename, deleted file, no-newline marker', () => {
  const diff = [
    'diff --git a/src/A.java b/src/A.java',
    'index 111..222 100644',
    '--- a/src/A.java',
    '+++ b/src/A.java',
    '@@ -2,0 +3,2 @@ class A {',
    '+  one',
    '+  two',
    '@@ -10 +12 @@',
    '-old',
    '+new',
    '\\ No newline at end of file',
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-x',
    '-y',
    'diff --git a/old.txt b/new.txt',
    'similarity index 100%',
    'rename from old.txt',
    'rename to new.txt',
    'diff --git a/img.png b/img.png',
    'Binary files a/img.png and b/img.png differ',
    'diff --git "a/sp \\"q\\".txt" "b/sp \\"q\\".txt"',
    '--- "a/sp \\"q\\".txt"',
    '+++ "b/sp \\"q\\".txt"',
    '@@ -0,0 +1 @@',
    '+++ not a header',
    'diff --git a/ren.txt b/ren2.txt',
    'rename from ren.txt',
    'rename to ren2.txt',
    '--- a/ren.txt',
    '+++ b/ren2.txt',
    '@@ -1 +1,2 @@',
    ' keep',
    '+added',
    '',
  ].join('\n');
  assert.deepEqual(parseUnifiedDiff(diff), [
    { file: 'src/A.java', lines: [{ line: 3, text: '  one' }, { line: 4, text: '  two' }, { line: 12, text: 'new' }] },
    { file: 'sp "q".txt', lines: [{ line: 1, text: '++ not a header' }] },
    { file: 'ren2.txt', lines: [{ line: 2, text: 'added' }] },
  ]);
});

test('check fails loudly outside a git repo', async () => {
  const dir = tmp();
  try {
    const r = await check(dir, []);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not a git repository/);
    assert.doesNotMatch(r.stdout, /0 violations/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check fails loudly when base ref is missing', async () => {
  const dir = initRepo();
  try {
    const r = await check(dir, ['--base', 'origin/nope']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /base ref not found: origin\/nope/);
    assert.doesNotMatch(r.stdout, /0 violations/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check fails when not initialized', async () => {
  const dir = initRepo({ guard: false });
  try {
    const r = await check(dir, []);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not initialized/);
    assert.doesNotMatch(r.stdout, /0 violations/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check fails when guard.json has an invalid rule', async () => {
  const dir = initRepo({ guard: false });
  try {
    write(dir, '.stackcrew/guard.json', JSON.stringify({ rules: [{ id: 'SC-X', globs: ['**'], regex: '(', flags: '', message: 'm' }] }));
    const r = await check(dir, []);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /SC-X/);
    assert.doesNotMatch(r.stdout, /0 violations/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check --base reports added violation with line number', async () => {
  const dir = initRepo();
  try {
    sh(dir, 'checkout', '-b', 'feature');
    write(dir, 'src/main/java/A.java', 'class A {\n  int x;\n  JsonNode n;\n}\n');
    write(dir, 'src/test/java/T.java', 'class T { JsonNode n; }\n');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-m', 'feat');
    const r = await check(dir, ['--base', 'main']);
    assert.equal(r.code, 1);
    assert.ok(r.stdout.includes('src/main/java/A.java:3 [SC-TYPE]'), r.stdout);
    assert.ok(r.stdout.includes('    > JsonNode n;'));
    assert.ok(r.stdout.includes('stackcrew check: 1 violation(s)'));
    assert.ok(!r.stdout.includes('T.java'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check ignores pre-existing violations', async () => {
  const dir = tmp();
  try {
    sh(dir, 'init', '-b', 'main');
    write(dir, '.stackcrew/guard.json', JSON.stringify(GUARD));
    write(dir, 'src/main/java/A.java', 'class A {\n  JsonNode old;\n}\n');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-m', 'init');
    sh(dir, 'checkout', '-b', 'feature');
    write(dir, 'src/main/java/A.java', 'class A {\n  JsonNode old;\n  int ok;\n}\n');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-m', 'feat');
    const r = await check(dir, ['--base', 'main']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /0 violations in 1 added line\(s\) across 1 file\(s\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('default mode scans untracked files and working-tree changes', async () => {
  const dir = initRepo();
  try {
    write(dir, 'src/main/java/B.java', 'class B {\r\n  JsonNode n;\r\n}\r\n');
    const r = await check(dir, []);
    assert.equal(r.code, 1);
    assert.ok(r.stdout.includes('src/main/java/B.java:2 [SC-TYPE]'), r.stdout);
    assert.ok(r.stdout.includes('    > JsonNode n;'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseUnifiedDiff: quoted path with trailing TAB and octal escapes (real git form)', () => {
  const diff = [
    'diff --git "a/q\\357\\200\\242s p.java" "b/q\\357\\200\\242s p.java"',
    '--- "a/q\\357\\200\\242s p.java"\t',
    '+++ "b/q\\357\\200\\242s p.java"\t',
    '@@ -0,0 +1 @@',
    '+JsonNode x;',
    'diff --git "a/c\\303\\240 p\\303\\252.java" "b/c\\303\\240 p\\303\\252.java"',
    '+++ "b/c\\303\\240 p\\303\\252.java"\t',
    '@@ -0,0 +1 @@',
    '+y',
    'diff --git a/s p.java b/s p.java',
    '+++ b/s p.java\t',
    '@@ -0,0 +1 @@',
    '+z',
    'diff --git "a/t\\\\a\\tb.java" "b/t\\\\a\\tb.java"',
    '+++ "b/t\\\\a\\tb.java"',
    '@@ -0,0 +1 @@',
    '+w',
    '',
  ].join('\n');
  assert.deepEqual(parseUnifiedDiff(diff).map((f) => f.file), [
    'qs p.java',
    'cà pê.java',
    's p.java',
    't\\a\tb.java',
  ]);
});

test('check reports violations in files with spaces and non-ASCII names (real git)', async () => {
  const dir = initRepo();
  try {
    sh(dir, 'checkout', '-b', 'feature');
    write(dir, 'src/main/java/s p.java', 'class S {\n  JsonNode a;\n}\n');
    write(dir, 'src/main/java/cà phê.java', 'class C {\n  JsonNode b;\n}\n');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-m', 'names');
    const r = await check(dir, ['--base', 'main']);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('src/main/java/s p.java:2 [SC-TYPE]'), r.stdout);
    assert.ok(r.stdout.includes('src/main/java/cà phê.java:2 [SC-TYPE]'), r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check is immune to diff.mnemonicPrefix and diff.noprefix config', async () => {
  const dir = initRepo();
  try {
    sh(dir, 'config', 'diff.mnemonicPrefix', 'true');
    sh(dir, 'config', 'diff.noprefix', 'true');
    write(dir, 'src/main/java/A.java', 'class A {\n  int x;\n  JsonNode n;\n}\n');
    const r = await check(dir, []);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('src/main/java/A.java:3 [SC-TYPE]'), r.stdout);
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-m', 'v');
    const r2 = await check(dir, ['--base', 'HEAD~1']);
    assert.equal(r2.code, 1);
    assert.ok(r2.stdout.includes('src/main/java/A.java:3 [SC-TYPE]'), r2.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check fails loudly on unrelated history (no merge base)', async () => {
  const dir = initRepo();
  try {
    sh(dir, 'checkout', '--orphan', 'other');
    write(dir, 'src/main/java/Z.java', 'class Z { JsonNode n; }\n');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-m', 'orphan');
    const r = await check(dir, ['--base', 'main']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /failed/);
    assert.doesNotMatch(r.stdout, /0 violations/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check works on a detached HEAD', async () => {
  const dir = initRepo();
  try {
    sh(dir, 'checkout', '--detach');
    write(dir, 'src/main/java/A.java', 'class A {\n  int x;\n  JsonNode n;\n}\n');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-m', 'detached');
    const r = await check(dir, ['--base', 'main']);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('src/main/java/A.java:3 [SC-TYPE]'), r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check reports an added violating line in a renamed file at the new path', async () => {
  const dir = initRepo();
  try {
    sh(dir, 'checkout', '-b', 'feature');
    sh(dir, 'mv', 'src/main/java/A.java', 'src/main/java/Renamed.java');
    write(dir, 'src/main/java/Renamed.java', 'class A {\n  int x;\n  JsonNode n;\n}\n');
    sh(dir, 'add', '-A');
    sh(dir, 'commit', '-m', 'rename');
    const r = await check(dir, ['--base', 'main']);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.includes('src/main/java/Renamed.java:3 [SC-TYPE]'), r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check argument errors exit 2 with usage on stderr', async () => {
  const dir = initRepo();
  try {
    const r = await check(dir, ['--bas', 'main']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /stackcrew check \[--base <ref>\] \[--staged\]/);
    assert.equal(r.stdout, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('default mode skips binary untracked files and --staged scans the index', async () => {
  const dir = initRepo();
  try {
    writeFileSync(path.join(dir, 'src/main/java/Bin.java'), Buffer.from([0, 74, 115, 111, 110, 78, 111, 100, 101]));
    let r = await check(dir, []);
    assert.equal(r.code, 0, r.stdout + r.stderr);

    write(dir, 'src/main/java/A.java', 'class A {\n  int x;\n  JsonNode s;\n}\n');
    sh(dir, 'add', 'src/main/java/A.java');
    r = await check(dir, ['--staged']);
    assert.equal(r.code, 1);
    assert.ok(r.stdout.includes('src/main/java/A.java:3 [SC-TYPE]'), r.stdout);
    assert.equal(readFileSync(path.join(dir, '.stackcrew/guard.json'), 'utf8').includes('\\\\bJsonNode'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
