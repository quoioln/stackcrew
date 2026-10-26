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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEST_DIR = path.join(ROOT, 'catalog', 'stacks', 'nestjs');
const OPTS = { cli: 'npx stackcrew', version: '0.0.0' };
const ALL = ['claude', 'cursor', 'codex', 'antigravity'];
const LOGGING = 'stackcrew-nest-request-logging';
const ENTITY = 'stackcrew-nest-typeorm-entity';
const TEST_EXCLUDES = ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx', '**/test/**', '**/tests/**', '**/e2e/**', '**/__tests__/**'];

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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sc-nest-'));
  try {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg));
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const nestProfile = (c, extra = {}) => createProfile({ stack: 'nestjs', tools: ALL, mode: 'greenfield', ...extra }, c);
const nestCtx = (c, { addons = [], conventions } = {}) => {
  const profile = nestProfile(c);
  profile.addons = addons;
  if (conventions) profile.conventions = conventions;
  return buildContext(c, profile, OPTS);
};

test('nestjs stack loads, validates, and gates the typeorm skill by its add-on', async () => {
  await withRealCatalog(async (c) => {
    assert.deepEqual(validateCatalog(c), []);
    const s = c.stacks.get('nestjs');
    assert.ok(s, 'nestjs stack exists');
    assert.equal(s.name, 'NestJS');
    assert.equal(s.category, 'backend');
    assert.equal(s.language, 'typescript');
    assert.equal(s.minVersion, '10.0');
    assert.deepEqual(s.globs, ['**/*.ts']);
    assert.deepEqual(s.aliases, ['nest']);
    assert.equal(s.priority, 20);
    assert.deepEqual(s.detect, { files: [], contains: [], excludeContains: [], packageDeps: ['@nestjs/core'] });
    assert.equal(s.rules.id, 'stack-nestjs');
    assert.equal(s.testing.id, 'stack-nestjs-testing');
    const byName = Object.fromEntries(s.skills.map((k) => [k.name, k]));
    assert.equal(byName[LOGGING].kind, 'task');
    assert.deepEqual(byName[LOGGING].requiresAddons, []);
    assert.equal(byName[ENTITY].kind, 'task');
    assert.deepEqual(byName[ENTITY].requiresAddons, ['typeorm']);
    for (const k of s.skills) {
      assert.deepEqual(k.paths, []);
      assert.ok(k.description.startsWith('Use when') && k.description.includes('NestJS'), k.name);
      assert.ok(k.description.length <= 500, k.name);
    }
    const names = (ctx) => ctx.skills.map((k) => k.name);
    assert.ok(names(nestCtx(c)).includes(LOGGING));
    assert.ok(!names(nestCtx(c)).includes(ENTITY), 'entity skill needs the typeorm add-on');
    assert.ok(names(nestCtx(c, { addons: ['typeorm'] })).includes(ENTITY));
    assert.ok(nestCtx(c).rules.some((r) => r.id === 'core-persistence'), 'backend stack gets core-persistence');
  });
});

test('nestjs detects only by exact package name', async () => {
  await withRealCatalog(async (c) => {
    await withPackageJson({ dependencies: { '@nestjs/core': '^10.4.0', '@nestjs/common': '^10.4.0' } }, async (dir) => {
      assert.equal((await detectProject(dir, c)).stack, 'nestjs');
    });
    await withPackageJson({ dependencies: { '@nestjs/common': '^10.4.0' } }, async (dir) => {
      assert.equal((await detectProject(dir, c)).stack, null);
    });
    await withPackageJson({ name: 'plain-node' }, async (dir) => {
      assert.equal((await detectProject(dir, c)).stack, null);
    });
    await withPackageJson({ devDependencies: { '@nestjs/core-extra': '1.0.0' } }, async (dir) => {
      assert.equal((await detectProject(dir, c)).stack, null);
    });
    await withPackageJson({ dependencies: { '@nestjs/core': '^10.4.0', typeorm: '^0.3.20' } }, async (dir) => {
      const r = await detectProject(dir, c);
      assert.equal(r.stack, 'nestjs');
      assert.deepEqual(r.addons, ['typeorm']);
    });
  });
});

