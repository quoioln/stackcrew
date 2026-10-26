import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { main } from '../src/cli.js';

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

async function tmp() {
  const d = await mkdtemp(path.join(tmpdir(), 'stackcrew-cmd-'));
  tmpDirs.push(d);
  return d;
}

async function run(cwd, ...argv) {
  let out = '';
  let err = '';
  const io = {
    cwd,
    isTTY: false,
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  };
  const code = await main(argv, io);
  return { code, out, err };
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const CORE = '.claude/rules/stackcrew/core.md';

test('init with flags writes profile and rendered files', async () => {
  const dir = await tmp();
  const r = await run(dir, 'init', '--stack', 'demo-java');
  assert.equal(r.code, 0, r.err + r.out);
  for (const f of ['stackcrew.json', CORE, '.stackcrew/manifest.json']) {
    assert.ok(existsSync(path.join(dir, f)), `${f} should exist`);
  }
  assert.match(r.out, /stackcrew sync: \d+ written, \d+ unchanged, \d+ deleted, \d+ block\(s\) updated/);
  assert.match(r.out, /hint: run `stackcrew sync --wire`/);
  assert.match(r.out, /next: with the stackcrew Claude Code plugin installed, run \/stackcrew:init for the architecture interview \(without the plugin, Claude Code has no interview skill; see README\)/);
  assert.match(r.out, /next: ask your agent to use the skill stackcrew-init/);
  const profile = await readJson(path.join(dir, 'stackcrew.json'));
  assert.equal(profile.stack, 'demo-java');
  assert.equal(profile.mode, 'greenfield');
});

test('init accepts a stack alias case-insensitively', async () => {
  const dir = await tmp();
  const r = await run(dir, 'init', '--stack', 'DEMO', '--tools', 'claude');
  assert.equal(r.code, 0, r.err);
  assert.equal((await readJson(path.join(dir, 'stackcrew.json'))).stack, 'demo-java');
  assert.ok(!r.out.includes('ask your agent'));
});

test('init rejects an unknown stack and unknown flags', async () => {
  const dir = await tmp();
  const a = await run(dir, 'init', '--stack', 'nope');
  assert.equal(a.code, 1);
  assert.match(a.err, /Available: demo-java/);
  const b = await run(dir, 'init', '--bogus');
  assert.equal(b.code, 1);
  assert.match(b.err, /Usage: stackcrew init/);
});

test('init twice without --force exits 1', async () => {
  const dir = await tmp();
  assert.equal((await run(dir, 'init', '--stack', 'demo-java')).code, 0);
  const r = await run(dir, 'init', '--stack', 'demo-java');
  assert.equal(r.code, 1);
  assert.match(r.err, /already initialized/);
  assert.match(r.err, /stackcrew sync/);
  assert.equal((await run(dir, 'init', '--stack', 'demo-java', '--force')).code, 0);
});

test('init without stack in non-TTY empty dir exits 1 listing stacks', async () => {
  const dir = await tmp();
  const r = await run(dir, 'init');
  assert.equal(r.code, 1);
  assert.match(r.err, /no stack detected; pass --stack <id>\. Available: demo-java/);
  assert.ok(!existsSync(path.join(dir, 'stackcrew.json')));
});

test('init detects stack from pom', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'pom.xml'), '<project><dependency>org.springframework.boot</dependency></project>\n');
  const r = await run(dir, 'init');
  assert.equal(r.code, 0, r.err);
  const profile = await readJson(path.join(dir, 'stackcrew.json'));
  assert.equal(profile.stack, 'demo-java');
  assert.equal(profile.mode, 'brownfield');
});

test('init --addons "" means no addons even when one is detected', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'pom.xml'), '<project>org.springframework.boot kafka</project>\n');
  const detected = await run(dir, 'init');
  assert.equal(detected.code, 0, detected.err);
  assert.deepEqual((await readJson(path.join(dir, 'stackcrew.json'))).addons, ['demo-addon']);
  const none = await run(dir, 'init', '--force', '--addons', '');
  assert.equal(none.code, 0, none.err);
  assert.deepEqual((await readJson(path.join(dir, 'stackcrew.json'))).addons, []);
});

