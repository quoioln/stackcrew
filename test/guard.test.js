import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGuardRules, isAllowed, scanLines } from '../src/guard/scan.js';
import { newLines, runHook } from '../src/guard/hook.js';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'guard', 'hook.js');

const RULE = {
  id: 'SC-TYPE',
  globs: ['**/*.java'],
  excludeGlobs: ['**/src/test/**'],
  regex: '\\bJsonNode\\b',
  flags: '',
  message: 'Use a typed DTO instead of JsonNode',
};

function makeProject(guard) {
  const dir = mkdtempSync(join(tmpdir(), 'sc-guard-'));
  if (guard !== undefined) {
    mkdirSync(join(dir, '.stackcrew'));
    writeFileSync(join(dir, '.stackcrew', 'guard.json'), JSON.stringify(guard));
  }
  return dir;
}

function spawnHook(stdin, env = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env },
  });
  return { status: r.status, stderr: r.stderr };
}

const guardOn = { version: 1, enabled: true, rules: [RULE] };
const writeInput = (dir, rel, content) => ({
  tool_name: 'Write',
  cwd: dir,
  tool_input: { file_path: join(dir, rel), content },
});
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

describe('hook fails open', () => {
  test('malformed stdin exits 0', () => {
    assert.equal(spawnHook('not json').status, 0);
  });

  test('file outside project exits 0', () => {
    const dir = makeProject(guardOn);
    try {
      const input = {
        tool_name: 'Write',
        cwd: dir,
        tool_input: { file_path: join(tmpdir(), 'elsewhere', 'A.java'), content: 'JsonNode x;' },
      };
      assert.equal(spawnHook(JSON.stringify(input), { CLAUDE_PROJECT_DIR: dir }).status, 0);
    } finally {
      cleanup(dir);
    }
  });

  test('no guard.json exits 0', () => {
    const dir = makeProject(undefined);
    try {
      const input = writeInput(dir, 'src/main/java/A.java', 'JsonNode x;');
      assert.equal(spawnHook(JSON.stringify(input)).status, 0);
    } finally {
      cleanup(dir);
    }
  });

  test('guard disabled exits 0', () => {
    const dir = makeProject({ ...guardOn, enabled: false });
    try {
      const input = writeInput(dir, 'src/main/java/A.java', 'JsonNode x;');
      assert.equal(spawnHook(JSON.stringify(input)).status, 0);
    } finally {
      cleanup(dir);
    }
  });

  test('unparsable guard.json and non-array rules exit 0', () => {
    const dir = makeProject(undefined);
    try {
      mkdirSync(join(dir, '.stackcrew'));
      writeFileSync(join(dir, '.stackcrew', 'guard.json'), '{oops');
      const input = writeInput(dir, 'src/main/java/A.java', 'JsonNode x;');
      assert.equal(spawnHook(JSON.stringify(input)).status, 0);
      writeFileSync(join(dir, '.stackcrew', 'guard.json'), JSON.stringify({ version: 1, enabled: true, rules: 'x' }));
      assert.equal(spawnHook(JSON.stringify(input)).status, 0);
    } finally {
      cleanup(dir);
    }
  });

  test('non-object input, other tools, no root and thrown errors exit 0', () => {
    const env = { CLAUDE_PROJECT_DIR: '/p' };
    const readFile = () => JSON.stringify(guardOn);
    assert.equal(runHook(null, { env, readFile }).exitCode, 0);
    assert.equal(runHook('str', { env, readFile }).exitCode, 0);
    assert.equal(runHook({ tool_name: 'Read', tool_input: {} }, { env, readFile }).exitCode, 0);
    const noRoot = { tool_name: 'Write', tool_input: { file_path: '/p/A.java', content: 'JsonNode' } };
    assert.equal(runHook(noRoot, { env: {}, readFile }).exitCode, 0);
    const boom = () => {
      throw new Error('boom');
    };
    const w = { tool_name: 'Write', tool_input: { file_path: '/p/src/A.java', content: 'JsonNode' } };
    assert.equal(runHook(w, { env, readFile: boom }).exitCode, 0);
  });
});

