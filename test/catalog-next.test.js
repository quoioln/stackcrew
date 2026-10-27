import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { validateCatalog } from '../src/catalog/validate.js';
import { detectProject } from '../src/detect.js';
import { compileGuardRules, scanLines } from '../src/guard/scan.js';
import { createProfile } from '../src/profile.js';
import { buildContext } from '../src/render/context.js';
import { renderProject } from '../src/render/index.js';
import { renderShared } from '../src/render/shared.js';
import { renderAgentsMdBlock } from '../src/render/agents-md.js';
import { parseFrontmatter } from '../src/util/frontmatter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEXT_DIR = path.join(ROOT, 'catalog', 'stacks', 'nextjs');
const OPTS = { cli: 'npx stackcrew', version: '0.0.0' };
const ALL = ['claude', 'cursor', 'codex', 'antigravity'];
const LOGGING = 'stackcrew-next-request-logging';
const ENTITY = 'stackcrew-next-typeorm-entity';
const SERVER_ACTION = 'stackcrew-next-server-action';
const FEATURE_PAGE = 'stackcrew-next-feature-page';
const ROUTE_HANDLER = 'stackcrew-next-route-handler';
const TESTING_SKILL = 'stackcrew-nextjs-testing';
const FEATURE_SKILLS = [SERVER_ACTION, FEATURE_PAGE, ROUTE_HANDLER];
const NEXT_SKILLS = [LOGGING, ENTITY, ...FEATURE_SKILLS];
const TEST_EXCLUDES = ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx', '**/test/**', '**/tests/**', '**/e2e/**', '**/__tests__/**'];
const ACTION_GLOBS = ['**/actions.ts', '**/*.actions.ts', '**/actions/**/*.ts'];

async function withRealCatalog(fn) {
  const saved = process.env.STACKCREW_CATALOG_DIR;
  delete process.env.STACKCREW_CATALOG_DIR;
  try {
    return await fn(await loadCatalog());
  } finally {
    if (saved !== undefined) process.env.STACKCREW_CATALOG_DIR = saved;
  }
}

async function withPackageJson(pkg, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sc-next-'));
  try {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg));
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const nextCtx = (c, { addons = [], conventions, tools = ALL } = {}) => {
  const profile = createProfile({ stack: 'nextjs', tools, mode: 'greenfield' }, c);
  profile.addons = addons;
  if (conventions) profile.conventions = conventions;
  return buildContext(c, profile, OPTS);
};

/** A sibling `<file>.ts.md` / `<file>.tsx.md`: "Goes to" line, then exactly one fenced block. */
const GOES_TO = /^Goes to `((?:src\/)?[^`]+\.tsx?)`\.\n\n```tsx?\n/;
const codeOfSibling = (md) => /```tsx?\n([\s\S]*?)```\n$/.exec(md ?? '')?.[1] ?? '';
const nextSkill = (c, name) => {
  const k = c.stacks.get('nextjs').skills.find((s) => s.name === name);
  return { body: k.body, files: k.files, file: (rel) => codeOfSibling(k.files.find((f) => f.relPath === `${rel}.md`)?.content) };
};
const renderedFile = (c, skill, rel, conventions) => codeOfSibling(
  nextCtx(c, { addons: ['typeorm'], conventions }).skills.find((k) => k.name === skill).files.find((f) => f.relPath === `${rel}.md`).content);

test('nextjs stack loads, validates, and gates the typeorm skill by its add-on', async () => {
  await withRealCatalog(async (c) => {
    assert.deepEqual(validateCatalog(c), []);
    const s = c.stacks.get('nextjs');
    assert.ok(s, 'nextjs stack exists');
    assert.equal(s.name, 'Next.js');
    assert.equal(s.category, 'fullstack');
    assert.equal(s.language, 'typescript');
    assert.equal(s.minVersion, '16.0');
    assert.deepEqual(s.globs, ['**/*.ts', '**/*.tsx']);
    assert.deepEqual(s.aliases, ['next']);
    assert.equal(s.priority, 25);
    assert.deepEqual(s.detect, { files: [], contains: [], excludeContains: [], packageDeps: ['next'] });
    assert.equal(s.rules.id, 'stack-nextjs');
    assert.equal(s.testing.id, 'stack-nextjs-testing');
    const byName = Object.fromEntries(s.skills.map((k) => [k.name, k]));
    assert.equal(byName[LOGGING].kind, 'task');
    assert.deepEqual(byName[LOGGING].requiresAddons, []);
    assert.equal(byName[ENTITY].kind, 'task');
    assert.deepEqual(byName[ENTITY].requiresAddons, ['typeorm']);
    for (const k of s.skills) {
      assert.deepEqual(k.paths, []);
      assert.ok(k.description.startsWith('Use when') && k.description.includes('Next.js'), k.name);
      assert.ok(k.description.length <= 500, k.name);
      assert.ok(!/always|any code|all code|every task|whenever the user|proactively/i.test(k.description), `${k.name} has a banned word`);
    }
    const names = (ctx) => ctx.skills.map((k) => k.name);
    assert.ok(names(nextCtx(c)).includes(LOGGING));
    assert.ok(!names(nextCtx(c)).includes(ENTITY), 'entity skill needs the typeorm add-on');
    assert.ok(names(nextCtx(c, { addons: ['typeorm'] })).includes(ENTITY));
    const ruleIds = nextCtx(c).rules.map((r) => r.id);
    for (const id of ['core-persistence', 'core-frontend', 'core-backend-api', 'lang-typescript']) assert.ok(ruleIds.includes(id), `fullstack stack gets ${id}`);
  });
});

test('nextjs detects only by exact package name and wins over nestjs', async () => {
  await withRealCatalog(async (c) => {
    await withPackageJson({ dependencies: { next: '^16.0.0', react: '^19.0.0' } }, async (dir) => {
      assert.equal((await detectProject(dir, c)).stack, 'nextjs');
    });
    await withPackageJson({ dependencies: { 'next-auth': '5.0.0-beta.30', 'next-themes': '^0.4.0' }, devDependencies: { 'eslint-config-next': '^16.0.0' } }, async (dir) => {
      assert.equal((await detectProject(dir, c)).stack, null);
    });
    await withPackageJson({ dependencies: { next: '^16.0.0', '@nestjs/core': '^10.4.0' } }, async (dir) => {
      assert.equal((await detectProject(dir, c)).stack, 'nextjs', 'priority 25 beats nestjs 20');
    });
    await withPackageJson({ dependencies: { next: '^16.0.0', typeorm: '^0.3.20', pg: '^8.13.0' } }, async (dir) => {
      const r = await detectProject(dir, c);
      assert.equal(r.stack, 'nextjs');
      assert.deepEqual(r.addons, ['typeorm']);
    });
    await withPackageJson({ name: 'plain-node' }, async (dir) => {
      assert.equal((await detectProject(dir, c)).stack, null);
    });
  });
});