test('sync without a profile exits 1 telling to run init', async () => {
  const r = await run(await tmp(), 'sync');
  assert.equal(r.code, 1);
  assert.match(r.err, /run `stackcrew init` first/);
});

test('sync --wire without a base package exits 1 and writes nothing', async () => {
  const dir = await tmp();
  await run(dir, 'init', '--stack', 'demo-java');
  const before = await readFile(path.join(dir, CORE), 'utf8');
  const r = await run(dir, 'sync', '--wire');
  assert.equal(r.code, 1);
  assert.match(r.err, /set java.basePackage in stackcrew.json/);
  assert.equal(await readFile(path.join(dir, CORE), 'utf8'), before);
});

test('sync refuses hand-edited generated file (exit 1) and --force fixes it', async () => {
  const dir = await tmp();
  await run(dir, 'init', '--stack', 'demo-java');
  const file = path.join(dir, CORE);
  const original = await readFile(file, 'utf8');
  const edited = original + '\nMY HAND EDIT\n';
  await writeFile(file, edited);

  const refused = await run(dir, 'sync');
  assert.equal(refused.code, 1);
  assert.ok(refused.out.includes(`skipped (edited by hand): ${CORE}`), refused.out);
  assert.match(refused.out, /re-run with --force \(your edits will be lost\) or move them to \.stackcrew\/custom\//);
  assert.equal(await readFile(file, 'utf8'), edited);

  const forced = await run(dir, 'sync', '--force');
  assert.equal(forced.code, 0, forced.err + forced.out);
  assert.equal(await readFile(file, 'utf8'), original);
});

test('sync --dry-run writes nothing', async () => {
  const dir = await tmp();
  await run(dir, 'init', '--stack', 'demo-java');
  await rm(path.join(dir, CORE));
  const r = await run(dir, 'sync', '--dry-run');
  assert.equal(r.code, 0, r.err);
  assert.ok(!existsSync(path.join(dir, CORE)));
});

test('sync removes rules of a removed addon', async () => {
  const dir = await tmp();
  await run(dir, 'init', '--stack', 'demo-java', '--addons', 'demo-addon');
  const addonFiles = async () => {
    const manifest = await readJson(path.join(dir, '.stackcrew/manifest.json'));
    return Object.keys(manifest.files).filter((p) => p.includes('addon-demo-addon'));
  };
  const rendered = await addonFiles();
  assert.ok(rendered.length > 0, 'addon files should be rendered');
  for (const f of rendered) assert.ok(existsSync(path.join(dir, f)));

  const profile = await readJson(path.join(dir, 'stackcrew.json'));
  profile.addons = [];
  await writeFile(path.join(dir, 'stackcrew.json'), JSON.stringify(profile, null, 2));
  const r = await run(dir, 'sync');
  assert.equal(r.code, 0, r.err + r.out);
  for (const f of rendered) assert.ok(!existsSync(path.join(dir, f)), `${f} should be deleted`);
  assert.deepEqual(await addonFiles(), []);
});

test('add appends addon and re-renders', async () => {
  const dir = await tmp();
  await run(dir, 'init', '--stack', 'demo-java');
  const r = await run(dir, 'add', 'demo-addon', 'demo-addon');
  assert.equal(r.code, 0, r.err + r.out);
  assert.deepEqual((await readJson(path.join(dir, 'stackcrew.json'))).addons, ['demo-addon']);
  const manifest = await readJson(path.join(dir, '.stackcrew/manifest.json'));
  assert.ok(Object.keys(manifest.files).some((p) => p.includes('addon-demo-addon')));
});

test('add rejects addon not applicable to stack', async () => {
  const catalogCopy = await tmp();
  await cp(MINI, catalogCopy, { recursive: true });
  const addonDir = path.join(catalogCopy, 'addons', 'demo-addon');
  const addon = await readJson(path.join(addonDir, 'addon.json'));
  const other = path.join(catalogCopy, 'addons', 'py-addon');
  await cp(addonDir, other, { recursive: true });
  await writeFile(path.join(other, 'addon.json'), JSON.stringify({ ...addon, id: 'py-addon', languages: ['python'] }));

  const dir = await tmp();
  await run(dir, 'init', '--stack', 'demo-java');
  const before = await readFile(path.join(dir, 'stackcrew.json'), 'utf8');
  process.env.STACKCREW_CATALOG_DIR = catalogCopy;
  try {
    const r = await run(dir, 'add', 'py-addon');
    assert.equal(r.code, 1);
    assert.match(r.err, /does not apply to language "java"/);
  } finally {
    process.env.STACKCREW_CATALOG_DIR = MINI;
  }
  assert.equal(await readFile(path.join(dir, 'stackcrew.json'), 'utf8'), before);

  const unknown = await run(dir, 'add', 'nope');
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /unknown addon "nope"/);
});

