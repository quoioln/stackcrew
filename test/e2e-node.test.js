import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// End-to-end checks for the NestJS and Next.js stacks, mirroring test/e2e.test.js (Spring Boot).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'bin', 'stackcrew.js');
const hookJs = path.join(root, 'src', 'guard', 'hook.js');

const BEGIN = '<!-- stackcrew:begin';
const END = '<!-- stackcrew:end -->';
const TOOLS = 'claude,cursor,codex,antigravity';
const FLAT_IMPORT = "import stackcrewConfig from './.stackcrew/lint/eslint.stackcrew.mjs';";

/**
 * Per-stack e2e configuration.
 * `addons` is what the fixture itself uses; `allAddons` is every add-on that applies to the stack.
 * `seeded` lists the violations planted in `file`, as [rule id, line matcher] pairs.
 */
const STACKS = {
  nestjs: {
    fixture: 'nestjs-minimal',
    addons: 'rabbitmq,typeorm',
    allAddons: 'kafka,observability,rabbitmq,typeorm',
    file: 'src/modules/customer/customer.service.ts',
    copy: 'src/modules/customer/customer-copy.service.ts',
    rename: (s) => s.replaceAll('CustomerService', 'CustomerCopyService').replaceAll('CustomerRow', 'CustomerCopyRow'),
    seeded: [['SC-TYPEFILE', /^interface CustomerCopyRow/], ['SC-TYPE', /: any;/]],
    skillFiles: [
      'stackcrew-nest-request-logging/body-masker.ts.md',
      'stackcrew-nest-typeorm-entity/base.entity.ts.md',
      'stackcrew-nest-rabbitmq-consumer/work-queue.ts.md',
      'stackcrew-nest-rest-endpoint/customer-profiles.controller.ts.md',
      'stackcrew-nest-outbound-client/provider-call.policy.ts.md',
    ],
    skills: ['stackcrew-nest-request-logging', 'stackcrew-nest-typeorm-entity', 'stackcrew-nest-rest-endpoint', 'stackcrew-nest-outbound-client', 'stackcrew-nest-rabbitmq-consumer', 'stackcrew-nestjs-testing'],
    rules: ['stack-nestjs', 'stack-nestjs-testing', 'lang-typescript', 'addon-typeorm', 'addon-rabbitmq'],
  },
  nextjs: {
    fixture: 'nextjs-minimal',
    addons: 'typeorm',
    allAddons: 'kafka,observability,rabbitmq,typeorm',
    file: 'src/app/register/actions.ts',
    copy: 'src/app/register-copy/actions.ts',
    rename: (s) => s.replaceAll('RegisterInput', 'RegisterCopyInput'),
    seeded: [['SC-TYPEFILE', /^export interface RegisterCopyInput/], ['SC-ENV', /process\.env\.API_URL/]],
    skillFiles: [
      'stackcrew-next-request-logging/with-action-logging.ts.md',
      'stackcrew-next-typeorm-entity/audit.subscriber.ts.md',
      'stackcrew-next-server-action/actions.ts.md',
      'stackcrew-next-feature-page/data-table.tsx.md',
      'stackcrew-next-route-handler/route.ts.md',
    ],
    skills: ['stackcrew-next-request-logging', 'stackcrew-next-typeorm-entity', 'stackcrew-next-server-action', 'stackcrew-next-route-handler', 'stackcrew-next-feature-page', 'stackcrew-nextjs-testing'],
    rules: ['stack-nextjs', 'stack-nextjs-testing', 'lang-typescript', 'addon-typeorm'],
  },
};
const SPRING = { fixture: 'spring-boot-minimal', allAddons: 'kafka,camel,observability,rabbitmq' };

// The real catalog is under test: the override variable must not leak into the child.
function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.STACKCREW_CATALOG_DIR;
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

