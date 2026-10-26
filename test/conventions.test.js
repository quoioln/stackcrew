import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { createProfile, validateProfile } from '../src/profile.js';
import { buildContext } from '../src/render/context.js';
import { renderShared } from '../src/render/shared.js';
import { renderProject } from '../src/render/index.js';
import { CONVENTION_DEFAULTS, CONVENTION_VAR_NAMES, resolveConventions, validateConventions, conventionVars } from '../src/conventions.js';
import { miniCtx } from '../test-helpers/render-ctx.js';

const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'catalog-mini');
const OPTS = { cli: 'npx stackcrew', version: '9.9.9' };

test('resolveConventions fills defaults and keeps declared values', () => {
  const c = resolveConventions({ conventions: { baseEntity: 'AuditedEntity', sharedLibraries: ['@acme/core'] } });
  assert.equal(c.baseEntity, 'AuditedEntity');
  assert.equal(c.tenantClaim, 'tenant_id');
  assert.deepEqual(c.crossTenantRoles, ['super_admin']);
  assert.deepEqual(c.sharedLibraries, ['@acme/core']);
  assert.ok(Object.isFrozen(CONVENTION_DEFAULTS));
  c.crossTenantRoles.push('x');
  assert.deepEqual(CONVENTION_DEFAULTS.crossTenantRoles, ['super_admin']);
});

test('conventionVars serializes arrays and empty lists', () => {
  const v = conventionVars(resolveConventions({}));
  assert.equal(v.crossTenantRoles, '`super_admin`');
  assert.equal(v.sharedLibraries, 'none declared (set conventions.sharedLibraries in stackcrew.json)');
  assert.equal(conventionVars(resolveConventions({ conventions: { crossTenantRoles: [] } })).crossTenantRoles,
    'none (cross-tenant access is disabled)');
  assert.equal(conventionVars(resolveConventions({ conventions: { sharedLibraries: ['a', 'b'] } })).sharedLibraries, '`a`, `b`');
  assert.equal(v.systemUser, 'system');
  assert.ok(!('typeFreeFiles' in v));
  assert.deepEqual(Object.keys(v), CONVENTION_VAR_NAMES);
});

test('crossTenantRolesCsv is the plain comma-joined role list, empty for no roles', () => {
  assert.ok(CONVENTION_VAR_NAMES.includes('crossTenantRolesCsv'));
  assert.ok(!Object.keys(CONVENTION_DEFAULTS).includes('crossTenantRolesCsv'), 'a variable, not a convention key');
  assert.equal(conventionVars(resolveConventions({})).crossTenantRolesCsv, 'super_admin');
  assert.equal(conventionVars(resolveConventions({ conventions: { crossTenantRoles: ['ops', 'report_admin'] } })).crossTenantRolesCsv, 'ops,report_admin');
  assert.equal(conventionVars(resolveConventions({ conventions: { crossTenantRoles: [] } })).crossTenantRolesCsv, '');
  assert.ok(validateConventions({ crossTenantRolesCsv: 'x' }).some((m) => m.includes('unknown key "crossTenantRolesCsv"')), 'not settable in stackcrew.json');
});

test('validateConventions rejects unknown key, bad identifier, unsafe path', () => {
  const e = validateConventions({ baseEnity: 'X', baseEntity: 'Base Entity', sharedComponents: '../ui' });
  assert.ok(e.some((m) => m.includes('unknown key "baseEnity"')));
  assert.ok(e.some((m) => m.startsWith('conventions.baseEntity:')));
  assert.ok(e.some((m) => m.startsWith('conventions.sharedComponents:')));
});