test('list and detect print expected lines', async () => {
  const dir = await tmp();
  const list = await run(dir, 'list');
  assert.equal(list.code, 0);
  assert.match(list.out, /demo-java {2}Demo Java {2}backend {2}min 17/);
  assert.match(list.out, /demo-addon {2}Demo Addon {2}languages: java/);

  await writeFile(path.join(dir, 'pom.xml'), '<project>org.springframework.boot kafka</project>\n');
  const detect = await run(dir, 'detect');
  assert.equal(detect.code, 0);
  assert.match(detect.out, /^stack: demo-java$/m);
  assert.match(detect.out, /^addons: demo-addon$/m);
  assert.match(detect.out, /^mode: brownfield$/m);
});

test('custom rule in .stackcrew/custom is rendered for claude and cursor', async () => {
  const dir = await tmp();
  await mkdir(path.join(dir, '.stackcrew/custom'), { recursive: true });
  await writeFile(
    path.join(dir, '.stackcrew/custom/team-naming.md'),
    '---\ntitle: Team naming\nglobs: ["**/*.java"]\n---\n\n## Essentials\n- Use team prefix CUSTOMMARK.\n',
  );
  const r = await run(dir, 'init', '--stack', 'demo-java');
  assert.equal(r.code, 0, r.err + r.out);
  for (const f of ['.claude/rules/stackcrew/custom-team-naming.md', '.cursor/rules/stackcrew/custom-team-naming.mdc']) {
    assert.ok((await readFile(path.join(dir, f), 'utf8')).includes('CUSTOMMARK'), f);
  }
});

test('init --force keeps decisions, context, conventions and java settings', async () => {
  const dir = await tmp();
  await run(dir, 'init', '--stack', 'demo-java');
  const p = await readJson(path.join(dir, 'stackcrew.json'));
  p.decisions = [{ id: 'd1', area: 'db', decision: 'postgres', rationale: 'r', rejected: ['mysql'] }];
  p.context = { team: 'payments' };
  p.java = { basePackage: 'com.acme.app', wired: true };
  p.conventions = { baseEntity: 'AuditedEntity', crossTenantRoles: [] };
  await writeFile(path.join(dir, 'stackcrew.json'), JSON.stringify(p, null, 2));
  const r = await run(dir, 'init', '--force', '--stack', 'demo-java', '--tools', 'claude');
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /overwriting existing stackcrew\.json \(kept: decisions, context, conventions, java\/node settings\)/);
  const q = await readJson(path.join(dir, 'stackcrew.json'));
  assert.deepEqual(q.decisions, p.decisions);
  assert.deepEqual(q.context, p.context);
  assert.equal(q.java.basePackage, 'com.acme.app');
  assert.deepEqual(q.conventions, p.conventions);
  assert.deepEqual(q.tools, ['claude']);
});