test('nest guard blocks a type declaration in a service file and honours typeFreeFiles', async () => {
  await withRealCatalog(async (c) => {
    const guard = c.stacks.get('nestjs').guard;
    assert.deepEqual(guard.map((r) => r.id), ['SC-TYPEFILE']);
    const [rule] = guard;
    assert.equal(rule.globsFrom, 'typeFreeFiles');
    assert.deepEqual(rule.globs, ['**/*.service.ts']);
    assert.deepEqual(rule.excludeGlobs, TEST_EXCLUDES);
    assert.ok(rule.message.includes('stackcrew-allow: SC-TYPEFILE'), 'message names the waiver');
    for (const where of ['`dto/`', '`interfaces/`', '`*.types.ts`']) assert.ok(rule.message.includes(where), where);
    const compiled = compileGuardRules(guard);
    const scan = (file, text) => scanLines(file, [{ line: 1, text }], compiled).map((v) => v.ruleId);
    const SVC = 'src/modules/orders/order.service.ts';
    for (const line of ['export interface CreateOrderInput { sku: string }', 'interface Row { id: string }', 'type Status = "A" | "B";',
      'export type OrderId = string;', 'export declare interface X {}', 'declare type Y = number;']) {
      assert.deepEqual(scan(SVC, line), ['SC-TYPEFILE'], line);
    }
    for (const line of ['  type: string;', 'const type = 1;', '// interface Foo', 'export class OrderService {', '  interface Inner {}',
      'export interface X {} // stackcrew-allow: SC-TYPEFILE generated client']) {
      assert.deepEqual(scan(SVC, line), [], line);
    }
    assert.deepEqual(scan('src/modules/orders/dto/create-order.dto.ts', 'export interface CreateOrderInput {}'), []);
    assert.deepEqual(scan('src/modules/orders/order.types.ts', 'export type OrderId = string;'), []);
    assert.deepEqual(scan('src/modules/orders/order.service.spec.ts', 'interface Fixture { id: string }'), []);
    // typeFreeFiles replaces the default glob in the rendered guard
    const rendered = (conventions) => JSON.parse(renderShared(nestCtx(c, { conventions })).find((o) => o.path === '.stackcrew/guard.json').content);
    const byId = (g) => g.rules.find((r) => r.id === 'SC-TYPEFILE');
    assert.deepEqual(byId(rendered()).globs, ['**/*.service.ts']);
    assert.deepEqual(byId(rendered({ typeFreeFiles: ['src/**/*.handler.ts'] })).globs, ['src/**/*.handler.ts']);
    assert.ok(rendered().rules.some((r) => r.id === 'SC-TYPE'), 'the TypeScript language guard comes along');
  });
});

test('nest guard.json keeps its regex escapes byte-exact', async () => {
  const text = await readFile(path.join(NEST_DIR, 'guard.json'), 'utf8');
  const BS = String.fromCharCode(92);
  const [rule] = JSON.parse(text).rules;
  assert.equal(rule.regex, `^(export${BS}s+)?(declare${BS}s+)?(interface|type)${BS}s+[A-Za-z_$][${BS}w$]*`);
  assert.equal(rule.flags, '');
  assert.ok(!text.includes(String.fromCharCode(8)), 'no raw backspace byte');
  assert.ok(!text.includes('\r'), 'LF only');
});

test('nest rules forbid returning entities and require response DTOs', async () => {
  await withRealCatalog(async (c) => {
    const rules = c.stacks.get('nestjs').rules.body;
    for (const needle of ['src/modules/<feature>/', '`dto/`', '`entities/`', '`interfaces/`', '@Expose()', '@ApiProperty()',
      'plainToInstance(', 'excludeExtraneousValues: true', 'ClassSerializerInterceptor', 'whitelist: true', 'forbidNonWhitelisted: true',
      'transform: true', '@nestjs/config', 'passport-jwt', 'JWKS', 'issuer', 'audience', '@Public()', 'APP_GUARD', 'runWithRequestContext',
      '{{sc:tenantClaim}}', '{{sc:rolesClaim}}', 'addon-typeorm', 'RFC 7807', 'HttpService', 'timeout', 'nestjs-pino', 'core-logging',
      'Nest 11', LOGGING, ENTITY]) {
      assert.ok(rules.includes(needle), `rules.md missing ${needle}`);
    }
    assert.match(rules, /[Nn]ever return an entity/, 'entities never leave through a controller');
    assert.ok(/ask (the user )?(first|before)/i.test(rules), 'new dependencies are asked for first');
  });
});

