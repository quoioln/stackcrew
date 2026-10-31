import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { main } from '../src/cli.js';
import {
  ESLINT_DEPS,
  FLAT_CONFIG_FILES,
  LEGACY_CONFIG_FILES,
  FLAT_IMPORT,
  LEGACY_EXTENDS,
  eslintMajor,
  planNodeWiring,
} from '../src/wire/node.js';

const MINI = fileURLToPath(new URL('./fixtures/catalog-mini', import.meta.url));
const savedEnv = process.env.STACKCREW_CATALOG_DIR;
const tmpDirs = [];
before(() => {
  process.env.STACKCREW_CATALOG_DIR = MINI;
});
after(async () => {
  if (savedEnv === undefined) delete process.env.STACKCREW_CATALOG_DIR;
  else process.env.STACKCREW_CATALOG_DIR = savedEnv;
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

const pkgWith = (devDependencies, extra = {}) => JSON.stringify({ name: 'x', devDependencies, ...extra }, null, 2) + '\n';
const edit = (r, p) => r.edits.find((e) => e.path === p);

test('constants: caret ranges, lookup orders and wire strings', () => {
  assert.deepEqual(Object.keys(ESLINT_DEPS), ['eslint', '@eslint/js', 'typescript-eslint']);
  assert.match(ESLINT_DEPS.eslint, /^\^9\.\d+\.\d+$/);
  assert.match(ESLINT_DEPS['@eslint/js'], /^\^9\.\d+\.\d+$/);
  assert.match(ESLINT_DEPS['typescript-eslint'], /^\^8\.\d+\.\d+$/);
  assert.deepEqual(FLAT_CONFIG_FILES, ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts']);
  assert.deepEqual(LEGACY_CONFIG_FILES, ['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml', '.eslintrc.json', '.eslintrc']);
  assert.equal(FLAT_IMPORT, "import stackcrewConfig from './.stackcrew/lint/eslint.stackcrew.mjs';");
  assert.equal(LEGACY_EXTENDS, './.stackcrew/lint/eslintrc.stackcrew.cjs');
});

test('eslintMajor reads the first integer of the dependency range', () => {
  assert.equal(eslintMajor({ devDependencies: { eslint: '^9.21.0' } }), 9);
  assert.equal(eslintMajor({ dependencies: { eslint: '~8.57.1' } }), 8);
  assert.equal(eslintMajor({ dependencies: { eslint: '8.0.0' }, devDependencies: { eslint: '^9.0.0' } }), 8);
  assert.equal(eslintMajor({ devDependencies: { eslint: '>=9' } }), 9);
  assert.equal(eslintMajor({ devDependencies: { eslint: 'latest' } }), null);
  assert.equal(eslintMajor({ devDependencies: {} }), null);
  assert.equal(eslintMajor({}), null);
});

test('no eslint dependency and no config: adds the dependencies and creates eslint.config.mjs', () => {
  const r = planNodeWiring({ packageJson: pkgWith({ typescript: '^5.6.0' }), configs: {} });
  assert.deepEqual(r.wired, ['package.json', 'eslint.config.mjs']);
  const pkg = JSON.parse(edit(r, 'package.json').content);
  assert.deepEqual(Object.keys(pkg.devDependencies), ['@eslint/js', 'eslint', 'typescript', 'typescript-eslint']);
  assert.equal(pkg.devDependencies.eslint, ESLINT_DEPS.eslint);
  assert.ok(edit(r, 'package.json').content.endsWith('}\n'));
  const cfg = edit(r, 'eslint.config.mjs').content;
  assert.ok(cfg.startsWith('// Created by stackcrew sync --wire. This file is yours to edit.\n'));
  assert.ok(cfg.includes(FLAT_IMPORT));
  for (const g of ['dist/**', '.next/**', 'coverage/**', 'node_modules/**']) assert.ok(cfg.includes(`'${g}'`), g);
  assert.ok(cfg.includes('js.configs.recommended,') && cfg.includes('...tseslint.configs.recommended,') && cfg.includes('...stackcrewConfig,'));
  assert.ok(cfg.includes('export default [\n  { ignores: ['));
  assert.ok(!cfg.includes('defineConfig') && !cfg.includes('globalIgnores') && !cfg.includes('eslint/config'), 'plain array: works on every ESLint 9.x');
  assert.ok(r.notes.some((n) => n === "run your package manager's install (npm install / yarn / pnpm install) to install: eslint, @eslint/js, typescript-eslint"));
});

test('no eslint dependency: a dependency already declared is not added again', () => {
  const r = planNodeWiring({ packageJson: JSON.stringify({ dependencies: { 'typescript-eslint': '^8.1.0' } }), configs: {} });
  const pkg = JSON.parse(edit(r, 'package.json').content);
  assert.equal(pkg.dependencies['typescript-eslint'], '^8.1.0');
  assert.deepEqual(Object.keys(pkg.devDependencies), ['@eslint/js', 'eslint']);
  assert.match(r.notes.join('\n'), /to install: eslint, @eslint\/js$/m);
});

test('no eslint dependency but a config file: note, not wired', () => {
  for (const configs of [{ 'eslint.config.mjs': 'export default [];\n' }, { '.eslintrc.json': '{}' }]) {
    const r = planNodeWiring({ packageJson: pkgWith({}), configs });
    assert.deepEqual([r.edits, r.wired], [[], []]);
    assert.match(r.notes[0], /config found but no `eslint` dependency/);
  }
  const inPkg = planNodeWiring({ packageJson: pkgWith({}, { eslintConfig: { rules: {} } }), configs: {} });
  assert.deepEqual([inPkg.edits, inPkg.wired], [[], []]);
  assert.match(inPkg.notes[0], /config found but no `eslint` dependency/);
});

test('missing or unparseable package.json: note, not wired', () => {
  for (const packageJson of [undefined, '{ nope']) {
    const r = planNodeWiring({ packageJson, configs: {} });
    assert.deepEqual([r.edits, r.wired], [[], []]);
    assert.match(r.notes[0], /^package\.json: /);
  }
});

test('flat edit wraps the existing default export and imports the stackcrew config', () => {
  const src = "import next from 'eslint-config-next';\nconst eslintConfig = [...next];\nexport default eslintConfig;\n";
  const { edits, wired } = planNodeWiring({ packageJson: '{"devDependencies":{"eslint":"^9.21.0"}}', configs: { 'eslint.config.mjs': src } });
  assert.deepEqual(wired, ['eslint.config.mjs']);
  assert.equal(edits[0].content,
    "import stackcrewConfig from './.stackcrew/lint/eslint.stackcrew.mjs';\n" +
    "import next from 'eslint-config-next';\nconst eslintConfig = [...next];\nconst stackcrewBaseConfig = eslintConfig;\n" +
    "export default [...[stackcrewBaseConfig].flat(), ...stackcrewConfig];\n");
});

test('eslint >= 9 with a flat config in .js/.ts: first flat file in lookup order is edited; BOM and a missing final newline are handled', () => {
  const pkg = pkgWith({ eslint: '^9.0.0' });
  const js = planNodeWiring({ packageJson: pkg, configs: { 'eslint.config.js': 'export default [];', 'eslint.config.mjs': 'export default [];\n' } });
  assert.deepEqual(js.wired, ['eslint.config.js']);
  assert.equal(js.edits[0].content, `${FLAT_IMPORT}\nconst stackcrewBaseConfig = [];\nexport default [...[stackcrewBaseConfig].flat(), ...stackcrewConfig];\n`);
  const bom = planNodeWiring({ packageJson: pkg, configs: { 'eslint.config.ts': '﻿export default [];\n' } });
  assert.ok(bom.edits[0].content.startsWith(`﻿${FLAT_IMPORT}\nconst stackcrewBaseConfig = [];\n`));
  assert.deepEqual(bom.wired, ['eslint.config.ts']);
});

test('eslint >= 9 with a flat config of another shape: note with the snippet, not wired', () => {
  const pkg = pkgWith({ eslint: '^9.0.0' });
  const shapes = {
    'eslint.config.cjs': 'module.exports = [];\n',
    'eslint.config.cts': 'export default [];\n',
    'eslint.config.mjs': 'export default [];\nexport default [];\n',
    'eslint.config.js': 'const a = [];\nmodule.exports = a;\n',
    'eslint.config.ts': 'const a = [];\n',
  };
  for (const [file, text] of Object.entries(shapes)) {
    const r = planNodeWiring({ packageJson: pkg, configs: { [file]: text } });
    assert.deepEqual([r.edits, r.wired], [[], []], file);
    assert.ok(r.notes[0].includes(file), file);
    assert.ok(r.notes[0].includes(FLAT_IMPORT) && r.notes[0].includes('...stackcrewConfig'), file);
  }
  const both = planNodeWiring({ packageJson: pkg, configs: { 'eslint.config.js': 'module.exports = [];\n', 'eslint.config.mjs': 'export default [];\n' } });
  assert.deepEqual(both.wired, [], 'only the first flat file in lookup order counts');
});

test('eslint >= 9 with only legacy files: note says ESLint >= 9 reads flat config, not wired', () => {
  const r = planNodeWiring({ packageJson: pkgWith({ eslint: '^9.0.0' }), configs: { '.eslintrc.json': '{}' } });
  assert.deepEqual([r.edits, r.wired], [[], []]);
  assert.match(r.notes[0], /ESLint >= 9 reads flat config/);
  assert.ok(r.notes[0].includes(FLAT_IMPORT));
});

test('eslint >= 9 with no config: creates eslint.config.mjs, dependencies unchanged', () => {
  const pkg = pkgWith({ eslint: '^9.5.0', '@eslint/js': '^9.5.0', 'typescript-eslint': '^8.0.0' });
  const r = planNodeWiring({ packageJson: pkg, configs: {} });
  assert.deepEqual(r.wired, ['eslint.config.mjs']);
  assert.deepEqual(r.edits.map((e) => e.path), ['eslint.config.mjs']);
  assert.deepEqual(r.notes, []);
});

test('eslint >= 9 creating a config warns when the imported packages are not declared', () => {
  const r = planNodeWiring({ packageJson: pkgWith({ eslint: '^9.5.0' }), configs: {} });
  assert.deepEqual(r.wired, ['eslint.config.mjs']);
  assert.match(r.notes[0], /imports @eslint\/js, typescript-eslint/);
});

test('eslint 8 with .eslintrc.json: appends the stackcrew extends (string becomes an array)', () => {
  const pkg = pkgWith({ eslint: '^8.57.0' });
  const str = planNodeWiring({ packageJson: pkg, configs: { '.eslintrc.json': '{\n    "extends": "next"\n}\n' } });
  assert.deepEqual(str.wired, ['.eslintrc.json']);
  assert.equal(str.edits[0].content, `{\n    "extends": [\n        "next",\n        "${LEGACY_EXTENDS}"\n    ]\n}\n`);
  const arr = planNodeWiring({ packageJson: pkg, configs: { '.eslintrc.json': '{"extends":["a","b"],"root":true}' } });
  assert.deepEqual(JSON.parse(arr.edits[0].content), { extends: ['a', 'b', LEGACY_EXTENDS], root: true });
  const none = planNodeWiring({ packageJson: pkg, configs: { '.eslintrc.json': '{"root":true}' } });
  assert.deepEqual(JSON.parse(none.edits[0].content), { root: true, extends: [LEGACY_EXTENDS] });
});

test('eslint 8 with eslintConfig in package.json: same edit in package.json', () => {
  const pkg = pkgWith({ eslint: '^8.0.0' }, { eslintConfig: { extends: 'next' } });
  const r = planNodeWiring({ packageJson: pkg, configs: {} });
  assert.deepEqual(r.wired, ['package.json']);
  assert.deepEqual(JSON.parse(edit(r, 'package.json').content).eslintConfig, { extends: ['next', LEGACY_EXTENDS] });
});

test('eslint 8 with another legacy file, or JSONC that fails to parse: note with the extends snippet, not wired', () => {
  const pkg = pkgWith({ eslint: '^8.0.0' });
  for (const [file, text] of [['.eslintrc.js', 'module.exports = {};\n'], ['.eslintrc.yml', 'root: true\n'], ['.eslintrc.json', '{\n  // comment\n  "root": true\n}\n'], ['.eslintrc.json', '[]']]) {
    const r = planNodeWiring({ packageJson: pkg, configs: { [file]: text } });
    assert.deepEqual([r.edits, r.wired], [[], []], file);
    assert.ok(r.notes[0].includes(file) && r.notes[0].includes(LEGACY_EXTENDS), file);
  }
  const first = planNodeWiring({ packageJson: pkg, configs: { '.eslintrc.js': 'module.exports = {};\n', '.eslintrc.json': '{}' } });
  assert.deepEqual(first.wired, [], 'ESLint reads .eslintrc.js before .eslintrc.json');
});

test('eslint 8 with no config: note, not wired', () => {
  const r = planNodeWiring({ packageJson: pkgWith({ eslint: '^8.0.0' }), configs: {} });
  assert.deepEqual([r.edits, r.wired], [[], []]);
  assert.ok(r.notes[0].includes(LEGACY_EXTENDS));
});

test('unsupported ESLint version: eslint < 8', () => {
  const r = planNodeWiring({ packageJson: pkgWith({ eslint: '^7.32.0' }), configs: { 'eslint.config.mjs': 'export default [];\n' } });
  assert.deepEqual([r.edits, r.wired], [[], []]);
  assert.match(r.notes[0], /unsupported ESLint version "\^7\.32\.0"/);
  assert.ok(r.notes[0].includes(FLAT_IMPORT));
});

test('an eslint range with no digits: the note says the major cannot be read, not "unsupported"', () => {
  for (const eslint of ['latest', 'workspace:*', 'npm:@acme/eslint-fork']) {
    const r = planNodeWiring({ packageJson: pkgWith({ eslint }), configs: { 'eslint.config.mjs': 'export default [];\n' } });
    assert.deepEqual([r.edits, r.wired], [[], []], eslint);
    assert.ok(r.notes[0].startsWith(`cannot read the ESLint major from "${eslint}"`), r.notes[0]);
    assert.doesNotMatch(r.notes[0], /unsupported ESLint version/);
    assert.ok(r.notes[0].includes(FLAT_IMPORT), eslint);
  }
});

test('eslint >= 9 wrapping an existing flat config notes a missing typescript-eslint (not a failure)', () => {
  const src = 'export default [];\n';
  const bare = planNodeWiring({ packageJson: pkgWith({ eslint: '^9.0.0' }), configs: { 'eslint.config.mjs': src } });
  assert.deepEqual(bare.wired, ['eslint.config.mjs'], 'still wired');
  assert.equal(bare.edits.length, 1);
  assert.equal(bare.notes.length, 1);
  assert.match(bare.notes[0], /^eslint\.config\.mjs: the stackcrew rules use @typescript-eslint rules, but package\.json declares neither typescript-eslint nor @typescript-eslint\/eslint-plugin; install/);
  for (const dep of ['typescript-eslint', '@typescript-eslint/eslint-plugin']) {
    const dev = planNodeWiring({ packageJson: pkgWith({ eslint: '^9.0.0', [dep]: '^8.0.0' }), configs: { 'eslint.config.mjs': src } });
    assert.deepEqual([dev.wired, dev.notes], [['eslint.config.mjs'], []], `${dep} in devDependencies`);
    const prod = planNodeWiring({ packageJson: JSON.stringify({ devDependencies: { eslint: '^9.0.0' }, dependencies: { [dep]: '^8.0.0' } }), configs: { 'eslint.config.mjs': src } });
    assert.deepEqual([prod.wired, prod.notes], [['eslint.config.mjs'], []], `${dep} in dependencies`);
  }
});

test('wiring is idempotent', () => {
  const flat = `${FLAT_IMPORT}\nconst stackcrewBaseConfig = [];\nexport default [...[stackcrewBaseConfig].flat(), ...stackcrewConfig];\n`;
  const a = planNodeWiring({ packageJson: pkgWith({ eslint: '^9.0.0' }), configs: { 'eslint.config.mjs': flat } });
  assert.deepEqual([a.edits, a.wired, a.notes], [[], ['eslint.config.mjs'], []]);
  const json = `{"extends":["${LEGACY_EXTENDS}"]}`;
  const b = planNodeWiring({ packageJson: pkgWith({ eslint: '^8.0.0' }), configs: { '.eslintrc.json': json } });
  assert.deepEqual([b.edits, b.wired], [[], ['.eslintrc.json']]);
  const c = planNodeWiring({ packageJson: pkgWith({ eslint: '^8.0.0' }, { eslintConfig: { extends: [LEGACY_EXTENDS] } }), configs: {} });
  assert.deepEqual([c.edits, c.wired], [[], ['package.json']]);
  // the file the planner creates is itself already wired on the next run
  const created = planNodeWiring({ packageJson: pkgWith({}), configs: {} });
  const again = planNodeWiring({ packageJson: edit(created, 'package.json').content, configs: { 'eslint.config.mjs': edit(created, 'eslint.config.mjs').content } });
  assert.deepEqual([again.edits, again.wired], [[], ['eslint.config.mjs']]);
});

test('CRLF .eslintrc.json stays CRLF', () => {
  const src = '{\r\n  "extends": "next"\r\n}\r\n';
  const r = planNodeWiring({ packageJson: pkgWith({ eslint: '^8.0.0' }), configs: { '.eslintrc.json': src } });
  const out = r.edits[0].content;
  assert.ok(out.includes('\r\n') && !/[^\r]\n/.test(out), JSON.stringify(out));
  assert.equal(out, `{\r\n  "extends": [\r\n    "next",\r\n    "${LEGACY_EXTENDS}"\r\n  ]\r\n}\r\n`);
});

test('package.json rewrite keeps the file indent and BOM', () => {
  const tabs = planNodeWiring({ packageJson: '{\n\t"name": "x"\n}\n', configs: {} });
  assert.ok(edit(tabs, 'package.json').content.startsWith('{\n\t"name": "x",\n\t"devDependencies"'));
  const bom = planNodeWiring({ packageJson: '﻿{\n    "name": "x"\n}\n', configs: {} });
  assert.ok(edit(bom, 'package.json').content.startsWith('﻿{\n    "name": "x",\n    "devDependencies"'));
});

// ---------- CLI level ----------

async function tmp() {
  const d = await mkdtemp(path.join(tmpdir(), 'stackcrew-wire-node-'));
  tmpDirs.push(d);
  return d;
}
async function run(cwd, ...argv) {
  let out = '';
  let err = '';
  const io = { cwd, isTTY: false, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } };
  const code = await main(argv, io);
  return { code, out, err };
}
async function tsProject(files = {}) {
  const dir = await tmp();
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
  assert.equal((await run(dir, 'init', '--stack', 'demo-ts')).code, 0);
  return dir;
}
const read = (dir, name) => readFile(path.join(dir, name), 'utf8');
const profileOf = async (dir) => JSON.parse(await read(dir, 'stackcrew.json'));

test('sync --wire on a TypeScript project adds the dependencies and creates the ESLint config', async () => {
  const dir = await tsProject({ 'package.json': pkgWith({ typescript: '^5.6.0' }) });
  assert.equal((await profileOf(dir)).node.wired, false);
  const hint = await run(dir, 'sync');
  assert.match(hint.out, /hint: run `stackcrew sync --wire` to add the stackcrew rules to your ESLint config/);
  assert.doesNotMatch(hint.out, /checkstyle/);
  const r = await run(dir, 'sync', '--wire');
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /wired: package\.json/);
  assert.match(r.out, /wired: eslint\.config\.mjs/);
  assert.match(r.out, /note: run your package manager's install \(npm install \/ yarn \/ pnpm install\) to install: eslint, @eslint\/js, typescript-eslint/);
  assert.doesNotMatch(r.out, /checkstyle/);
  assert.ok(existsSync(path.join(dir, 'eslint.config.mjs')));
  assert.equal(JSON.parse(await read(dir, 'package.json')).devDependencies.eslint, ESLINT_DEPS.eslint);
  assert.equal((await profileOf(dir)).node.wired, true);
  const again = await run(dir, 'sync', '--wire');
  assert.equal(again.code, 0, again.err + again.out);
  assert.doesNotMatch(again.out, /wired: /);
  assert.doesNotMatch(again.out, /hint: run `stackcrew sync --wire`/);
});

test('sync --wire --dry-run on a TypeScript project writes nothing', async () => {
  const pkg = pkgWith({ typescript: '^5.6.0' });
  const dir = await tsProject({ 'package.json': pkg });
  const r = await run(dir, 'sync', '--wire', '--dry-run');
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /would wire: package\.json/);
  assert.equal(await read(dir, 'package.json'), pkg);
  assert.ok(!existsSync(path.join(dir, 'eslint.config.mjs')));
  assert.equal((await profileOf(dir)).node.wired, false);
});

test('unsupported ESLint config shapes print a snippet and write nothing', async () => {
  const cases = [
    { 'package.json': pkgWith({ eslint: '^9.0.0' }), 'eslint.config.cjs': 'module.exports = [];\n' },
    { 'package.json': pkgWith({ eslint: '^9.0.0' }), 'eslint.config.mjs': 'export default [];\nexport default [];\n' },
    { 'package.json': pkgWith({ eslint: '^8.57.0' }), '.eslintrc.yml': 'root: true\n' },
    { 'package.json': pkgWith({ eslint: '^8.57.0' }), '.eslintrc.json': '{\n  // comment\n  "root": true\n}\n' },
  ];
  for (const files of cases) {
    const dir = await tsProject(files);
    const profileBefore = await read(dir, 'stackcrew.json');
    const r = await run(dir, 'sync', '--wire');
    const label = Object.keys(files).join('+');
    assert.equal(r.code, 1, label + r.err + r.out);
    assert.match(r.out, /wire: ESLint could not be wired automatically; add this to your ESLint config and re-run `stackcrew sync --wire`:/, label);
    assert.match(r.out, /stackcrew\.stackcrew|eslint\.stackcrew\.mjs|eslintrc\.stackcrew\.cjs/, label);
    for (const [name, text] of Object.entries(files)) assert.equal(await read(dir, name), text, `${label}: ${name}`);
    assert.equal(await read(dir, 'stackcrew.json'), profileBefore, label);
  }
});

test('sync --wire on a TypeScript project validates the render before touching package.json', async () => {
  const pkg = pkgWith({ typescript: '^5.6.0' });
  const dir = await tsProject({ 'package.json': pkg });
  const agents = 'intro\n<!-- stackcrew:begin -->\nhalf\n';
  await writeFile(path.join(dir, 'AGENTS.md'), agents);
  const before = await read(dir, 'stackcrew.json');
  const r = await run(dir, 'sync', '--wire');
  assert.equal(r.code, 1, r.err + r.out);
  assert.equal(await read(dir, 'package.json'), pkg);
  assert.ok(!existsSync(path.join(dir, 'eslint.config.mjs')));
  assert.equal(await read(dir, 'stackcrew.json'), before);
  assert.equal(JSON.parse(before).node.wired, false);
  assert.equal(await read(dir, 'AGENTS.md'), agents);
});

test('sync --wire refuses a non-UTF-8 ESLint config and writes nothing', async () => {
  const pkg = pkgWith({ eslint: '^9.0.0' });
  const dir = await tsProject({ 'package.json': pkg });
  await writeFile(path.join(dir, 'eslint.config.js'), Buffer.from([0xff, 0xfe, 0x65, 0x00]));
  const r = await run(dir, 'sync', '--wire');
  assert.equal(r.code, 1);
  assert.match(r.err, /eslint\.config\.js: not UTF-8/);
  assert.equal(await read(dir, 'package.json'), pkg);
});