test('validateConventions accepts a full valid block and rejects the other bad shapes', () => {
  assert.deepEqual(validateConventions({ ...CONVENTION_DEFAULTS, sharedLibraries: ['@acme/core'], typeFreeFiles: ['src/a.ts'] }), []);
  assert.deepEqual(validateConventions({}), []);
  const bad = validateConventions({
    tenantClaim: 'a b', rolesClaim: '', systemUser: 5, tenantColumn: '1x',
    sharedLibraries: [''], crossTenantRoles: 'x', typeFreeFiles: [1],
  });
  for (const k of ['tenantClaim', 'rolesClaim', 'systemUser', 'tenantColumn', 'sharedLibraries', 'crossTenantRoles', 'typeFreeFiles']) {
    assert.ok(bad.some((m) => m.startsWith(`conventions.${k}:`)), k);
  }
  const BS = String.fromCharCode(92);
  for (const p of ['/abs', `a${BS}b`, 'a/../b', '']) {
    assert.ok(validateConventions({ sharedComponents: p }).some((m) => m.startsWith('conventions.sharedComponents:')), p);
  }
  assert.deepEqual(validateConventions({ sharedComponents: 'src/ui/..x' }), []);
  assert.deepEqual(validateConventions('x'), ['conventions: must be an object']);
  assert.deepEqual(validateConventions([]), ['conventions: must be an object']);
});

test('a 0.1.1 spring profile validates and renders with default conventions', async () => {
  const catalog = await loadCatalog();
  const profile = {
    version: 1, stack: 'spring-boot', addons: [], tools: ['claude'], mode: 'greenfield', guard: true,
    context: {}, decisions: [], java: { basePackage: 'com.acme', wired: false },
  };
  assert.deepEqual(validateProfile(profile, catalog), []);
  const ctx = buildContext(catalog, profile, OPTS);
  assert.equal(ctx.vars.baseEntity, 'BaseEntity');
  assert.equal(ctx.conventions.systemUser, 'system');
  assert.ok(renderProject(ctx).ops.length > 0);
});

test('validateProfile checks node.wired and conventions', async () => {
  const c = await loadCatalog(MINI);
  const p = createProfile({ stack: 'demo-java', mode: 'greenfield' }, c);
  assert.deepEqual(validateProfile({ ...p, node: { wired: true }, conventions: { baseEntity: 'X' } }, c), []);
  assert.ok(validateProfile({ ...p, node: { wired: 'yes' } }, c).some((e) => e.startsWith('node.wired:')));
  assert.ok(validateProfile({ ...p, conventions: { baseEnity: 'X' } }, c).some((e) => e.includes('unknown key "baseEnity"')));
});

test('createProfile adds node.wired false for a typescript stack', () => {
  const catalog = { stacks: new Map([['x', { language: 'typescript' }]]) };
  const p = createProfile({ stack: 'x', mode: 'greenfield' }, catalog);
  assert.deepEqual(p.node, { wired: false });
  assert.equal(p.java, undefined);
});

test('profile doc lists conventions with their source', async () => {
  const ctx = await miniCtx(['claude']);
  ctx.profile.conventions = { baseEntity: 'AuditedEntity' };
  const rebuilt = buildContext(ctx.catalog, ctx.profile, OPTS);
  const md = renderShared(rebuilt).find((o) => o.path === 'docs/stackcrew/architecture-profile.md').content;
  assert.ok(md.indexOf('## Context') < md.indexOf('## Conventions'));
  assert.ok(md.indexOf('## Conventions') < md.indexOf('## Decisions'));
  assert.ok(md.includes('| Key | Value | Source |'));
  assert.ok(md.includes('| baseEntity | AuditedEntity | stackcrew.json |'));
  assert.ok(md.includes('| tenantClaim | tenant_id | default |'));
  assert.ok(md.includes('| crossTenantRoles | `super_admin` | default |'));
  assert.ok(md.includes('| typeFreeFiles | _none_ | default |'));
});

test('convention placeholders render in rule bodies', async () => {
  const catalog = await loadCatalog(MINI);
  catalog.stacks.get('demo-java').rules.body += '\nBase: {{sc:baseEntity}} roles: {{sc:crossTenantRoles}}\n';
  const profile = createProfile({ stack: 'demo-java', mode: 'greenfield' }, catalog);
  profile.conventions = { baseEntity: 'AuditedEntity' };
  const ctx = buildContext(catalog, profile, OPTS);
  const rule = ctx.rules.find((r) => r.id === 'stack-demo-java');
  assert.ok(rule.body.includes('Base: AuditedEntity roles: `super_admin`'));
  assert.ok(!rule.body.includes('{{sc:'));
});