describe('blocking', () => {
  test('Write of new java file with JsonNode exits 2 and names SC-TYPE', () => {
    const dir = makeProject(guardOn);
    try {
      const input = writeInput(dir, 'src/main/java/A.java', 'class A {\n  JsonNode x;\n}\n');
      const r = spawnHook(JSON.stringify(input));
      assert.equal(r.status, 2);
      assert.match(r.stderr, /^stackcrew guard blocked this edit:/);
      assert.match(r.stderr, /- \[SC-TYPE\] src\/main\/java\/A\.java:2: Use a typed DTO instead of JsonNode/);
      assert.match(r.stderr, /\n {4}> {3}JsonNode x;/);
      assert.match(
        r.stderr,
        /Fix the code to follow the rule\. For a justified exception add `stackcrew-allow: <ruleId> <reason>` in a comment on that line\.\s*$/,
      );
    } finally {
      cleanup(dir);
    }
  });

  test('excluded test path is not blocked', () => {
    const dir = makeProject(guardOn);
    try {
      const input = writeInput(dir, 'src/test/java/ATest.java', 'JsonNode x;');
      assert.equal(spawnHook(JSON.stringify(input)).status, 0);
    } finally {
      cleanup(dir);
    }
  });

  test('Edit keeping a pre-existing violation is not blocked', () => {
    const dir = makeProject(guardOn);
    try {
      const input = {
        tool_name: 'Edit',
        cwd: dir,
        tool_input: {
          file_path: join(dir, 'src/main/java/A.java'),
          old_string: 'JsonNode x;\nint a;',
          new_string: 'JsonNode x;\nint b;',
        },
      };
      assert.equal(spawnHook(JSON.stringify(input)).status, 0);
      input.tool_input.new_string = 'JsonNode x;\nJsonNode y;';
      const r = spawnHook(JSON.stringify(input));
      assert.equal(r.status, 2);
      assert.match(r.stderr, /src\/main\/java\/A\.java:~2:/);
    } finally {
      cleanup(dir);
    }
  });

  test('allow marker with reason passes; without reason blocks', () => {
    const dir = makeProject(guardOn);
    try {
      const ok = writeInput(dir, 'src/main/java/A.java', 'JsonNode x; // stackcrew-allow: SC-TYPE legacy adapter');
      assert.equal(spawnHook(JSON.stringify(ok)).status, 0);
      const bad = writeInput(dir, 'src/main/java/A.java', 'JsonNode x; // stackcrew-allow: SC-TYPE');
      assert.equal(spawnHook(JSON.stringify(bad)).status, 2);
    } finally {
      cleanup(dir);
    }
  });

  test('windows paths are normalized', () => {
    const readFile = (p) => (p.endsWith('guard.json') ? JSON.stringify(guardOn) : null);
    const input = {
      tool_name: 'Write',
      tool_input: { file_path: 'C:\\p\\src\\main\\java\\A.java', content: 'JsonNode x;' },
    };
    const r = runHook(input, { env: { CLAUDE_PROJECT_DIR: 'C:\\p' }, readFile });
    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /\[SC-TYPE\] src\/main\/java\/A\.java:1:/);
    const r2 = runHook(input, { env: { CLAUDE_PROJECT_DIR: 'c:\\P' }, readFile });
    assert.equal(r2.exitCode, 2);
  });

  test('root is not matched by mere string prefix', () => {
    const readFile = (p) => (p.endsWith('guard.json') ? JSON.stringify(guardOn) : null);
    const input = { tool_name: 'Write', tool_input: { file_path: '/proj2/src/A.java', content: 'JsonNode x;' } };
    assert.equal(runHook(input, { env: { CLAUDE_PROJECT_DIR: '/proj' }, readFile }).exitCode, 0);
  });

  test('Write onto existing file only flags new lines; MultiEdit combines edits', () => {
    const files = {
      '/p/.stackcrew/guard.json': JSON.stringify(guardOn),
      '/p/src/A.java': 'JsonNode a;\r\nint z;\r\n',
    };
    const readFile = (p) => files[p] ?? null;
    const env = { CLAUDE_PROJECT_DIR: '/p' };
    const same = { tool_name: 'Write', tool_input: { file_path: '/p/src/A.java', content: 'JsonNode a;\nint y;\n' } };
    assert.equal(runHook(same, { env, readFile }).exitCode, 0);
    const dup = { tool_name: 'Write', tool_input: { file_path: '/p/src/A.java', content: 'JsonNode a;\nJsonNode a;\n' } };
    const r = runHook(dup, { env, readFile });
    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /A\.java:2:/);
    const multi = {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: '/p/src/A.java',
        edits: [
          { old_string: 'x', new_string: 'x' },
          { old_string: 'a', new_string: 'JsonNode b;' },
        ],
      },
    };
    const m = runHook(multi, { env, readFile });
    assert.equal(m.exitCode, 2);
    assert.match(m.stderr, /A\.java:~1:/);
  });
});