test('next guard blocks a type declaration in actions files and honours typeFreeFiles', async () => {
  await withRealCatalog(async (c) => {
    const guard = c.stacks.get('nextjs').guard;
    assert.deepEqual(guard.map((r) => r.id), ['SC-TYPEFILE']);
    const [rule] = guard;
    assert.equal(rule.globsFrom, 'typeFreeFiles');
    assert.deepEqual(rule.globs, ACTION_GLOBS);
    assert.deepEqual(rule.excludeGlobs, TEST_EXCLUDES);
    assert.ok(rule.message.includes('stackcrew-allow: SC-TYPEFILE'), 'message names the waiver');
    for (const where of ['`schemas/`', '`*.types.ts`']) assert.ok(rule.message.includes(where), where);
    const compiled = compileGuardRules(guard);
    const scan = (file, text) => scanLines(file, [{ line: 1, text }], compiled).map((v) => v.ruleId);
    for (const file of ['src/features/orders/actions.ts', 'src/features/orders/order.actions.ts', 'src/features/orders/actions/create-order.ts', 'app/actions.ts']) {
      for (const line of ['export type CreateOrderInput = z.infer<typeof schema>;', 'interface Row { id: string }', 'export interface X {}', 'declare type Y = number;']) {
        assert.deepEqual(scan(file, line), ['SC-TYPEFILE'], `${file}: ${line}`);
      }
      for (const line of ["'use server';", 'export const createOrder = withActionLogging(\'createOrder\', async () => ok(1));', '  type: string;',
        'export type X = 1; // stackcrew-allow: SC-TYPEFILE generated']) {
        assert.deepEqual(scan(file, line), [], `${file}: ${line}`);
      }
    }
    assert.deepEqual(scan('src/features/orders/schemas/create-order.schema.ts', 'export type CreateOrderInput = z.infer<typeof createOrderSchema>;'), []);
    assert.deepEqual(scan('src/features/orders/order.types.ts', 'export type OrderId = string;'), []);
    assert.deepEqual(scan('src/features/orders/actions.spec.ts', 'type Fixture = { id: string };'), []);
    assert.deepEqual(scan('src/features/orders/transactions.ts', 'export type T = 1;'), [], 'a file merely ending in "actions" is not an actions file');
    const rendered = (conventions) => JSON.parse(renderShared(nextCtx(c, { conventions })).find((o) => o.path === '.stackcrew/guard.json').content);
    const byId = (g) => g.rules.find((r) => r.id === 'SC-TYPEFILE');
    assert.deepEqual(byId(rendered()).globs, ACTION_GLOBS);
    assert.deepEqual(byId(rendered({ typeFreeFiles: ['src/**/*.server.ts'] })).globs, ['src/**/*.server.ts']);
    assert.ok(rendered().rules.some((r) => r.id === 'SC-TYPE'), 'the TypeScript language guard comes along');
  });
});

test('next guard.json keeps its regex escapes byte-exact', async () => {
  const text = await readFile(path.join(NEXT_DIR, 'guard.json'), 'utf8');
  const BS = String.fromCharCode(92);
  const [rule] = JSON.parse(text).rules;
  assert.equal(rule.regex, `^(export${BS}s+)?(declare${BS}s+)?(interface|type)${BS}s+[A-Za-z_$][${BS}w$]*`);
  assert.equal(rule.flags, '');
  assert.ok(!text.includes(String.fromCharCode(8)), 'no raw backspace byte');
  assert.ok(!text.includes('\r'), 'LF only');
});

test('next rules render the shared components directory from conventions', async () => {
  await withRealCatalog(async (c) => {
    const body = (conventions) => nextCtx(c, { conventions }).rules.find((r) => r.id === 'stack-nextjs').body;
    assert.ok(body({ sharedComponents: 'app/ui' }).includes('`app/ui`'));
    assert.ok(body().includes('`src/components/ui`'), 'the default');
    assert.ok(!body({ sharedComponents: 'app/ui' }).includes('{{sc:'), 'no unrendered placeholder');
  });
});