/** Temp copy of a fixture, git-initialised on main. */
function project(t, fixtureName) {
  const dir = mkdtempSync(path.join(tmpdir(), 'stackcrew-e2e-node-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(path.join(root, 'fixtures', fixtureName), dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}

function init(dir, stack, addons) {
  const r = run(dir, 'init', '--stack', stack, '--addons', addons, '--tools', TOOLS);
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
const write = (dir, rel, text) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
};

function hook(dir, toolInput) {
  const payload = { tool_name: 'Write', cwd: dir, tool_input: toolInput };
  return spawnSync(process.execPath, [hookJs], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: childEnv({ CLAUDE_PROJECT_DIR: dir }),
  });
}

const lineOf = (text, re) => text.split('\n').findIndex((l) => re.test(l)) + 1;

for (const [id, s] of Object.entries(STACKS)) {
  test(`${id}: init all tools renders the expected file set, both ESLint variants included`, (t) => {
    const dir = project(t, s.fixture);
    const pkgBefore = read(dir, 'package.json');
    const r = init(dir, id, s.addons);

    const expected = [
      '.claude/rules/stackcrew/core.md',
      '.claude/rules/stackcrew/core-persistence.md',
      '.claude/rules/stackcrew/core-type-safety.md',
      ...s.rules.map((x) => `.claude/rules/stackcrew/${x}.md`),
      ...s.rules.map((x) => `.cursor/rules/stackcrew/${x}.mdc`),
      ...s.rules.map((x) => `.agents/rules/stackcrew-${x}.md`),
      `.agents/skills/stackcrew-${id}-rules/SKILL.md`,
      ...s.skills.flatMap((k) => [`.claude/skills/${k}/SKILL.md`, `.agents/skills/${k}/SKILL.md`]),
      ...s.skillFiles.flatMap((f) => [`.claude/skills/${f}`, `.agents/skills/${f}`]),
      `.claude/agents/stackcrew-${id}-developer.md`,
      `.claude/agents/stackcrew-${id}-tester.md`,
      `.codex/agents/stackcrew-${id}-developer.toml`,
      `.agents/agents/stackcrew-${id}-developer.md`,
      'docs/stackcrew/architecture-profile.md',
      '.stackcrew/guard.json',
      '.stackcrew/lint/eslint.stackcrew.mjs',
      '.stackcrew/lint/eslintrc.stackcrew.cjs',
      '.stackcrew/ci/Jenkinsfile.stackcrew.groovy',
      'stackcrew.json',
      'AGENTS.md',
      'CLAUDE.md',
    ];
    const files = walk(dir);
    for (const p of expected) assert.ok(existsSync(path.join(dir, p)), `missing ${p}`);
    // skill code ships as <file>.md, so the project's compiler, linter and the guard never see it as TypeScript
    assert.deepEqual(files.filter((p) => /^\.(claude|agents|cursor)\/skills\/.*\.(ts|tsx|js|mjs|cjs)$/.test(p)), []);
    assert.deepEqual(files.filter((p) => p.startsWith('docs/sdlc/')), []);
    assert.ok(r.stdout.includes('cursor-duplicate-skills'), r.stdout);
    // plain init never edits the project's own build or lint files
    assert.equal(read(dir, 'package.json'), pkgBefore);
    assert.deepEqual(JSON.parse(read(dir, 'stackcrew.json')).node, { wired: false });
    // both variants are rendered; only `sync --wire` picks one
    assert.ok(read(dir, '.stackcrew/lint/eslint.stackcrew.mjs').includes('export default ['));
    assert.ok(read(dir, '.stackcrew/lint/eslintrc.stackcrew.cjs').includes('module.exports'));
    assert.deepEqual(JSON.parse(read(dir, '.stackcrew/guard.json')).rules.map((x) => x.id).filter((x) => /^SC-(TYPE|ENV|IGNORE|CONST|TYPEFILE)$/.test(x)).sort(),
      ['SC-CONST', 'SC-ENV', 'SC-IGNORE', 'SC-TYPE', 'SC-TYPEFILE']);
  });

  test(`${id}: check flags every seeded violation by rule id`, (t) => {
    const dir = project(t, s.fixture);
    init(dir, id, s.addons);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');

    const clean = run(dir, 'check', '--base', 'main');
    assert.equal(clean.status, 0, clean.stderr + clean.stdout);

    git(dir, 'checkout', '-q', '-b', 'feature');
    const content = s.rename(read(dir, s.file));
    write(dir, s.copy, content);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feature');

    const bad = run(dir, 'check', '--base', 'main');
    assert.equal(bad.status, 1, bad.stderr + bad.stdout);
    for (const [rule, re] of s.seeded) {
      const n = lineOf(content, re);
      assert.ok(n > 0, `seed line for ${rule} not found in the fixture`);
      assert.ok(bad.stdout.includes(`${s.copy}:${n} [${rule}]`), `${rule} at ${s.copy}:${n}\n${bad.stdout}`);
    }
    assert.match(bad.stdout, new RegExp(`stackcrew check: ${s.seeded.length} violation\\(s\\)`));
  });

  // Calls src/guard/hook.js directly; the plugin-wired path (hooks.json) is covered by manual checklist L4.
  test(`${id}: hook blocks writing the seeded content, and a same-line waiver lets it through`, (t) => {
    const dir = project(t, s.fixture);
    init(dir, id, s.addons);
    const content = s.rename(read(dir, s.file));
    const target = path.join(dir, s.copy);

    const blocked = hook(dir, { file_path: target, content });
    assert.equal(blocked.status, 2, blocked.stderr);
    for (const [rule] of s.seeded) assert.match(blocked.stderr, new RegExp(`\\[${rule}\\]|\\(${rule}\\)`), `${rule} in\n${blocked.stderr}`);

    const waived = content
      .split('\n')
      .map((l) => {
        const hit = s.seeded.find(([, re]) => re.test(l));
        return hit ? `${l} // stackcrew-allow: ${hit[0]} seeded fixture line` : l;
      })
      .join('\n');
    const ok = hook(dir, { file_path: target, content: waived });
    assert.equal(ok.status, 0, ok.stderr);
  });

  test(`${id}: sync is idempotent`, (t) => {
    const dir = project(t, s.fixture);
    init(dir, id, s.addons);
    const second = run(dir, 'sync');
    assert.equal(second.status, 0, second.stderr + second.stdout);
    assert.match(second.stdout, /stackcrew sync: 0 written, /);
  });
}

test('nextjs: sync --wire edits eslint.config.mjs in place and sets node.wired', (t) => {
  const dir = project(t, STACKS.nextjs.fixture);
  init(dir, 'nextjs', STACKS.nextjs.addons);
  const before = read(dir, 'eslint.config.mjs');
  const pkgBefore = read(dir, 'package.json');

  const r = run(dir, 'sync', '--wire');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /wired: eslint\.config\.mjs/);

  const after = read(dir, 'eslint.config.mjs');
  assert.equal(after, `${FLAT_IMPORT}\n${before.replace('export default eslintConfig;', 'const stackcrewBaseConfig = eslintConfig;')}export default [...[stackcrewBaseConfig].flat(), ...stackcrewConfig];\n`);
  assert.equal(read(dir, 'package.json'), pkgBefore, 'ESLint is already a dependency: package.json stays as it is');
  assert.deepEqual(JSON.parse(read(dir, 'stackcrew.json')).node, { wired: true });
  assert.ok(existsSync(path.join(dir, '.stackcrew/lint/eslint.stackcrew.mjs')), 'the imported file exists');
  assert.doesNotMatch(r.stdout, /hint: run `stackcrew sync --wire`/);

  const again = run(dir, 'sync', '--wire');
  assert.equal(again.status, 0, again.stderr + again.stdout);
  assert.equal(read(dir, 'eslint.config.mjs'), after, 'a wired config is left alone');
  assert.match(again.stdout, /stackcrew sync: 0 written, /);
});

test('nestjs: sync --wire adds the ESLint devDependencies and creates eslint.config.mjs', (t) => {
  const dir = project(t, STACKS.nestjs.fixture);
  init(dir, 'nestjs', STACKS.nestjs.addons);
  assert.ok(!existsSync(path.join(dir, 'eslint.config.mjs')));
  const pkgBefore = JSON.parse(read(dir, 'package.json'));
  assert.equal(pkgBefore.devDependencies.eslint, undefined);

  const r = run(dir, 'sync', '--wire');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /wired: package\.json/);
  assert.match(r.stdout, /wired: eslint\.config\.mjs/);
  assert.match(r.stdout, /install/);

  const pkg = JSON.parse(read(dir, 'package.json'));
  for (const dep of ['eslint', '@eslint/js', 'typescript-eslint']) assert.ok(pkg.devDependencies[dep], `devDependencies.${dep}`);
  assert.deepEqual(pkg.dependencies, pkgBefore.dependencies);
  assert.equal(pkg.devDependencies.typescript, pkgBefore.devDependencies.typescript);
  const cfg = read(dir, 'eslint.config.mjs');
  assert.ok(cfg.includes(FLAT_IMPORT));
  assert.ok(cfg.includes('...stackcrewConfig'));
  assert.deepEqual(JSON.parse(read(dir, 'stackcrew.json')).node, { wired: true });

  const again = run(dir, 'sync', '--wire');
  assert.equal(again.status, 0, again.stderr + again.stdout);
  assert.equal(read(dir, 'eslint.config.mjs'), cfg);
  assert.deepEqual(JSON.parse(read(dir, 'package.json')), pkg);
});

