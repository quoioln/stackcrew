import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CONVENTION_DEFAULTS } from '../src/conventions.js';

// Release hygiene for 0.2.0: no credentials, nothing the test runner would pick up, docs that cannot contradict themselves.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const read = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === '.git') return [];
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [rel(full)];
  });
}

test('no credentials in URLs under catalog/, fixtures/ and the generated plugin/', () => {
  const CRED_URL = /\/\/[^/\s:@]+:[^@\s]+@/;
  // Positive control: the pattern does catch a credential, so zero hits is meaningful.
  assert.match('https://user:secret@host.example/repo.git', CRED_URL);
  assert.doesNotMatch('https://host.example/a:b and user@host', CRED_URL);

  const hits = [];
  let scanned = 0;
  for (const dir of ['catalog', 'fixtures', 'plugin', '.claude-plugin']) {
    for (const file of walk(path.join(root, dir))) {
      scanned += 1;
      const lines = read(file).split('\n');
      lines.forEach((line, i) => {
        if (CRED_URL.test(line)) hits.push(`${file}:${i + 1}`);
      });
    }
  }
  assert.ok(scanned > 200, `scanned ${scanned} files`);
  assert.deepEqual(hits, []);
});

// `node --test` default patterns (Node 22): *.test.*, *-test.*, *_test.*, test-*.*, test.* and anything under a test/ directory,
// for .js .mjs .cjs and, with type stripping on by default, .ts .mts .cts.
const RUNNER_NAME = [/\.test\.[cm]?[jt]s$/, /-test\.[cm]?[jt]s$/, /_test\.[cm]?[jt]s$/, /^test-.*\.[cm]?[jt]s$/, /^test\.[cm]?[jt]s$/];
const RUNNABLE = /\.[cm]?[jt]s$/;
const picked = (file) => file.split('/').slice(0, -1).includes('test') && RUNNABLE.test(file)
  || RUNNER_NAME.some((re) => re.test(file.split('/').at(-1)));

test('the runner-safety matcher recognises what node --test would run', () => {
  for (const f of ['a/b.test.ts', 'a/b-test.mjs', 'a/b_test.cts', 'a/test-x.js', 'a/test.ts', 'a/test/x.ts', 'test/fixtures/x/y.mjs']) assert.ok(picked(f), f);
  for (const f of ['a/b.spec.ts', 'a/b.test.ts.md', 'a/contest.ts', 'a/latest.js', 'a/testing/x.ts', 'a/test-x.md', 'a/x.tsx']) assert.ok(!picked(f), f);
});

test('no file under catalog/, fixtures/, plugin/ or test/fixtures/ matches the node --test default patterns', () => {
  const found = [];
  for (const dir of ['catalog', 'fixtures', 'plugin']) {
    for (const file of walk(path.join(root, dir))) if (picked(file)) found.push(file);
  }
  // test/fixtures lives under a test/ directory, so no script file of any kind may sit there.
  for (const file of walk(path.join(root, 'test', 'fixtures'))) if (RUNNABLE.test(file)) found.push(file);
  assert.deepEqual(found, []);
});

test('release version is 0.2.0 everywhere it is written', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.equal(version, '0.2.0');
  assert.equal(JSON.parse(read('plugin', '.claude-plugin', 'plugin.json')).version, version);
  assert.equal(JSON.parse(read('.claude-plugin', 'marketplace.json')).plugins[0].version, version);
});

test('rendered plugin init skill does not contradict itself in the final summary', () => {
  for (const text of [read('plugin', 'skills', 'init', 'SKILL.md'), read('catalog', 'skills', 'stackcrew-init', 'SKILL.md')]) {
    const section = text.slice(text.indexOf('## 8. Summarize'), text.indexOf('## Re-profile'));
    assert.ok(section.length > 100, 'found step 8');
    assert.ok(section.includes('/stackcrew:sync') && section.includes('/stackcrew:add') && section.includes('/stackcrew:check'));
    assert.match(section, /sync\|add\|check/, 'the plain CLI is offered where there are no slash commands');
    // Any prohibition in this step must not forbid the very command it tells the user to run.
    for (const sentence of section.split(/(?<=\.)\s+/).filter((s) => /\bNever\b/.test(s))) {
      assert.doesNotMatch(sentence, /\bnode\b|CLAUDE_PLUGIN_ROOT|stackcrew\.js/, `contradictory prohibition: ${sentence}`);
    }
    assert.match(section, /plugin cache/, 'the plugin cache path itself is still never printed as advice');
  }
  // The plugin copy runs the bundled CLI through ${CLAUDE_PLUGIN_ROOT}; the catalog copy stays a placeholder.
  assert.ok(read('plugin', 'skills', 'init', 'SKILL.md').includes('${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js'));
  assert.ok(read('catalog', 'skills', 'stackcrew-init', 'SKILL.md').includes('{{sc:cli}} sync|add|check'));
});