test('nest rule files have id, title and a bounded Essentials list', async () => {
  await withRealCatalog(async (c) => {
    const s = c.stacks.get('nestjs');
    for (const r of [s.rules, s.testing]) {
      assert.ok(r.title);
      const n = r.essentials.split('\n').filter((l) => /^- /.test(l)).length;
      assert.ok(n >= 5 && n <= 15, `${r.id} essentials ${n}`);
      assert.ok(Buffer.byteLength(r.body) < 24000, `${r.id} bytes`);
    }
  });
});

test('nestjs with typeorm and all four tools renders within every budget', async () => {
  await withRealCatalog(async (c) => {
    const ctx = nestCtx(c, { addons: ['typeorm'] });
    const { ops } = renderProject(ctx); // throws StackcrewError BUDGET when over
    const agents = renderAgentsMdBlock(ctx).op;
    assert.ok(Buffer.byteLength(agents.content) <= 16000, `AGENTS block ${Buffer.byteLength(agents.content)}`);
    for (const o of ops.filter((x) => x.path.startsWith('.cursor/rules/stackcrew/'))) {
      assert.ok(o.content.split('\n').length <= 500, `${o.path} lines`);
    }
    for (const o of ops.filter((x) => x.path.startsWith('.agents/rules/stackcrew-'))) {
      assert.ok(Buffer.byteLength(o.content) <= 24000, `${o.path} bytes`);
    }
    assert.ok(ops.some((o) => o.path.includes(ENTITY)) && ops.some((o) => o.path.includes(LOGGING)));
    for (const o of ops) assert.ok(!o.content.includes('{{sc:'), `${o.path} has an unrendered placeholder`);
  });
});

const NEST_SKILLS = [LOGGING, ENTITY];
const GOES_TO = /^Goes to `((?:src|test)\/[^`]+\.ts)`\.\n\n```ts\n/;
/** The code of a sibling `<rel>.md`: its one fenced block. */
const codeOfSibling = (md) => /```ts\n([\s\S]*?)```\n$/.exec(md ?? '')?.[1] ?? '';
const nestSkill = (c, name) => {
  const k = c.stacks.get('nestjs').skills.find((s) => s.name === name);
  return { body: k.body, files: k.files, file: (rel) => codeOfSibling(k.files.find((f) => f.relPath === `${rel}.md`)?.content) };
};
const renderedFile = (c, skill, rel, conventions) => codeOfSibling(
  nestCtx(c, { addons: ['typeorm'], conventions }).skills.find((k) => k.name === skill).files.find((f) => f.relPath === `${rel}.md`).content);

test('nest skills are task skills under 350 lines; siblings are <file>.ts.md with a "Goes to" line and one code block', async () => {
  await withRealCatalog(async (c) => {
    for (const name of NEST_SKILLS) {
      const k = c.stacks.get('nestjs').skills.find((s) => s.name === name);
      assert.equal(k.kind, 'task');
      assert.ok(k.body.split('\n').length <= 350, `${name} SKILL.md is ${k.body.split('\n').length} lines`);
      assert.ok(!/always|proactively/i.test(k.description));
      assert.ok(k.files.length > 0, `${name} has sibling files`);
      for (const f of k.files) {
        assert.ok(f.relPath.endsWith('.ts.md') && !f.relPath.includes('/'), `${name}/${f.relPath}`);
        assert.ok(!/\.test\.|[-_]test\.|^test[.-]/.test(f.relPath), `${name}/${f.relPath} matches a node --test pattern`);
        const goesTo = GOES_TO.exec(f.content);
        assert.ok(goesTo, `${name}/${f.relPath} starts with "Goes to" and the code block`);
        assert.equal(f.content.split('```').length, 3, `${name}/${f.relPath}: exactly one fenced block`);
        assert.ok(codeOfSibling(f.content).startsWith(`// Default location: ${goesTo[1]}`), `${name}/${f.relPath}: the code names the same location`);
        assert.ok(!f.content.includes('\r'), `${name}/${f.relPath} is LF`);
      }
    }
  });
});