// Numbers measured on the real catalog (bytes, 0.2.0 content), every applicable add-on, all four tools:
//   spring-boot (kafka, camel, observability, rabbitmq): AGENTS.md block 13113, reduced to 3 bullets per rule
//   nestjs (kafka, observability, rabbitmq, typeorm):    AGENTS.md block 12907, reduced to 3 bullets per rule
//   nextjs (kafka, observability, rabbitmq, typeorm):    AGENTS.md block 13419, reduced to 3 bullets per rule
//   nestjs (rabbitmq, typeorm) only:                      AGENTS.md block 15540, full Essentials (no warning)
//   nextjs (typeorm) only:                                AGENTS.md block 15354, full Essentials (no warning)
// A project with every add-on exceeds 16,000 bytes at full Essentials, so the R24 degrade is expected there.
const BUDGET_CASES = [
  ['spring-boot', SPRING.fixture, SPRING.allAddons, true],
  ['nestjs', STACKS.nestjs.fixture, STACKS.nestjs.allAddons, true],
  ['nextjs', STACKS.nextjs.fixture, STACKS.nextjs.allAddons, true],
  ['nestjs', STACKS.nestjs.fixture, STACKS.nestjs.addons, false],
  ['nextjs', STACKS.nextjs.fixture, STACKS.nextjs.addons, false],
];

