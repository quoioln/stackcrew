import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StackcrewError } from '../src/errors.js';
import { parseFrontmatter, stringifyFrontmatter } from '../src/util/frontmatter.js';
import { fillTemplate } from '../src/util/template.js';
import { toPosix, globToRegExp, matchesAny } from '../src/util/glob.js';
import { sha256, toLf } from '../src/util/hash.js';

test('StackcrewError carries code and name', () => {
  const e = new StackcrewError('CATALOG', 'boom');
  assert.equal(e.code, 'CATALOG');
  assert.equal(e.name, 'StackcrewError');
  assert.equal(e.message, 'boom');
  assert.ok(e instanceof Error);
});

test('parseFrontmatter parses scalars, lists, booleans and body', () => {
  const r = parseFrontmatter('---\nname: a\npaths:\n  - "**/*.java"\nflag: true\nlist: [x, y]\n---\nBody');
  assert.deepEqual(r.data, { name: 'a', paths: ['**/*.java'], flag: true, list: ['x', 'y'] });
  assert.equal(r.body, 'Body');
});

test('parseFrontmatter without leading --- returns whole text as body', () => {
  assert.deepEqual(parseFrontmatter('hello'), { data: {}, body: 'hello' });
});

test('parseFrontmatter throws FRONTMATTER on unterminated block', () => {
  assert.throws(() => parseFrontmatter('---\nname: a\n'), (e) => e.code === 'FRONTMATTER');
});

test('parseFrontmatter handles CRLF and single quotes', () => {
  const r = parseFrontmatter("---\r\nname: 'x y'\r\nfalse1: false\r\n---\r\nB");
  assert.deepEqual(r.data, { name: 'x y', false1: false });
  assert.equal(r.body, 'B');
});

test('stringifyFrontmatter quotes specials and round-trips', () => {
  assert.equal(stringifyFrontmatter([['globs', '**/*.java']]), '---\nglobs: "**/*.java"\n---\n');
  const text = stringifyFrontmatter([['globs', '**/*.java,**/*.kt'], ['alwaysApply', false]]);
  assert.deepEqual(parseFrontmatter(text + 'B').data, { globs: '**/*.java,**/*.kt', alwaysApply: false });
  assert.equal(stringifyFrontmatter([['a', 'plain'], ['b', ''], ['c', ' x'], ['d', true]]),
    '---\na: plain\nb: ""\nc: " x"\nd: true\n---\n');
});

test('stringifyFrontmatter writes arrays as block lists', () => {
  const text = stringifyFrontmatter([['paths', ['**/*.java', 'src']]]);
  assert.equal(text, '---\npaths:\n  - "**/*.java"\n  - "src"\n---\n');
  assert.deepEqual(parseFrontmatter(text).data, { paths: ['**/*.java', 'src'] });
});

test('fillTemplate replaces only {{sc:name}}', () => {
  assert.equal(fillTemplate('Hi {{sc:stackName}} {{ title }} ${VAR}', { stackName: 'Spring Boot' }), 'Hi Spring Boot {{ title }} ${VAR}');
  assert.throws(() => fillTemplate('{{sc:nope}}', {}), (e) => e.code === 'TEMPLATE' && /nope/.test(e.message));
});

test('fillTemplate rejects malformed placeholders and non-string values', () => {
  for (const bad of ['{{sc:stack-name}}', '{{sc: stackName}}', '{{sc:stackName }}', '{{sc:}}']) {
    assert.throws(() => fillTemplate(bad, { stackName: 'X' }), (e) => e.code === 'TEMPLATE', bad);
  }
  assert.throws(() => fillTemplate('{{sc:n}}', { n: undefined }), (e) => e.code === 'TEMPLATE' && /n/.test(e.message));
  assert.throws(() => fillTemplate('{{sc:n}}', { n: 5 }), (e) => e.code === 'TEMPLATE');
});

test('frontmatter round-trips backslash, double quote and colon values', () => {
  const entries = [['a', 'x\\y "z"'], ['b', 'k: v'], ['c', ['p\\q', 'r"s', 'u: w']]];
  const data = parseFrontmatter(stringifyFrontmatter(entries)).data;
  assert.deepEqual(data, { a: 'x\\y "z"', b: 'k: v', c: ['p\\q', 'r"s', 'u: w'] });
});

test('glob matching', () => {
  assert.equal(matchesAny('src/main/java/a/B.java', ['**/*.java']), true);
  assert.equal(matchesAny('B.java', ['**/*.java']), true);
  assert.equal(matchesAny('./B.java', ['**/*.java']), true);
  assert.equal(matchesAny('src\\main\\java\\B.java', ['src/main/**']), true);
  assert.equal(matchesAny('web/a.tsx', ['**/*.{ts,tsx}']), true);
  assert.equal(matchesAny('src/test/java/X.java', ['**/src/test/**']), true);
  assert.equal(matchesAny('a.javax', ['**/*.java']), false);
  assert.equal(matchesAny('a/b.java', ['*.java']), false);
  assert.equal(matchesAny('A.JAVA', ['**/*.java']), false);
  assert.equal(matchesAny('ab.c', ['a?.c']), true);
  assert.equal(matchesAny('x', []), false);
  assert.ok(globToRegExp('a.b') instanceof RegExp);
  assert.equal(globToRegExp('a.b').test('axb'), false);
  assert.equal(toPosix('a\\b\\c'), 'a/b/c');
});

test('hash is LF-normalized', () => {
  assert.equal(toLf('a\r\nb'), 'a\nb');
  assert.equal(sha256('a\r\nb'), sha256('a\nb'));
  assert.match(sha256('x'), /^[0-9a-f]{64}$/);
});