test('every nest sibling file and code block passes the TypeScript and NestJS guards at its intended path', async () => {
  await withRealCatalog(async (c) => {
    const compiled = compileGuardRules([...c.languages.get('typescript').guard, ...c.stacks.get('nestjs').guard]);
    const ctx = nestCtx(c, { addons: ['typeorm'] });
    const skills = ctx.skills.filter((s) => NEST_SKILLS.includes(s.name));
    const sources = [];
    for (const k of skills) {
      for (const f of k.files) sources.push({ name: `${k.name}/${f.relPath}`, path: GOES_TO.exec(f.content)[1], text: codeOfSibling(f.content) });
    }
    const docs = [...skills.map((s) => [s.name, s.body]),
      ['stack-nestjs', ctx.rules.find((r) => r.id === 'stack-nestjs').body], ['stack-nestjs-testing', ctx.rules.find((r) => r.id === 'stack-nestjs-testing').body]];
    for (const [doc, md] of docs) {
      for (const m of md.matchAll(/```ts\n([\s\S]*?)```/g)) {
        const first = /^\/\/ ((?:src|test)\/\S+\.ts)\b/.exec(m[1]);
        // a fragment without a path is checked as service code, where the guards are strictest
        sources.push({ name: `${doc} block`, path: first ? first[1] : 'src/modules/example/example.service.ts', text: m[1] });
      }
    }
    assert.ok(sources.length >= 35, `sources ${sources.length}`);
    for (const s of sources) {
      const lines = s.text.split('\n').map((text, i) => ({ line: i + 1, text }));
      const violations = scanLines(s.path, lines, compiled).map((v) => `${s.name}:${v.line} ${v.ruleId} ${v.text.trim()}`);
      assert.deepEqual(violations, [], s.name);
      assert.ok(!s.text.includes('stackcrew-allow'), `${s.name} needs no waiver`);
    }
  });
});

test('nest request logging writes one line per request from a middleware ahead of the body parsers', async () => {
  await withRealCatalog(async (c) => {
    const s = nestSkill(c, LOGGING);
    const setup = s.file('logging.setup.ts');
    for (const needle of ['app.use(httpLoggingMiddleware(skippedPaths))', 'autoLogging: false', 'quietReqLogger: true', 'mixin: () => contextLogFields()']) {
      assert.ok(setup.includes(needle), `logging.setup.ts missing ${needle}`);
    }
    const mw = s.file('http-logging.middleware.ts');
    for (const needle of ["res.once('finish', writeLine)", "res.once('close', writeLine)", 'if (written) {', 'req.rawBody', 'CAPTURE_LIMIT_BYTES = 2 * 1024 * 1024',
      'tee.streamed = true', "isMaskable(headerText(this.getHeader('content-type')))", 'userId: ctx?.userId', "UNMATCHED_ROUTE = 'UNMATCHED'",
      'route: routeTemplates.get(req) ?? UNMATCHED_ROUTE', 'req.path === skipped || req.path.startsWith(`${skipped}/`)']) {
      assert.ok(mw.includes(needle), `middleware missing ${needle}`);
    }
    assert.ok(!/req\.path\.startsWith\((prefix|skipped)\)/.test(mw), 'a bare prefix match would skip /health-records');
    const common = s.file('common.module.ts');
    const routeGuard = common.indexOf('useClass: RouteTemplateGuard');
    assert.ok(routeGuard > 0 && routeGuard < common.indexOf('useClass: JwtAuthGuard'), 'RouteTemplateGuard is the first global guard');
    for (const needle of ['provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor', 'provide: APP_FILTER, useClass: AllExceptionsFilter', 'validate: validateEnv',
      'forbidNonWhitelisted: true', 'exceptionFactory: requestValidationError']) {
      assert.ok(common.includes(needle), `common.module.ts missing ${needle}`);
    }
    const errors = (s.file('all-exceptions.filter.ts') + s.file('problem-details.ts')).replace(/\/\/.*$/gm, '');
    assert.ok(!/\.message\b/.test(errors), 'the filter never sends or logs an exception message');
    assert.ok(errors.includes("'application/problem+json'") && errors.includes('stackFrames(exception)'));
    const out = s.file('outbound-http-logger.ts');
    for (const needle of ['axios.interceptors.request.use', 'axios.interceptors.response.use', 'sanitizeUrl(', 'data instanceof Readable',
      'isMaskable(contentType) ? serializeMasked', 'error.code ?? error.name']) {
      assert.ok(out.includes(needle), `outbound logger missing ${needle}`);
    }
    for (const needle of ['`nestjs-pino` **4.x**', 'Nest 11', 'rawBody: true', 'setupApp(app)', 'compression', 'MiddlewareConsumer', 'enterWith', 'message_in',
      'contextFromMessageHeaders', 'body-masker.spec.ts', 'request-context.spec.ts', 'ask the user']) {
      assert.ok(s.body.includes(needle), `SKILL.md missing ${needle}`);
    }
  });
});