describe('scan helpers', () => {
  test('scanLines reports correct line numbers', () => {
    const compiled = compileGuardRules([RULE]);
    const lines = [
      { line: 3, text: 'JsonNode a;' },
      { line: 7, text: 'int b;' },
      { line: 9, text: 'x = (JsonNode) y;' },
    ];
    const v = scanLines('src/main/java/A.java', lines, compiled);
    assert.deepEqual(
      v.map((x) => [x.file, x.line, x.ruleId]),
      [
        ['src/main/java/A.java', 3, 'SC-TYPE'],
        ['src/main/java/A.java', 9, 'SC-TYPE'],
      ],
    );
    assert.deepEqual(scanLines('src/test/java/A.java', lines, compiled), []);
    assert.deepEqual(scanLines('src/main/kotlin/A.kt', lines, compiled), []);
  });

  test('regex escapes survive and word boundary applies', () => {
    const [{ re }] = compileGuardRules([RULE]);
    assert.ok(re.test('JsonNode x'));
    assert.ok(!re.test('MyJsonNodeHelper'));
  });

  test('invalid regex throws CATALOG naming the rule', () => {
    assert.throws(
      () => compileGuardRules([{ ...RULE, id: 'SC-BAD', regex: '(' }]),
      (e) => e.code === 'CATALOG' && /SC-BAD/.test(e.message),
    );
  });

  test('isAllowed needs matching id and a reason', () => {
    assert.equal(isAllowed('x // stackcrew-allow: SC-TYPE because', 'SC-TYPE'), true);
    assert.equal(isAllowed('x // stackcrew-allow: SC-TYPE', 'SC-TYPE'), false);
    assert.equal(isAllowed('x // stackcrew-allow: SC-TYPE   ', 'SC-TYPE'), false);
    assert.equal(isAllowed('x // stackcrew-allow: SC-OTHER because', 'SC-TYPE'), false);
  });

  test('newLines multiset semantics', () => {
    assert.deepEqual(newLines('Write', { content: 'a\nb\na' }, null), [
      { line: 1, text: 'a' },
      { line: 2, text: 'b' },
      { line: 3, text: 'a' },
    ]);
    assert.deepEqual(newLines('Write', { content: 'a\nb\na' }, 'a\r\nb'), [{ line: 3, text: 'a' }]);
    assert.deepEqual(newLines('Edit', { old_string: 'a\nb', new_string: 'c\na' }, 'zzz'), [
      { line: 1, text: 'c', approx: true },
    ]);
    assert.deepEqual(newLines('Bash', {}, null), []);
  });
});