for (const [id, fixtureName, addons, reduced] of BUDGET_CASES) {
  test(`budgets hold on the real ${id} render with add-ons ${addons}${reduced ? ' (Essentials reduced)' : ' (full Essentials)'}`, (t) => {
    const dir = project(t, fixtureName);
    const r = init(dir, id, addons);
    assert.doesNotMatch(r.stdout + r.stderr, /BUDGET/);
    if (reduced) assert.match(r.stdout, /agents-md-essentials-reduced: 3 bullet\(s\) per rule/, r.stdout);
    else assert.doesNotMatch(r.stdout, /agents-md-essentials-reduced/);

    const agents = read(dir, 'AGENTS.md');
    const begin = agents.indexOf(BEGIN);
    const end = agents.indexOf(END);
    assert.ok(begin >= 0 && end > begin, 'AGENTS.md has a stackcrew block');
    const block = agents.slice(begin, end + END.length);
    assert.ok(Buffer.byteLength(block) <= 16000, `AGENTS.md block is ${Buffer.byteLength(block)} bytes`);

    const files = walk(dir);
    assert.ok(Buffer.byteLength(read(dir, '.claude/rules/stackcrew/core.md')) <= 6000, 'always-on stays within 6000 bytes');
    const mdc = files.filter((p) => p.startsWith('.cursor/rules/stackcrew/') && p.endsWith('.mdc'));
    assert.ok(mdc.length > 0);
    let maxLines = 0;
    for (const p of mdc) {
      const lines = read(dir, p).split('\n').length;
      maxLines = Math.max(maxLines, lines);
      assert.ok(lines <= 500, `${p} has ${lines} lines`);
    }
    const ag = files.filter((p) => p.startsWith('.agents/rules/stackcrew-'));
    assert.ok(ag.length > 0);
    let maxBytes = 0;
    for (const p of ag) {
      const bytes = Buffer.byteLength(read(dir, p));
      maxBytes = Math.max(maxBytes, bytes);
      assert.ok(bytes <= 24000, `${p} is ${bytes} bytes`);
    }
    t.diagnostic(`${id} [${addons}]: AGENTS.md block ${Buffer.byteLength(block)} B, Cursor max ${maxLines} lines, Antigravity max ${maxBytes} B`);
  });
}

// M8: what the developer role preloads. Claude Code injects each listed skill's SKILL.md (not its sibling files)
// into the subagent at start, so the sum is the fixed cost of one developer run. Measured, not limited.
for (const [id, fixtureName, addons] of [
  ['spring-boot', SPRING.fixture, SPRING.allAddons],
  ['nestjs', STACKS.nestjs.fixture, STACKS.nestjs.allAddons],
  ['nextjs', STACKS.nextjs.fixture, STACKS.nextjs.allAddons],
]) {
  test(`developer role preload is measurable for ${id}`, (t) => {
    const dir = project(t, fixtureName);
    init(dir, id, addons);
    const agent = read(dir, `.claude/agents/stackcrew-${id}-developer.md`);
    const names = [...agent.matchAll(/^ {2}- "([^"]+)"$/gm)].map((m) => m[1]);
    assert.ok(names.length >= 5, `developer preloads ${names.length} skills`);
    let total = 0;
    const parts = names.map((n) => {
      const bytes = Buffer.byteLength(read(dir, `.claude/skills/${n}/SKILL.md`));
      assert.ok(bytes > 0, n);
      total += bytes;
      return `${n}=${bytes}`;
    });
    t.diagnostic(`${id} developer preload: ${total} B across ${names.length} SKILL.md (${parts.join(', ')})`);
  });
}