test('nest request context: only runAsSystem grants the system identity; roles default from conventions', async () => {
  await withRealCatalog(async (c) => {
    const s = nestSkill(c, LOGGING);
    const ctx = s.file('request-context.ts');
    assert.equal(ctx.match(/system: true/g)?.length, 1, 'system: true is set in one place');
    assert.match(ctx, /export function runAsSystem[^]*?system: true/, 'that place is runAsSystem');
    assert.equal(ctx.match(/crossTenant: true/g)?.length, 1, 'crossTenant: true is set only by runCrossTenant');
    assert.ok(ctx.includes('Object.freeze({ requestId: ctx.requestId, userId: ctx.userId, tenantId: ctx.tenantId, roles: Object.freeze([...ctx.roles]) })'),
      'runWithRequestContext copies only the plain fields');
    assert.ok(ctx.includes('tenantId: undefined, crossTenant: true'), 'cross-tenant work has no tenant to write with');
    assert.ok(!ctx.includes('=== SYSTEM_USER') && !ctx.includes('enterWith'));
    assert.ok(ctx.includes("reason.replace(/[\\r\\n]+/g, ' ')"), 'CR/LF stripped from the reason');
    assert.ok(ctx.includes('/^[A-Za-z0-9._-]{1,64}$/') && ctx.includes('/^[\\x21-\\x7e]{1,128}$/'), 'header sanitizers match Spring');
    assert.ok(s.file('env.ts').includes("CROSS_TENANT_ROLES = '{{sc:crossTenantRolesCsv}}'"));
    assert.ok(renderedFile(c, LOGGING, 'env.ts').includes("CROSS_TENANT_ROLES = 'super_admin'"));
    assert.ok(renderedFile(c, LOGGING, 'env.ts', { crossTenantRoles: [] }).includes("CROSS_TENANT_ROLES = ''"), 'no roles renders an empty default');
    assert.ok(s.file('env.ts').includes('@Type(() => Number)'), 'numeric variables are converted from strings');
    const spec = s.file('request-context.spec.ts');
    for (const needle of ['never makes a token or header user named like the system user the system identity', 'contextFromMessageHeaders',
      'runAsSystem(undefined', 'keeps concurrent contexts apart']) {
      assert.ok(spec.includes(needle), `request-context.spec.ts missing ${needle}`);
    }
  });
});