describe('hardening', () => {
  const javaGuard = (rules) => ({ version: 1, enabled: true, rules });
  const CONST_RULE = {
    id: 'SC-CONST',
    globs: ['**/*.java'],
    excludeGlobs: [],
    regex: '^(?!.*\\bstatic\\s+final\\b).*"https?://',
    flags: '',
    message: 'Hard-coded URL must be a static final constant',
  };
  const MAP_RULE = {
    id: 'SC-MAP',
    globs: ['**/*.java'],
    excludeGlobs: [],
    regex: 'Map<\\s*String\\s*,\\s*Object\\s*>',
    flags: '',
    message: 'No Map<String,Object>',
  };
  const run = (rules, files, input) =>
    runHook(input, {
      env: { CLAUDE_PROJECT_DIR: '/p' },
      readFile: (p) => (p === '/p/.stackcrew/guard.json' ? JSON.stringify(javaGuard(rules)) : (files[p] ?? null)),
    });
  const edit = (tool_input) => ({ tool_name: 'Edit', tool_input: { file_path: '/p/src/A.java', ...tool_input } });
  const URL_FILE = { '/p/src/A.java': 'class A {\n  private static final String U = "http://a";\n}\n' };

  test('hook works when launched through a junction/symlink', () => {
    const dir = makeProject(guardOn);
    const linkDir = mkdtempSync(join(tmpdir(), 'sc-link-'));
    try {
      const link = join(linkDir, 'srclink');
      symlinkSync(dirname(dirname(HOOK)), link, process.platform === 'win32' ? 'junction' : 'dir');
      const input = writeInput(dir, 'src/main/java/A.java', 'JsonNode x;');
      const r = spawnSync(process.execPath, [join(link, 'guard', 'hook.js')], {
        input: JSON.stringify(input),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
      });
      assert.equal(r.status, 2);
    } finally {
      cleanup(dir);
      cleanup(linkDir);
    }
  });

  test('missing or blank regex fails open and compile rejects it', () => {
    const dir = makeProject(undefined);
    try {
      const { regex, ...noRegex } = RULE;
      for (const rule of [noRegex, { ...RULE, regex: '' }, { ...RULE, regex: '  ' }]) {
        mkdirSync(join(dir, '.stackcrew'), { recursive: true });
        writeFileSync(join(dir, '.stackcrew', 'guard.json'), JSON.stringify(javaGuard([rule])));
        const input = writeInput(dir, 'src/main/java/A.java', 'class A {}\n');
        assert.equal(spawnHook(JSON.stringify(input)).status, 0);
        assert.throws(() => compileGuardRules([rule]), (e) => e.code === 'CATALOG' && /SC-TYPE/.test(e.message));
      }
    } finally {
      cleanup(dir);
    }
  });

  test('Edit changing only the URL of a static final constant is not blocked', () => {
    const r = run([CONST_RULE], URL_FILE, edit({ old_string: '"http://a"', new_string: '"http://b"' }));
    assert.equal(r.exitCode, 0);
  });

  test('Edit dropping static final is blocked with exact line number', () => {
    const r = run([CONST_RULE], URL_FILE, edit({ old_string: 'private static final String U', new_string: 'private String U' }));
    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /\[SC-CONST\] src\/A\.java:2:/);
  });

  test('Edit changing a Map value type is blocked', () => {
    const files = { '/p/src/A.java': 'Map<String, String> m;\n' };
    const r = run([MAP_RULE], files, edit({ old_string: 'String>', new_string: 'Object>' }));
    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /\[SC-MAP\] src\/A\.java:1:/);
  });

  test('replace_all replaces every occurrence', () => {
    const files = { '/p/src/A.java': 'Map<String, String> a;\nMap<String, String> b;\n' };
    const r = run([MAP_RULE], files, edit({ old_string: 'String>', new_string: 'Object>', replace_all: true }));
    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /A\.java:1:[\s\S]*A\.java:2:/);
  });

  test('MultiEdit whose later edit removes an earlier violation is not blocked', () => {
    const files = { '/p/src/A.java': 'Map<String, String> m;\n' };
    const input = {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: '/p/src/A.java',
        edits: [
          { old_string: 'String>', new_string: 'Object>' },
          { old_string: 'Object>', new_string: 'Integer>' },
        ],
      },
    };
    assert.equal(run([MAP_RULE], files, input).exitCode, 0);
  });

  test('Edit falls back to the fragment when old_string is not found', () => {
    const files = { '/p/src/A.java': 'int a;\n' };
    const r = run([MAP_RULE], files, edit({ old_string: 'nope', new_string: 'Map<String, Object> m;' }));
    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /A\.java:~1:/);
  });

  test('unreadable existing file fails open (standalone readFile rethrows non-ENOENT)', () => {
    const dir = makeProject(guardOn);
    try {
      // the target path is a directory: readFileSync throws EISDIR, not ENOENT
      mkdirSync(join(dir, 'src', 'main', 'java', 'A.java'), { recursive: true });
      const input = writeInput(dir, 'src/main/java/A.java', 'JsonNode x;');
      assert.equal(spawnHook(JSON.stringify(input)).status, 0);
    } finally {
      cleanup(dir);
    }
    const throwing = (p) => {
      if (p.endsWith('guard.json')) return JSON.stringify(guardOn);
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    };
    const w = { tool_name: 'Write', tool_input: { file_path: '/p/src/A.java', content: 'JsonNode x;' } };
    assert.equal(runHook(w, { env: { CLAUDE_PROJECT_DIR: '/p' }, readFile: throwing }).exitCode, 0);
  });

  test('path traversal out of the project is treated as outside', () => {
    const readFile = (p) => (p.endsWith('guard.json') ? JSON.stringify(guardOn) : null);
    const w = (file_path) => ({ tool_name: 'Write', tool_input: { file_path, content: 'JsonNode x;' } });
    assert.equal(runHook(w('/p/../q/src/A.java'), { env: { CLAUDE_PROJECT_DIR: '/p' }, readFile }).exitCode, 0);
    assert.equal(runHook(w('/p/src/../src/A.java'), { env: { CLAUDE_PROJECT_DIR: '/p' }, readFile }).exitCode, 2);
  });
});