test('init --force never force-overwrites hand-edited generated files', async () => {
  const dir = await tmp();
  await run(dir, 'init', '--stack', 'demo-java');
  const file = path.join(dir, CORE);
  const edited = (await readFile(file, 'utf8')) + '\nMY HAND EDIT\n';
  await writeFile(file, edited);
  const r = await run(dir, 'init', '--force', '--stack', 'demo-java');
  assert.equal(r.code, 1);
  assert.ok(r.out.includes(`skipped (edited by hand): ${CORE}`), r.out);
  assert.equal(await readFile(file, 'utf8'), edited);
});

const SHADOW = /claude-md-shadows-agents-md: creating CLAUDE\.md makes recent Claude Code versions stop reading your existing AGENTS\.md; add "@AGENTS\.md" to CLAUDE\.md yourself/;

test('warns when creating CLAUDE.md would shadow an AGENTS.md with team rules', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'AGENTS.md'), '# Team rules\n\nUse tabs.\n');
  const r = await run(dir, 'init', '--stack', 'demo-java', '--tools', 'claude');
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, SHADOW);
  assert.ok(existsSync(path.join(dir, 'CLAUDE.md')));
  assert.ok(!(await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).includes('@AGENTS.md'), 'must not add @AGENTS.md');
  const again = await run(dir, 'sync');
  assert.doesNotMatch(again.out, SHADOW, 'CLAUDE.md exists now: no warning');
});

test('no shadow warning with an existing .claude/CLAUDE.md, without AGENTS.md, or with only a stackcrew block', async () => {
  const sdlc = await tmp();
  await mkdir(path.join(sdlc, '.claude'));
  await writeFile(path.join(sdlc, '.claude/CLAUDE.md'), '## SDLC Workflow\n');
  await writeFile(path.join(sdlc, 'AGENTS.md'), '# Team rules\n');
  const a = await run(sdlc, 'init', '--stack', 'demo-java', '--tools', 'claude');
  assert.doesNotMatch(a.out, SHADOW);

  const none = await tmp();
  const b = await run(none, 'init', '--stack', 'demo-java', '--tools', 'claude');
  assert.doesNotMatch(b.out, SHADOW);

  const own = await tmp();
  await writeFile(path.join(own, 'AGENTS.md'), '<!-- stackcrew:begin -->\nold\n<!-- stackcrew:end -->\n');
  const c = await run(own, 'init', '--stack', 'demo-java', '--tools', 'claude');
  assert.doesNotMatch(c.out, SHADOW);

  const noClaude = await tmp();
  await writeFile(path.join(noClaude, 'AGENTS.md'), '# Team rules\n');
  const d = await run(noClaude, 'init', '--stack', 'demo-java', '--tools', 'codex');
  assert.doesNotMatch(d.out, SHADOW);
});

test('sync reports only changed blocks', async () => {
  const dir = await tmp();
  const first = await run(dir, 'init', '--stack', 'demo-java');
  assert.match(first.out, /[1-9]\d* block\(s\) updated/);
  const again = await run(dir, 'sync');
  assert.match(again.out, /\b0 block\(s\) updated/);
});

test('sync rejects a bad conventions block before writing', async () => {
  const dir = await tmp();
  await run(dir, 'init', '--stack', 'demo-java');
  const p = await readJson(path.join(dir, 'stackcrew.json'));
  p.conventions = { baseEnity: 'X', baseEntity: 'Base Entity' };
  await writeFile(path.join(dir, 'stackcrew.json'), JSON.stringify(p, null, 2));
  const before = await readFile(path.join(dir, CORE), 'utf8');
  await rm(path.join(dir, CORE));
  const r = await run(dir, 'sync');
  assert.equal(r.code, 1);
  assert.match(r.err, /conventions\.baseEntity/);
  assert.match(r.err, /unknown key "baseEnity"/);
  assert.equal(existsSync(path.join(dir, CORE)), false, 'nothing is written');
  assert.ok(before.length > 0);
});