test('nextjs cursor globs join without braces', async () => {
  await withRealCatalog(async (c) => {
    const { ops } = renderProject(nextCtx(c, { addons: ['typeorm'], tools: ['cursor'] }));
    const op = ops.find((o) => o.path === '.cursor/rules/stackcrew/stack-nextjs.mdc');
    assert.ok(op, 'stack rule rendered for cursor');
    assert.equal(parseFrontmatter(op.content).data.globs, '**/*.ts,**/*.tsx');
    for (const o of ops.filter((x) => x.path.endsWith('.mdc'))) assert.ok(!/globs: .*\{/.test(o.content), `${o.path} has a brace glob`);
  });
});

test('next rules: server components, server-only data, DTOs, typed action results, forms, shared components, env, TypeORM config', async () => {
  await withRealCatalog(async (c) => {
    const rules = c.stacks.get('nextjs').rules.body;
    for (const needle of ["'use client'", "import 'server-only'", 'z.infer', 'auth()', 'getRequestContext()', '{ ok: true, data }', '{ ok: false, error }',
      'revalidatePath', 'revalidateTag', 'withActionLogging', 'withRouteLogging', 'react-hook-form', 'zodResolver', '{{sc:sharedComponents}}', 'TanStack Table',
      'cn()', '@t3-oss/env-nextjs', 'zustand', 'loading.tsx', 'error.tsx', 'serverExternalPackages', "'typeorm'", 'globalThis', 'experimentalDecorators',
      '{{sc:tenantClaim}}', '{{sc:rolesClaim}}', 'core-logging', 'addon-typeorm', LOGGING, ENTITY, 'httpClient.fetch', 'onRequestError']) {
      assert.ok(rules.includes(needle), `rules.md missing ${needle}`);
    }
    assert.match(rules, /[Ee]ntities never reach the client/);
    assert.match(rules, /never (a |an )?entit/i);
    assert.ok(/ask (the user )?(first|before)/i.test(rules), 'new dependencies are asked for first');
    const testing = c.stacks.get('nextjs').testing.body;
    for (const needle of ['Vitest', 'Testing Library', 'vitest.int.config.ts', 'Playwright', '*.spec.ts', '*.spec.tsx', 'MissingTenantError', 'CROSS_TENANT_ROLES',
      '{{sc:systemUser}}', 'customer-profile.persistence.int.spec.ts.md', "'server-only'", 'async Server Component']) {
      assert.ok(testing.includes(needle), `testing.md missing ${needle}`);
    }
  });
});

test('next rule files have id, title and a bounded Essentials list', async () => {
  await withRealCatalog(async (c) => {
    const s = c.stacks.get('nextjs');
    for (const r of [s.rules, s.testing]) {
      assert.ok(r.title);
      const n = r.essentials.split('\n').filter((l) => /^- /.test(l)).length;
      assert.ok(n >= 5 && n <= 15, `${r.id} essentials ${n}`);
      assert.ok(Buffer.byteLength(r.body) < 24000, `${r.id} bytes`);
    }
  });
});

test('nextjs with typeorm and all four tools renders within every budget', async () => {
  await withRealCatalog(async (c) => {
    const ctx = nextCtx(c, { addons: ['typeorm'] });
    const { ops } = renderProject(ctx); // throws StackcrewError BUDGET when over
    assert.ok(Buffer.byteLength(renderAgentsMdBlock(ctx).op.content) <= 16000);
    for (const o of ops.filter((x) => x.path.startsWith('.cursor/rules/stackcrew/'))) assert.ok(o.content.split('\n').length <= 500, `${o.path} lines`);
    for (const o of ops.filter((x) => x.path.startsWith('.agents/rules/stackcrew-'))) assert.ok(Buffer.byteLength(o.content) <= 24000, `${o.path} bytes`);
    for (const name of [...NEXT_SKILLS, TESTING_SKILL]) assert.ok(ops.some((o) => o.path.includes(name)), `${name} is rendered`);
    for (const o of ops) assert.ok(!o.content.includes('{{sc:'), `${o.path} has an unrendered placeholder`);
  });
});

test('next skills are task skills under 350 lines; siblings are <file>.ts(x).md with a "Goes to" line and one code block', async () => {
  await withRealCatalog(async (c) => {
    for (const name of NEXT_SKILLS) {
      const k = c.stacks.get('nextjs').skills.find((s) => s.name === name);
      assert.equal(k.kind, 'task');
      assert.ok(k.body.split('\n').length <= 350, `${name} SKILL.md is ${k.body.split('\n').length} lines`);
      assert.ok(k.files.length > 0, `${name} has sibling files`);
      for (const f of k.files) {
        assert.ok(/\.tsx?\.md$/.test(f.relPath) && !f.relPath.includes('/'), `${name}/${f.relPath}`);
        assert.ok(!/\.test\.|[-_]test\.|^test[.-]/.test(f.relPath), `${name}/${f.relPath} matches a node --test pattern`);
        const goesTo = GOES_TO.exec(f.content);
        assert.ok(goesTo, `${name}/${f.relPath} starts with "Goes to" and the code block`);
        assert.equal(f.content.split('```').length, 3, `${name}/${f.relPath}: exactly one fenced block`);
        assert.ok(codeOfSibling(f.content).startsWith(`// Default location: ${goesTo[1]}`), `${name}/${f.relPath}: the code names the same location`);
        assert.ok(!f.content.includes('\r'), `${name}/${f.relPath} is LF`);
        if (/\.spec\.tsx?\.md$/.test(f.relPath)) assert.match(goesTo[1], /\.spec\.tsx?$/, `${f.relPath}: example tests are *.spec.ts(x)`);
      }
    }
  });
});

test('every next sibling file and code block passes the TypeScript and Next.js guards at its intended path, with one documented waiver', async () => {
  await withRealCatalog(async (c) => {
    const compiled = compileGuardRules([...c.languages.get('typescript').guard, ...c.stacks.get('nextjs').guard]);
    const ctx = nextCtx(c, { addons: ['typeorm'] });
    const scanned = [...NEXT_SKILLS, TESTING_SKILL];
    const skills = ctx.skills.filter((s) => scanned.includes(s.name));
    assert.equal(skills.length, scanned.length, 'every next skill is scanned');
    const sources = [];
    for (const k of skills) {
      for (const f of k.files) sources.push({ name: `${k.name}/${f.relPath}`, path: GOES_TO.exec(f.content)[1], text: codeOfSibling(f.content) });
    }
    const docs = [...skills.map((s) => [s.name, s.body]),
      ['stack-nextjs', ctx.rules.find((r) => r.id === 'stack-nextjs').body], ['stack-nextjs-testing', ctx.rules.find((r) => r.id === 'stack-nextjs-testing').body]];
    for (const [doc, md] of docs) {
      for (const m of md.matchAll(/```tsx?\n([\s\S]*?)```/g)) {
        const first = /^\/\/ (?:Default location: )?((?:src\/)?\S+\.tsx?)\b/.exec(m[1]);
        // a fragment without a path is checked as an actions file, where the guards are strictest
        sources.push({ name: `${doc} block`, path: first ? first[1] : 'src/features/example/actions.ts', text: m[1] });
      }
    }
    assert.ok(sources.length >= 30, `sources ${sources.length}`);
    for (const s of sources) {
      const lines = s.text.split('\n').map((text, i) => ({ line: i + 1, text }));
      const violations = scanLines(s.path, lines, compiled).map((v) => `${s.name}:${v.line} ${v.ruleId} ${v.text.trim()}`);
      assert.deepEqual(violations, [], s.name);
      // the one waiver: instrumentation.ts reads the build-time constant NEXT_RUNTIME so the Edge bundle drops the Node-only logger
      const waivers = s.text.split('\n').filter((line) => /stackcrew-allow|eslint-disable/.test(line));
      const expected = s.name.endsWith('/instrumentation.ts.md') ? 2 : 0;
      assert.equal(waivers.length, expected, `${s.name} waivers: ${waivers.join(' | ')}`);
    }
  });
});

test('next skill code passes the stackcrew ESLint rules the guard cannot see: no object type, no magic-number expressions', async () => {
  await withRealCatalog(async (c) => {
    const next = c.stacks.get('nextjs');
    const code = [];
    for (const k of next.skills) for (const f of k.files) code.push([`${k.name}/${f.relPath}`, codeOfSibling(f.content)]);
    for (const [doc, md] of [['stack-nextjs', next.rules.body], ['stack-nextjs-testing', next.testing.body], ...next.skills.map((k) => [k.name, k.body])]) {
      for (const m of md.matchAll(/```tsx?\n([\s\S]*?)```/g)) code.push([`${doc} block`, m[1]]);
    }
    for (const [name, text] of code) {
      const uncommented = text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/\/\/.*$/, ''));
      for (const line of uncommented) {
        assert.ok(!/(:\s*|<|extends\s+|,\s*|\|\s*)object\b(?!\s*[:.(])/.test(line), `${name}: object as a type: ${line.trim()}`);
        assert.ok(!/:\s*any\b|as any\b|<any>/.test(line), `${name}: any: ${line.trim()}`);
      }
      const isTest = /\.spec\.tsx?\.md$/.test(name) || /^\/\/ (Default location: )?\S*\.(spec|config)\.ts/.test(text);
      if (!isTest) assert.ok(!/\d\s*\*\s*\d/.test(uncommented.join('\n')), `${name}: a product of numeric literals where one literal belongs`);
    }
  });
});