describe('CRLF files', () => {
  const IMPORT_RULE = {
    id: 'SC-TYPE',
    globs: ['**/*.java'],
    excludeGlobs: [],
    regex: String.raw`^(?!\s*(import\s|\*|//|/\*)).*\b(JsonNode|ObjectNode)\b`,
    flags: '',
    message: 'm',
  };
  const lf = 'package a;\nimport x.Y;\n\nclass A {\n  void f() {}\n  void g() {}\n}\n';
  const guard = JSON.stringify({ version: 1, enabled: true, rules: [IMPORT_RULE] });
  const hookOn = (cur, toolInput) =>
    runHook(
      { tool_name: 'Edit', tool_input: { file_path: '/p/src/A.java', ...toolInput } },
      { env: { CLAUDE_PROJECT_DIR: '/p' }, readFile: (p) => (p.endsWith('guard.json') ? guard : p === '/p/src/A.java' ? cur : null) },
    );
  const add = { old_string: '  void f() {}\n  void g() {}', new_string: '  void f() {}\n  JsonNode g() { return null; }' };
  const imp = { old_string: 'x.Y;\n\nclass', new_string: 'com.fasterxml.jackson.databind.JsonNode;\n\nclass' };

  test('LF old_string against a CRLF file yields exact line numbers (no ~)', () => {
    const crlf = lf.replaceAll('\n', '\r\n');
    const r = hookOn(crlf, add);
    assert.equal(r.exitCode, 2);
    assert.match(r.stderr, /A\.java:6: /);
    assert.doesNotMatch(r.stderr, /:~/);
    assert.deepEqual(newLines('Edit', add, crlf), [{ line: 6, text: '  JsonNode g() { return null; }' }]);
  });

  test('mid-line import edit is allowed on CRLF exactly as on LF', () => {
    assert.equal(hookOn(lf, imp).exitCode, 0);
    assert.equal(hookOn(lf.replaceAll('\n', '\r\n'), imp).exitCode, 0);
  });

  test('CRLF new_string is normalized too', () => {
    const crlf = lf.replaceAll('\n', '\r\n');
    const e = { old_string: add.old_string, new_string: add.new_string.replaceAll('\n', '\r\n') };
    assert.deepEqual(newLines('Edit', e, crlf), [{ line: 6, text: '  JsonNode g() { return null; }' }]);
  });
});