test('init interview: ESLint config names are the full list, rolesClaim is asked even without multi-tenancy', () => {
  const init = read('catalog', 'skills', 'stackcrew-init', 'SKILL.md');
  assert.ok(!init.includes('eslint.config.*'), 'eslint.config.* hides which files are edited');
  assert.ok(init.includes('eslint.config.js|mjs|ts|mts'));

  const topic = init.slice(init.indexOf('10. **Project conventions**'), init.indexOf('Stop interviewing'));
  assert.ok(topic.length > 500, 'found topic 10');
  assert.doesNotMatch(topic, /next two items/);
  const tenant = topic.slice(topic.indexOf('**Tenant claim**'), topic.indexOf('**Roles claim**'));
  assert.match(tenant, /not multi-tenant/);
  assert.match(tenant, /`crossTenantRoles`/, 'the skip names crossTenantRoles explicitly');
  assert.ok(!tenant.includes('rolesClaim'), 'rolesClaim is not skipped');
  const roles = topic.slice(topic.indexOf('**Roles claim**'), topic.indexOf('**Cross-tenant roles**'));
  assert.match(roles, /Still ask|Ask this even/);
  assert.match(roles, /not multi-tenant/);
  const cross = topic.slice(topic.indexOf('**Cross-tenant roles**'), topic.indexOf('**Shared components'));
  assert.match(cross, /not multi-tenant/);
});

test('sync command doc lists every TypeScript --wire exit-1 case of src/wire/node.js', () => {
  const sync = read('catalog', 'plugin-commands', 'sync.md');
  assert.ok(!sync.includes('eslint.config.*'));
  assert.ok(sync.includes('eslint.config.js|mjs|ts|mts'));
  for (const [what, re] of [
    ['package.json missing or invalid', /`package\.json` is missing or invalid/],
    ['config present, no eslint dependency', /ESLint config exists but `package\.json` has no `eslint` dependency/],
    ['ESLint older than 8 or unparsable', /`eslint` version is older than 8 or cannot be read/],
    ['ESLint 9 with only a legacy config', /ESLint 9 or later with only a legacy `\.eslintrc\*` file/],
    ['ESLint 8 with no config', /ESLint 8 with no ESLint config/],
    ['unsupported config shape', /shape that cannot be edited automatically/],
  ]) assert.match(sync, re, what);
  // "no file is changed" is scoped: the ESLint config and package.json, not the rest of sync.
  assert.match(sync, /`package\.json` and the ESLint config files? are left untouched/);
  assert.match(sync, /the rest of `sync` still writes its owned files/);
});

test('README and manual checklist cover the 0.2.0 stacks and golden tasks', () => {
  const readme = read('README.md');
  for (const needle of ['NestJS', 'Next.js', 'Quy ước dự án (`conventions`)', 'rolesClaim', 'crossTenantRoles', 'sync --wire', '/stackcrew:sync', 'BaseEntity', 'LOG_MASK_FIELDS', 'eslint.config.mjs', 'Lên 0.2.0']) {
    assert.ok(readme.includes(needle), `README: ${needle}`);
  }
  // every convention key is documented with its default
  for (const [key, def] of Object.entries(CONVENTION_DEFAULTS)) {
    const row = readme.split('\n').find((l) => l.startsWith(`| \`${key}\` |`));
    assert.ok(row, `README row for ${key}`);
    assert.ok(row.includes(`\`${JSON.stringify(def)}\``), `README default of ${key}: ${row}`);
  }
  const checklist = read('docs', 'manual-checklist.md');
  for (const needle of ['N1. NestJS: consumer RabbitMQ', 'N2. NestJS: endpoint khách hàng', 'N3. Next.js: form eKYC']) assert.ok(checklist.includes(needle), `checklist: ${needle}`);
});