test('next request logging: one line per action and route call, typed results, control flow, outbound client, onRequestError', async () => {
  await withRealCatalog(async (c) => {
    const s = nextSkill(c, LOGGING);
    const action = s.file('with-action-logging.ts');
    for (const needle of ['export function withActionLogging<A extends unknown[], R>(name: string, action: (...args: A) => Promise<R>): (...args: A) => Promise<R>',
      'writeCallLine(', 'nextControlFlow(', 'throw failure;', 'runWithRequestContext(', 'contextOfRequest()', 'LogEvent.HTTP_IN']) {
      assert.ok(action.includes(needle), `with-action-logging.ts missing ${needle}`);
    }
    const route = s.file('with-route-logging.ts');
    for (const needle of ['export function withRouteLogging<C>(route: string, handler: RouteHandler<C>): RouteHandler<C>', 'writeCallLine(', 'nextControlFlow(', '.clone()', 'shouldCapture(', 'capturedBody(']) {
      assert.ok(route.includes(needle), `with-route-logging.ts missing ${needle}`);
    }
    const control = s.file('next-control-flow.ts');
    assert.ok(!control.includes('unstable_rethrow(') && control.includes("'digest' in error"), 'control flow is read from the own digest of the thrown error (fix round 1)');
    const client = s.file('http-client.ts');
    for (const needle of ['export const httpClient', 'async fetch(target: string, input: string, init?: RequestInit): Promise<Response>', 'LogEvent.HTTP_OUT', 'sanitizeUrl(', '.clone()']) {
      assert.ok(client.includes(needle), `http-client.ts missing ${needle}`);
    }
    const instrumentation = s.file('instrumentation.ts');
    assert.ok(instrumentation.includes('export const onRequestError: Instrumentation.onRequestError') && instrumentation.includes('unhandled_error'), 'onRequestError logs unhandled errors');
    assert.ok(!/\.message\b/.test(instrumentation.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'the message is never logged');
    const result = s.file('action-result.ts');
    for (const needle of ['export type ActionResult<T>', '{ ok: true; data: T }', '{ ok: false; error: ActionError }', 'export const ActionErrorCode']) {
      assert.ok(result.includes(needle), `action-result.ts missing ${needle}`);
    }
    const env = s.file('env.ts');
    for (const needle of ["from '@t3-oss/env-nextjs'", 'LOG_MASK_FIELDS', 'LOG_MAX_BODY_BYTES', 'LOG_BODIES', 'LOG_LEVEL', "CROSS_TENANT_ROLES: z.string().default('{{sc:crossTenantRolesCsv}}')"]) {
      assert.ok(env.includes(needle), `env.ts missing ${needle}`);
    }
    assert.ok(renderedFile(c, LOGGING, 'env.ts').includes("CROSS_TENANT_ROLES: z.string().default('super_admin')"));
    assert.ok(renderedFile(c, LOGGING, 'env.ts', { crossTenantRoles: [] }).includes("CROSS_TENANT_ROLES: z.string().default('')"), 'no roles renders an empty default');
    assert.ok(s.file('logger.ts').includes('mixin: () => contextLogFields()'), 'pino adds the context ids to every line');
    for (const needle of ['withActionLogging', 'withRouteLogging', 'httpClient.fetch', 'onRequestError', 'getRequestContext()', 'runAsSystem', 'runCrossTenant',
      'redirect()', 'notFound()', 'body-masker.spec.ts', 'ask the user', 'proxy.ts']) {
      assert.ok(s.body.includes(needle), `SKILL.md missing ${needle}`);
    }
  });
});

test('next request context: only runAsSystem grants the system identity; RSC reads auth() through getRequestContext', async () => {
  await withRealCatalog(async (c) => {
    const s = nextSkill(c, LOGGING);
    const ctx = s.file('request-context.ts');
    assert.equal(ctx.match(/system: true/g)?.length, 1, 'system: true is set in one place');
    assert.match(ctx, /export function runAsSystem[^]*?system: true/, 'that place is runAsSystem');
    assert.equal(ctx.match(/crossTenant: true/g)?.length, 1, 'crossTenant: true is set only by runCrossTenant');
    assert.ok(ctx.includes('Object.freeze({ requestId: ctx.requestId, userId: ctx.userId, tenantId: ctx.tenantId, roles: Object.freeze([...ctx.roles]) })'));
    assert.ok(ctx.includes('tenantId: undefined, crossTenant: true'), 'cross-tenant work has no tenant to write with');
    assert.ok(!ctx.includes('=== SYSTEM_USER') && !ctx.includes('enterWith'));
    assert.ok(ctx.includes('/^[A-Za-z0-9._-]{1,64}$/') && ctx.includes('/^[\\x21-\\x7e]{1,128}$/'), 'header sanitizers match the other stacks');
    assert.ok(!ctx.includes("from 'next/"), 'the context core has no Next import: jobs and tests use it as is');
    const session = s.file('session-context.ts');
    for (const needle of ["import 'server-only';", "from 'react'", 'cache(', 'auth()', 'headers()', 'export async function getRequestContext(): Promise<RequestContext>',
      'export async function runInRequestContext<T>(', 'export function toAuthUser(session: unknown)']) {
      assert.ok(session.includes(needle), `session-context.ts missing ${needle}`);
    }
    const spec = s.file('request-context.spec.ts');
    for (const needle of ['never makes a token or header user named like the system user the system identity', 'runAsSystem(undefined', 'keeps concurrent contexts apart']) {
      assert.ok(spec.includes(needle), `request-context.spec.ts missing ${needle}`);
    }
    const actionSpec = s.file('with-action-logging.spec.ts');
    for (const needle of ["vi.mock('next/headers'", "vi.mock('../../auth'", 'redirect(', 'notFound(', 'UNAUTHENTICATED', 'VALIDATION', 'toHaveLength(1)', 'leaks no context']) {
      assert.ok(actionSpec.includes(needle), `with-action-logging.spec.ts missing ${needle}`);
    }
  });
});

test('next masker sibling is the shared masker: same lists, every contract row, depth cap and JSON round-trip', async () => {
  await withRealCatalog(async (c) => {
    const next = nextSkill(c, LOGGING);
    const masker = next.file('body-masker.ts');
    const list = (text, name) => text.split(`export const ${name} = [`)[1].split('] as const')[0].split(',').map((x) => x.trim().replace(/'/g, ''));
    const nest = c.stacks.get('nestjs').skills.find((k) => k.name === 'stackcrew-nest-request-logging');
    const nestMasker = codeOfSibling(nest.files.find((f) => f.relPath === 'body-masker.ts.md').content);
    for (const name of ['SECRET_FIELDS', 'DEFAULT_PII_FIELDS']) assert.deepEqual(list(masker, name), list(nestMasker, name), name);
    assert.ok(masker.includes('MAX_NESTING_DEPTH = 64') && masker.includes('CAPTURE_LIMIT_BYTES = 2_097_152'));
    assert.match(masker, /function jsonText\(value: unknown\): string \| undefined \{\n\s+try \{\n\s+return JSON\.stringify\(value\) \?\? '';/);
    // the masking core is the Nest masker verbatim from the word separator on: one algorithm in both TypeScript stacks
    const core = (text) => text.slice(text.indexOf('/** camelCase boundaries'));
    assert.equal(core(masker), core(nestMasker), 'the masker core matches the NestJS masker');
    const spec = next.file('body-masker.spec.ts');
    for (const needle of ['newPassword', 'confirm_password', 'ACCESS_TOKEN', 'access-token', 'tokenType', 'set-cookie', 'customerEmail', 'homeAddress', 'national_id',
      'nationalIdNumber', 'shipping', 'spanId', 'footprint', 'pinned', 'typeName', '<base64 771 bytes>', '...[truncated 16385 bytes]', '<text/xml 300 bytes>',
      '<application/json 4 bytes>', '<binary image/jpeg 5000 bytes>', '{"email":"***","amount":"10"}', '"customer":{"contact":{"phone":"***"}}', 'nest(65)',
      '<application/json 16384+ bytes>', 'class LeakyPage extends Array<unknown>']) {
      assert.ok(spec.includes(needle), `body-masker.spec.ts missing ${needle}`);
    }
  });
});

test('next typeorm entity skill: base classes, subscribers, tenant repository, DataSource singleton, CLI migration and the required tests', async () => {
  await withRealCatalog(async (c) => {
    const s = nextSkill(c, ENTITY);
    const all = [s.body, ...s.files.map((f) => f.content)].join('\n');
    for (const needle of ['@EventSubscriber()', 'listenTo(): typeof {{sc:baseEntity}}', 'export abstract class {{sc:baseEntity}}',
      'export abstract class {{sc:baseTenantEntity}} extends {{sc:baseEntity}}', 'readonly {{sc:tenantColumn}}!: string', 'class TenantScopedRepository<T extends {{sc:baseTenantEntity}}>',
      'withManager(manager: EntityManager): this {', 'IsNull()', 'gen_random_uuid()', '"{{sc:tenantColumn}}"', 'TIMESTAMP WITH TIME ZONE', 'createSchemaBuilder().log()',
      "uuidExtension: 'pgcrypto'", 'synchronize: false', 'runCrossTenant', 'runAsSystem', 'MissingTenantError', 'CrossTenantDeniedError', "import 'server-only';",
      'globalThis', 'migration:run', 'migration:generate', 'serverExternalPackages', 'vitest.int.config.ts']) {
      assert.ok(all.includes(needle), `typeorm entity skill missing ${needle}`);
    }
    // explicit column types: Next's compiler and Vitest (esbuild) emit no decorator metadata to infer them from
    for (const rel of ['base.entity.ts', 'base-tenant.entity.ts', 'customer-profile.entity.ts']) {
      for (const m of s.file(rel).matchAll(/@(Column|CreateDateColumn|UpdateDateColumn|DeleteDateColumn)\(([^)]*)\)/g)) {
        assert.match(m[2], /type: '/, `${rel}: @${m[1]}(${m[2]}) names its column type`);
      }
    }
    const repo = s.file('tenant-scoped.repository.ts');
    const nestRepo = codeOfSibling(c.stacks.get('nestjs').skills.find((k) => k.name === 'stackcrew-nest-typeorm-entity').files
      .find((f) => f.relPath === 'tenant-scoped.repository.ts.md').content);
    const body = (text) => text.slice(text.indexOf('export class TenantScopedRepository'));
    assert.equal(body(repo), body(nestRepo), 'the tenant repository is the NestJS one verbatim');
    const ds = s.file('data-source.ts');
    assert.ok(ds.includes("import 'server-only';") && ds.includes('globalThis') && ds.includes('export function getDataSource(): Promise<DataSource>'), 'the DataSource lives on globalThis');
    assert.ok(!s.file('data-source.options.ts').includes("import 'server-only'"), 'the CLI can load the options');
    const spec = s.file('customer-profile.persistence.int.spec.ts');
    for (const needle of ['fills the four audit fields on insert, update and soft delete', 'writes the system user when there is no user', 'keeps tenant B away from tenant A rows',
      'throws MissingTenantError without a tenant', 'lets a cross-tenant role read every tenant, read only', 'lets only the system job entry read across tenants without a role',
      'profiles.save(hijack)', 'profiles.withManager(manager)']) {
      assert.ok(spec.includes(needle), `persistence spec missing ${needle}`);
    }
    assert.ok(!/import \{[^}]*\bBaseEntity\b[^}]*\} from 'typeorm'/.test(all), "never imports TypeORM's BaseEntity");
    const ban = 'any manager method on a tenant entity (getRepository, update, delete, increment, decrement, softDelete, restore, upsert, createQueryBuilder…)';
    for (const [where, text] of [['stack rule', c.stacks.get('nextjs').rules.body], ['skill', s.body], ['repository docstring', repo]]) {
      assert.ok(text.includes(ban), `${where} states the ban as open-ended`);
    }
  });
});

test('next scratch findings: one DataSource per server layer, a literal NEXT_RUNTIME check, typeorm unbundled, copies cancelled without waiting', async () => {
  await withRealCatalog(async (c) => {
    const entity = nextSkill(c, ENTITY);
    const ds = entity.file('data-source.ts');
    // next build evaluates server modules once per layer: a DataSource keyed by the entity list, never replaced on a class mismatch
    assert.ok(ds.includes('sources.get(ENTITIES)') && ds.includes('sources.set(ENTITIES, starting)'), 'one DataSource per copy of the module');
    assert.ok(!ds.includes('hasMetadata') && !ds.includes('destroy('), 'never closes the DataSource another layer is using');
    assert.match(entity.body, /one DataSource, and one pool, per server layer/, 'SKILL.md explains the layers');
    const rules = c.stacks.get('nextjs').rules.body;
    assert.ok(rules.includes('One `DataSource` per server layer'), 'stack rule says per layer');
    const addon = c.addons.get('typeorm').rules.body;
    assert.ok(addon.includes('keyed by the module') && addon.includes('serverExternalPackages') && !addon.includes('one `DataSource` per process'), 'add-on Next.js section matches');
    assert.match(entity.body, /webpack build warns about its optional drivers/, 'the reason for serverExternalPackages is the observed one');
    // Next.js 16.0 does not keep pino unbundled by default: its build fails on pino's worker test files
    assert.ok(rules.includes("serverExternalPackages: ['typeorm', 'pino'],"), 'next.config.ts lists typeorm and pino');
    assert.ok(nextSkill(c, LOGGING).body.includes('Next.js 16.0 bundles it'), 'the request-logging skill says why pino is listed');
    assert.ok(nextSkill(c, LOGGING).body.includes('next typegen') && c.stacks.get('nextjs').testing.body.includes('next typegen'), 'RouteContext needs generated types before tsc');
    assert.ok(nextSkill(c, LOGGING).body.includes('every wrapped GET is dynamic'), 'wrapping makes a GET handler dynamic');
    const logging = nextSkill(c, LOGGING);
    const instrumentation = logging.file('instrumentation.ts');
    assert.ok(instrumentation.includes("if (process.env.NEXT_RUNTIME === 'nodejs') { // stackcrew-allow: SC-ENV"), 'the literal check Next.js replaces at build time');
    assert.ok(instrumentation.includes('// eslint-disable-next-line no-restricted-properties -- bootstrap'), 'the ESLint waiver says why');
    assert.ok(!logging.file('env.ts').includes('NEXT_RUNTIME'), 'no runtime helper in env.ts: it does not let the Edge bundle drop the import');
    const body = logging.file('web-body.ts');
    assert.ok(body.includes('void reader.cancel().then(noop, noop);') && !body.includes('await reader.cancel()'), 'a tee branch cancel settles only when the original ends');
    for (const [name, file] of [['log-fields', logging.file('log-fields.ts')], ['masker spec', logging.file('body-masker.spec.ts')]]) {
      assert.ok(!/\b\d[\d_]*n\b/.test(file.replace(/\/\/.*$/gm, '')), `${name}: no bigint literal (Next.js tsconfig targets ES2017)`);
    }
    assert.ok(c.stacks.get('nextjs').testing.body.includes("env: loadEnv('test', process.cwd(), '')"), 'unit and integration specs load .env.test');
  });
});

test('next fix round 1: control flow by the own digest of the error, revalidateTag profile, AUTH_SECRET validated, wording', async () => {
  await withRealCatalog(async (c) => {
    const logging = nextSkill(c, LOGGING);
    const control = logging.file('next-control-flow.ts');
    for (const digest of ['DYNAMIC_SERVER_USAGE', 'BAILOUT_TO_CLIENT_SIDE_RENDERING', 'HANGING_PROMISE_REJECTION', 'NEXT_PRERENDER_INTERRUPTED']) {
      assert.ok(control.includes(`'${digest}'`), `bailout digest ${digest}`);
    }
    assert.ok(!/\.cause\b/.test(control.replace(/^\s*(\*|\/\/).*$/gm, '')), 'the cause is never consulted');
    assert.ok(control.includes('/^30[378]$/') && control.includes('/^40[134]$/'), 'only the statuses Next.js accepts');
    for (const spec of ['with-action-logging.spec.ts', 'with-route-logging.spec.ts']) {
      const text = logging.file(spec);
      assert.ok(text.includes("new Error('lookup failed', { cause: thrownBy(notFound) })") && text.includes('rejects.toBe(wrapped)') && text.includes('status: 500'), `${spec}: a cause-wrapped notFound() is one 500 line`);
    }
    assert.ok(logging.file('with-route-logging.spec.ts').includes("digest: 'DYNAMIC_SERVER_USAGE'"), 'a bailout writes no line');
    assert.match(logging.body, /own `digest`/, 'SKILL.md says how control flow is recognized');
    assert.match(logging.body, /writes two lines/, 'SKILL.md says a nested wrapped action writes two lines');
    const next = c.stacks.get('nextjs');
    assert.ok(next.rules.body.includes("revalidateTag(tag, 'max')") && next.rules.body.includes('updateTag(tag)') && !/revalidateTag\('[^']*'\)/.test(next.rules.body), 'Next.js 16 revalidateTag takes a profile');
    assert.ok(next.rules.body.includes('AUTH_SECRET: z.string().min(32),'), 'AUTH_SECRET is validated');
    assert.match(next.testing.body, /# \.env\.test\nAUTH_SECRET=\S{32,}\n/, '.env.test carries a test AUTH_SECRET');
    assert.ok(next.rules.body.includes('one pool per server layer (two in a Turbopack build)'), 'pool wording in the rule');
    const entity = nextSkill(c, ENTITY);
    assert.ok(entity.body.includes('one pool, per server layer (two in a Turbopack build)'), 'pool wording in the skill');
    assert.ok(entity.body.includes('yarn tsx --env-file=.env.local node_modules/typeorm/cli.js migration:run') && entity.body.includes('npx tsx'), 'yarn first, npm noted');
    assert.ok(!entity.file('customer-profile.persistence.int.spec.ts').includes('RequestContextInterceptor'), 'no NestJS class name');
    assert.match(entity.file('data-source.ts'), /The old entry stays in the\n \* Map/, 'the stale dev entry is explained');
  });
});

// ---- Task 10: Next.js feature skills (server action, feature page, route handler) and the testing skill ----

/** Every code block and sibling of a skill. */
const allCode = (s) => [...s.files.map((f) => codeOfSibling(f.content)), ...[...s.body.matchAll(/```tsx?\n([\s\S]*?)```/g)].map((m) => m[1])].join('\n');
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

test('next feature skills load and name Next.js in their descriptions', async () => {
  await withRealCatalog(async (c) => {
    assert.deepEqual(validateCatalog(c), []);
    const byName = Object.fromEntries(c.stacks.get('nextjs').skills.map((k) => [k.name, k]));
    for (const name of [...FEATURE_SKILLS, TESTING_SKILL]) {
      const k = byName[name];
      assert.ok(k, `${name} exists`);
      assert.equal(k.kind, name === TESTING_SKILL ? 'testing' : 'task', `${name} kind`);
      assert.deepEqual(k.requiresAddons, [], `${name} needs no add-on, like the NestJS feature skills`);
      assert.deepEqual(k.paths, []);
      assert.ok(k.description.startsWith('Use when') && k.description.includes('Next.js'), `${name} description`);
      assert.ok(k.description.length <= 500, `${name} description length`);
      assert.ok(!/always|any code|all code|every task|whenever the user|proactively/i.test(k.description), `${name} has a banned word`);
      assert.ok(k.body.includes('SC-PREFLIGHT') || name === TESTING_SKILL, `${name} asks for the pre-flight note`);
    }
    const names = nextCtx(c).skills.map((k) => k.name);
    for (const name of [...FEATURE_SKILLS, TESTING_SKILL]) assert.ok(names.includes(name), `${name} renders without add-ons`);
  });
});

test('new next SKILL.md files are at most 350 lines', async () => {
  await withRealCatalog(async (c) => {
    for (const name of [...FEATURE_SKILLS, TESTING_SKILL]) {
      const k = c.stacks.get('nextjs').skills.find((s) => s.name === name);
      assert.ok(k, `${name} exists`);
      const lines = k.body.split('\n').length;
      assert.ok(lines <= 350, `${name} SKILL.md is ${lines} lines`);
    }
  });
});

test('next testing skill: siblings follow the "Goes to" format; the tester procedure covers every layer', async () => {
  await withRealCatalog(async (c) => {
    const s = nextSkill(c, TESTING_SKILL);
    assert.ok(s.files.length > 0, 'the Playwright config and sign-in setup ship as siblings');
    for (const f of s.files) {
      assert.ok(/\.tsx?\.md$/.test(f.relPath) && !f.relPath.includes('/'), f.relPath);
      const goesTo = GOES_TO.exec(f.content);
      assert.ok(goesTo, `${f.relPath} starts with "Goes to" and the code block`);
      assert.equal(f.content.split('```').length, 3, `${f.relPath}: one fenced block`);
      assert.ok(codeOfSibling(f.content).startsWith(`// Default location: ${goesTo[1]}`), `${f.relPath}: the code names the same location`);
    }
    for (const needle of ['stack-nextjs-testing', 'Vitest', 'Testing Library', 'Playwright', 'vitest.int.config.ts', "vi.mock('next/headers'", "vi.mock('next/cache'",
      'storageState', 'next typegen', 'tsc --noEmit', 'http_in', 'Never call a real', 'ask the user', SERVER_ACTION, FEATURE_PAGE, ROUTE_HANDLER, ENTITY, LOGGING]) {
      assert.ok(s.body.includes(needle), `testing SKILL.md missing ${needle}`);
    }
    const setup = s.file('auth.setup.ts');
    assert.ok(setup.includes("from 'next-auth/jwt'") && setup.includes('encode(') && setup.includes('storageState('), 'signs in by the app session format, auth() stays real');
    const config = s.file('playwright.config.ts');
    for (const needle of ['defineConfig', 'webServer', "dependencies: ['setup']", 'storageState']) assert.ok(config.includes(needle), `playwright.config.ts missing ${needle}`);
    const testing = c.stacks.get('nextjs').testing.body;
    assert.ok(testing.includes("vi.mock('next/cache')"), 'stack testing rule names next/cache as a boundary');
    assert.ok(testing.includes(TESTING_SKILL), 'stack testing rule points at the tester skill');
  });
});

test('next server action skill (golden task): eKYC schema file, wrapped action, caller and permission checks, DTO result, the form and its states', async () => {
  await withRealCatalog(async (c) => {
    const s = nextSkill(c, SERVER_ACTION);
    const schema = s.file('register-kyc.schema.ts');
    assert.ok(schema.includes('export const registerKycSchema = z.object(') && schema.includes('export type RegisterKycInput = z.infer<typeof registerKycSchema>;'), 'schema and z.infer type in their own file');
    assert.ok(/errorMap: \(\) => \(\{ message:/.test(schema), 'enum errors are constant text: zod 3 echoes the received value otherwise');
    assert.ok(!schema.includes('.entity'), 'the schema never imports the entity: it runs in the browser too');
    const action = s.file('actions.ts');
    assert.ok(action.startsWith("// Default location: src/features/kyc-registrations/actions.ts\n'use server';"), "'use server' after the location comment");
    assert.ok(action.includes("export const registerKyc = withActionLogging('registerKyc',"), 'the export is wrapped, named by its export name');
    assert.ok(/revalidatePath\(/.test(action), 'revalidates after the write');
    assert.ok(!/^(export\s+)?(interface|type)\s/m.test(action), 'no type in the actions file (SC-TYPEFILE)');
    const service = s.file('kyc-registration.service.ts');
    for (const needle of ["import 'server-only';", 'await getRequestContext()', 'caller.userId === undefined', 'ActionErrorCode.UNAUTHENTICATED', 'caller.tenantId === undefined',
      'ActionErrorCode.FORBIDDEN', 'registerKycSchema.safeParse(input)', 'parsed.error.flatten().fieldErrors', 'applicantId: caller.userId', 'ActionErrorCode.CONFLICT', 'toKycRegistrationDto(']) {
      assert.ok(service.includes(needle), `kyc-registration.service.ts missing ${needle}`);
    }
    assert.ok(!/\bauth\(\)/.test(withoutComments(service)) && !/\bauth\(\)/.test(withoutComments(action)), 'feature code reads the caller through getRequestContext(), never auth() itself');
    const dto = s.file('kyc-registration.dto.ts');
    for (const pii of ['idNumber', 'dateOfBirth', 'fullName', 'tenantId', 'createdBy']) assert.ok(!dto.includes(pii), `the result DTO does not echo ${pii}`);
    const repo = s.file('kyc-registration.repository.ts');
    assert.ok(repo.includes('extends TenantScopedRepository<KycRegistration>') && repo.includes('QueryFailedError') && repo.includes("'23505'"), 'a duplicate is decided by the unique constraint');
    const entity = s.file('kyc-registration.entity.ts');
    assert.ok(entity.includes('extends {{sc:baseTenantEntity}}') && entity.includes("@Unique('kyc_registration_applicant_key'"), 'tenant entity with a named unique constraint');
    const form = s.file('kyc-registration-form.tsx');
    for (const needle of ["'use client';", 'useForm<RegisterKycInput>({', 'resolver: zodResolver(registerKycSchema)', 'isSubmitting } = form.formState', 'disabled={isSubmitting}','setError(', 'await registerKyc(',
      'catch', 'role="status"', 'role="alert"', 'aria-invalid', 'htmlFor', "from '@/components/ui/button'", "from '@/components/ui/input'", "from '@/components/ui/label'"]) {
      assert.ok(form.includes(needle), `kyc-registration-form.tsx missing ${needle}`);
    }
    assert.ok(!/style=\{/.test(form) && !/error\.message/.test(form), 'no inline style; never shows an exception message');
    assert.ok(!form.includes('.entity') && !form.includes('.service'), 'the client imports no server module');
    for (const spec of ['register-kyc.schema.spec.ts', 'actions.spec.ts', 'kyc-registration-form.spec.tsx', 'kyc-registration.int.spec.ts', 'kyc-registration.spec.ts']) {
      assert.ok(s.files.some((f) => f.relPath === `${spec}.md`), `${spec} ships`);
    }
    const actionSpec = s.file('actions.spec.ts');
    for (const needle of ["vi.mock('next/headers'", "vi.mock('../../auth'", "vi.mock('next/cache'", 'UNAUTHENTICATED', 'FORBIDDEN', 'VALIDATION', 'CONFLICT', 'http_in', '"idNumber":"***"']) {
      assert.ok(actionSpec.includes(needle), `actions.spec.ts missing ${needle}`);
    }
    assert.ok(s.file('kyc-registration-form.spec.tsx').startsWith('// Default location: src/features/kyc-registrations/components/kyc-registration-form.spec.tsx\n// @vitest-environment jsdom'));
    for (const needle of ['SC-PREFLIGHT', 'getRequestContext()', 'auth()', 'withActionLogging', 'z.infer', 'react-hook-form', 'zodResolver', '{{sc:sharedComponents}}', 'isSubmitting',
      'useActionState', 'ENTITIES', 'MIGRATIONS', 'idempotency', 'Outcome side-write', 'LOG_MASK_FIELDS', 'ask the user']) {
      assert.ok(s.body.includes(needle), `server action SKILL.md missing ${needle}`);
    }
  });
});

test('next feature page skill: async Server Component on getRequestContext and the tenant repository, DTO rows, loading, error, empty state, the shared table', async () => {
  await withRealCatalog(async (c) => {
    const s = nextSkill(c, FEATURE_PAGE);
    const data = s.file('data.ts');
    for (const needle of ["import 'server-only';", 'await getRequestContext()', 'runInRequestContext(', 'await kycRegistrations()', 'toKycRegistrationRowDto', 'count(',
      'ActionErrorCode.FORBIDDEN', 'KycRole.REVIEWER', "order: { createdAt: 'DESC', id: 'DESC' }"]) {
      assert.ok(data.includes(needle), `data.ts missing ${needle}`);
    }
    const row = s.file('kyc-registration-row.dto.ts');
    for (const pii of ['idNumber', 'dateOfBirth', 'tenantId']) assert.ok(!row.includes(pii), `the list row leaves out ${pii}`);
    const page = s.file('page.tsx');
    for (const needle of ['export default async function', "PageProps<'/kyc/registrations'>", 'await props.searchParams', 'loadKycRegistrationPage(', 'redirect(', '<KycRegistrationTable', 'size: registrations.size']) {
      assert.ok(page.includes(needle), `page.tsx missing ${needle}`);
    }
    assert.ok(!page.includes("'use client'"), 'the page is a Server Component');
    assert.ok(s.file('loading.tsx').includes("from '@/components/ui/skeleton'"), 'loading.tsx uses the shared skeleton');
    const error = s.file('error.tsx');
    for (const needle of ["'use client';", 'reset', 'router.refresh()', 'startTransition(', 'error.digest']) assert.ok(error.includes(needle), `error.tsx missing ${needle}`);
    assert.ok(!/error\.message/.test(withoutComments(error)), 'error.tsx never shows the message');
    const table = s.file('kyc-registration-table.tsx');
    for (const needle of ["'use client';", 'ColumnDef<KycRegistrationRowDto>[]', "from '@/components/ui/data-table'", 'timeZone']) assert.ok(table.includes(needle), `table missing ${needle}`);
    const dataTable = s.file('data-table.tsx');
    assert.equal(GOES_TO.exec(s.files.find((f) => f.relPath === 'data-table.tsx.md').content)[1], '{{sc:sharedComponents}}/data-table.tsx', 'the table goes to the shared components');
    for (const needle of ['useReactTable', 'getCoreRowModel()', 'flexRender(', "from './table'"]) assert.ok(dataTable.includes(needle), `data-table.tsx missing ${needle}`);
    const pagination = s.file('pagination.ts');
    assert.ok(pagination.includes('export const pageQuerySchema') && pagination.includes('MAX_PAGE_SIZE') && pagination.includes('export type PageDto<T>'), 'one page shape');
    for (const spec of ['data.spec.ts', 'kyc-registration-table.spec.tsx', 'kyc-registrations-page.spec.ts']) assert.ok(s.files.some((f) => f.relPath === `${spec}.md`), `${spec} ships`);
    for (const needle of ['SC-PREFLIGHT', 'loading.tsx', 'error.tsx', 'empty state', 'TanStack Table', '{{sc:sharedComponents}}', 'runInRequestContext', 'TenantScopedRepository',
      SERVER_ACTION, 'v9', 'authInterrupts']) {
      assert.ok(s.body.includes(needle), `feature page SKILL.md missing ${needle}`);
    }
  });
});

test('next route handler skill: withRouteLogging with the route template, zod input, the caller, typed JSON and RFC 7807 problems', async () => {
  await withRealCatalog(async (c) => {
    const s = nextSkill(c, ROUTE_HANDLER);
    const route = s.file('route.ts');
    for (const needle of ["export const GET = withRouteLogging('/api/v1/kyc-registrations',", "export const POST = withRouteLogging('/api/v1/kyc-registrations',",
      'pageQuerySchema.safeParse(', 'readJsonBody(', 'submitKycRegistration(', 'listKycRegistrations(', 'NextResponse.json', 'HTTP_STATUS.CREATED', 'problemForRefusal(']) {
      assert.ok(route.includes(needle), `route.ts missing ${needle}`);
    }
    const problems = s.file('problem-details.ts');
    for (const needle of ["'application/problem+json'", "'about:blank'", 'STATUS_CODES', 'errors', 'export type FieldError = { field: string; messages: readonly string[] }',
      'ACTION_ERROR_STATUS', 'CrossTenantDeniedError']) {
      assert.ok(problems.includes(needle), `problem-details.ts missing ${needle}`);
    }
    assert.ok(!/\.message\b/.test(withoutComments(problems)), 'a problem never carries an exception message');
    const body = s.file('read-json-body.ts');
    assert.ok(!/\b415\b/.test(withoutComments(body)) &&body.includes('UNSUPPORTED_MEDIA_TYPE') && body.includes('BAD_REQUEST'), 'non-JSON is 415, malformed JSON is 400, by name');
    const spec = s.file('route.spec.ts');
    for (const needle of ['status: 400', 'status: 401', 'status: 403', 'status: 409', 'status: 415', 'status: 201', 'status: 200', "'application/problem+json'", 'http_in', 'new NextRequest(']) {
      assert.ok(spec.includes(needle), `route.spec.ts missing ${needle}`);
    }
    for (const needle of ['SC-PREFLIGHT', 'withRouteLogging', 'RFC 7807', 'next typegen', 'CrossTenantDeniedError', 'constant', 'wrap only the exports', SERVER_ACTION, FEATURE_PAGE]) {
      assert.ok(s.body.includes(needle), `route handler SKILL.md missing ${needle}`);
    }
  });
});

test('next feature code: no style attribute, classes through cn(), and only the shared components for controls', async () => {
  await withRealCatalog(async (c) => {
    for (const name of FEATURE_SKILLS) {
      const s = nextSkill(c, name);
      assert.ok(s.files.length > 0, `${name} has siblings`);
      for (const f of s.files.filter((x) => /\.tsx\.md$/.test(x.relPath) && !/\.spec\.tsx\.md$/.test(x.relPath))) {
        const code = codeOfSibling(f.content);
        assert.ok(!/\bstyle=\{/.test(code), `${name}/${f.relPath}: inline style`);
        assert.ok(!/<(button|input|select|table)\b/.test(code), `${name}/${f.relPath}: a raw control where a shared component belongs`);
        assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(code), `${name}/${f.relPath}: hardcoded color`);
      }
    }
    const all = FEATURE_SKILLS.map((n) => allCode(nextSkill(c, n))).join('\n');
    assert.ok(all.includes('cn('), 'classes are merged through cn()');
  });
});