test('nest masker sibling carries the core-logging lists and every contract row', async () => {
  await withRealCatalog(async (c) => {
    const s = nestSkill(c, LOGGING);
    const masker = s.file('body-masker.ts');
    const list = (name) => masker.split(`export const ${name} = [`)[1].split('] as const')[0].split(',').map((x) => x.trim().replace(/'/g, ''));
    assert.deepEqual(list('SECRET_FIELDS'), ['password', 'passwd', 'secret', 'token', 'accessToken', 'refreshToken', 'idToken', 'apiKey', 'clientSecret', 'privateKey',
      'authorization', 'cookie', 'setCookie', 'otp', 'pin', 'cvv', 'cvc']);
    assert.deepEqual(list('DEFAULT_PII_FIELDS'), ['email', 'phone', 'phoneNumber', 'mobile', 'fullName', 'dob', 'dateOfBirth', 'address', 'nationalId', 'idNumber',
      'cccd', 'cmnd', 'passport', 'passportNumber', 'cardNumber', 'pan', 'accountNumber']);
    assert.ok(masker.includes('Object.fromEntries') && masker.includes('new URLSearchParams(text).entries()'));
    const spec = s.file('body-masker.spec.ts');
    for (const needle of ['newPassword', 'confirm_password', 'ACCESS_TOKEN', 'access-token', 'tokenType', 'set-cookie', 'customerEmail', 'homeAddress', 'national_id',
      'nationalIdNumber', 'shipping', 'spanId', 'footprint', 'pinned', 'typeName', "LOG_MASK_FIELDS: 'email'", "LOG_MASK_FIELDS: 'profile'", '<base64 771 bytes>',
      '...[truncated 16385 bytes]', '...[truncated 16387 bytes]', '<text/xml 300 bytes>', '<application/json 4 bytes>', '<binary image/jpeg 5000 bytes>',
      '{"email":"***","amount":"10"}', '"customer":{"contact":{"phone":"***"}}']) {
      assert.ok(spec.includes(needle), `body-masker.spec.ts missing ${needle}`);
    }
  });
});

test('nest typeorm entity skill: audit and tenant subscribers, tenant repository, migration and the required tests', async () => {
  await withRealCatalog(async (c) => {
    const s = nestSkill(c, ENTITY);
    const all = [s.body, ...s.files.map((f) => f.content)].join('\n');
    for (const needle of ['@EventSubscriber()', 'listenTo(): typeof {{sc:baseEntity}}', 'listenTo(): typeof {{sc:baseTenantEntity}}', 'afterLoad(',
      "@CreateDateColumn({ type: 'timestamptz'", "@UpdateDateColumn({ type: 'timestamptz'", 'export abstract class {{sc:baseEntity}}',
      'export abstract class {{sc:baseTenantEntity}} extends {{sc:baseEntity}}', 'readonly {{sc:tenantColumn}}!: string', 'update: false',
      'class TenantScopedRepository<T extends {{sc:baseTenantEntity}}>', 'IsNull()', 'deleteDateColumn', 'gen_random_uuid()', '"{{sc:tenantColumn}}"',
      'TIMESTAMP WITH TIME ZONE', 'createSchemaBuilder().log()', "uuidExtension: 'pgcrypto'", 'synchronize: false', 'runCrossTenant', 'runAsSystem',
      'MissingTenantError', 'CrossTenantDeniedError', '@testcontainers/postgresql', "'postgres:16-alpine'", 'process.env.CROSS_TENANT_ROLES', 'x-tenant-id']) {
      assert.ok(all.includes(needle), `typeorm entity skill missing ${needle}`);
    }
    const repo = s.file('tenant-scoped.repository.ts');
    for (const m of ['find', 'findOne', 'findOneBy', 'count', 'save', 'update', 'delete', 'softDelete']) {
      assert.match(repo, new RegExp(`\\n  async ${m}\\(`), `${m} is async, so a missing tenant rejects`);
    }
    assert.ok(repo.includes('if (isCrossTenant()) {'), 'cross-tenant reads skip the condition');
    assert.match(repo, /protected writeScope\(where: FindOptionsWhere<T>\): FindOptionsWhere<T> \{\n\s+return \{ \.\.\.where, \.\.\.this\.tenantCondition\(requireTenantId\(\)\) \};/,
      'writes always require a tenant');
    const spec = s.file('customer-profile.persistence.spec.ts');
    for (const needle of ['fills the four audit fields on insert, update and soft delete', 'writes the system user when there is no user',
      'keeps tenant B away from tenant A rows', 'throws MissingTenantError without a tenant', 'lets a cross-tenant role read every tenant, read only',
      'lets only the system job entry read across tenants without a role', 'profiles.save(hijack)']) {
      assert.ok(spec.includes(needle), `persistence spec missing ${needle}`);
    }
    assert.ok(!/import \{[^}]*\bBaseEntity\b[^}]*\} from 'typeorm'/.test(all), "never imports TypeORM's BaseEntity");
  });
});

test('nest testing rule carries the harness: rawBody, setupApp, a local issuer and the Jest roots', async () => {
  await withRealCatalog(async (c) => {
    const t = c.stacks.get('nestjs').testing.body;
    for (const needle of ['createNestApplication<NestExpressApplication>({ rawBody: true })', 'setupApp(app)', "await import('../../src/app.module')",
      'class TestIssuer', "sign('RSA-SHA256'", 'CapturingLogger', '@testcontainers/postgresql', 'supertest', 'node:http',
      "roots: ['<rootDir>/src', '<rootDir>/test']", '*.spec.ts', 'MissingTenantError', 'CROSS_TENANT_ROLES', '{{sc:systemUser}}',
      '{{sc:tenantClaim}}', 'customer-profile.persistence.spec.ts.md']) {
      assert.ok(t.includes(needle), `testing.md missing ${needle}`);
    }
    assert.ok(!t.includes('testPathIgnorePatterns'), 'skill folders hold no runnable spec any more');
    assert.ok(/ask the user/i.test(t));
  });
});

test('nest logging never throws: depth-capped masker, guarded line writers, 499 for a client abort', async () => {
  await withRealCatalog(async (c) => {
    const s = nestSkill(c, LOGGING);
    const masker = s.file('body-masker.ts');
    assert.ok(masker.includes('MAX_NESTING_DEPTH = 64') && masker.includes('class NestingTooDeep'), 'nesting is capped at 64');
    assert.match(masker, /if \(depth > MAX_NESTING_DEPTH\) \{\n\s+throw new NestingTooDeep\(\);/, 'the walk stops past the cap');
    const spec = s.file('body-masker.spec.ts');
    for (const needle of ['nest(64)', 'nest(65)', 'nest(50000)', '<application/json 130 bytes>']) assert.ok(spec.includes(needle), `masker spec missing ${needle}`);
    const fields = s.file('log-fields.ts');
    assert.ok(fields.includes('export function writeCallLine(') && fields.includes('process.emitWarning('), 'one guarded writer');
    const mw = s.file('http-logging.middleware.ts');
    assert.ok(mw.includes('writeCallLine(logger,') && mw.includes('CLIENT_ABORT_STATUS = 499'), 'middleware writes through the guard; abort is 499');
    assert.ok(mw.includes('export function httpLoggingMiddleware(skippedPaths: readonly string[] = SKIPPED_PATHS)') && mw.includes('setGlobalPrefix'),
      'skipped paths are a parameter and the global prefix is documented');
    assert.ok(s.file('outbound-http-logger.ts').includes('writeCallLine(this.logger,'), 'outbound writes through the guard');
    assert.ok(/try \{[^]*?this\.logger\.log\(\{ event: LogEvent\.MESSAGE_IN[^]*?\} catch \(failure: unknown\)/.test(s.body), 'message_in snippet never throws');
  });
});

test('nest context carries the OpenTelemetry trace ids and binds the handler on every Nest 10 release', async () => {
  await withRealCatalog(async (c) => {
    const s = nestSkill(c, LOGGING);
    const ctx = s.file('request-context.ts');
    assert.ok(ctx.includes("import { isSpanContextValid, trace } from '@opentelemetry/api';") && ctx.includes('trace.getActiveSpan()'));
    assert.ok(ctx.includes('...activeTraceFields()'), 'contextLogFields adds traceId and spanId');
    const interceptor = s.file('request-context.interceptor.ts');
    assert.ok(interceptor.includes('new Observable<unknown>((subscriber) =>') && interceptor.includes('next.handle().subscribe(subscriber)'),
      'the subscription itself runs inside the context');
    assert.ok(s.file('request-context.spec.ts').includes("jest.spyOn(trace, 'getActiveSpan')"));
    const env = s.file('env.ts');
    assert.ok(env.includes("NODE_ENV?: 'development' | 'test' | 'production';") && env.includes('JWKS_URI must use https'), 'https outside development and test');
    assert.ok(s.file('env.spec.ts').includes('JWKS_URI must use https'));
    assert.ok(/`jwks-rsa`[^\n]*ask/.test(s.body) || s.body.includes('Dependencies (ask the user before adding any)'));
    assert.ok(/`pino-pretty` as a dev dependency/.test(s.body));
  });
});

test('nest tenant entities in a transaction go through withManager only', async () => {
  await withRealCatalog(async (c) => {
    const s = nestSkill(c, ENTITY);
    const repo = s.file('tenant-scoped.repository.ts');
    assert.ok(repo.includes('withManager(manager: EntityManager): this {'), 'withManager keeps the subclass API');
    assert.ok(!s.file('tenant.subscriber.ts').includes('every path that reaches TypeORM'), 'the subscriber claims no more than it guards');
    const spec = s.file('customer-profile.persistence.spec.ts');
    assert.ok(spec.includes('inside a transaction') && spec.includes('profiles.withManager(manager)'));
    assert.ok(spec.includes('toBeGreaterThanOrEqual(inserted?.updatedAt.getTime()'), 'no millisecond race on updatedAt');
    assert.ok(s.body.includes('withManager(manager)') && s.body.includes('manager.getRepository('), 'skill shows the path and names the banned one');
    const rules = c.stacks.get('nestjs').rules.body;
    assert.ok(rules.includes('withManager(manager)') && !rules.includes('all work inside through `manager`'), 'stack rule transaction bullet');
    assert.ok(!rules.includes('@Roles('), 'no reference to a roles decorator that does not exist');
    const addon = c.addons.get('typeorm').rules.body;
    assert.ok(addon.includes('withManager(manager)') && addon.includes('never `manager.getRepository(Entity)`'), 'add-on transaction bullet');
    assert.ok(!addon.includes('Do all work in the transaction through its manager.'));
  });
});
