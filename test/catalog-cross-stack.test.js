import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { loadCatalog } from '../src/catalog/load.js';
import { validateCatalog, BANNED_ORCHESTRATION } from '../src/catalog/validate.js';
import { detectProject } from '../src/detect.js';
import { createProfile } from '../src/profile.js';
import { buildContext } from '../src/render/context.js';

const OPTS = { cli: 'npx stackcrew', version: '0.0.0' };

async function withRealCatalog(fn) {
  const saved = process.env.STACKCREW_CATALOG_DIR;
  delete process.env.STACKCREW_CATALOG_DIR;
  try {
    return await fn(await loadCatalog());
  } finally {
    if (saved !== undefined) process.env.STACKCREW_CATALOG_DIR = saved;
  }
}

const bullets = (essentials) => essentials.split('\n').filter((l) => /^- /.test(l)).length;

function stubStack(c, id, category) {
  return { ...c.stacks.get('spring-boot'), id, name: id, category };
}

test('core-persistence applies to backend and fullstack stacks only', async () => {
  await withRealCatalog(async (c) => {
    const stacks = new Map([...c.stacks, ['fe', stubStack(c, 'fe', 'frontend')], ['full', stubStack(c, 'full', 'fullstack')]]);
    const cat = { ...c, stacks };
    const idsFor = (stack) =>
      buildContext(cat, createProfile({ stack, tools: ['claude'], mode: 'greenfield', basePackage: 'com.acme' }, cat), OPTS).rules.map((r) => r.id);
    assert.ok(idsFor('spring-boot').includes('core-persistence'));
    assert.ok(idsFor('full').includes('core-persistence'));
    assert.ok(!idsFor('fe').includes('core-persistence'));
    const rule = c.coreRules.find((r) => r.id === 'core-persistence');
    assert.deepEqual(rule.categories, ['backend', 'fullstack']);
  });
});

test('persistence rule renders the project conventions', async () => {
  await withRealCatalog(async (c) => {
    const profile = createProfile({ stack: 'spring-boot', tools: ['claude'], mode: 'greenfield', basePackage: 'com.acme' }, c);
    profile.conventions = { baseEntity: 'AuditedEntity', baseTenantEntity: 'AuditedTenantEntity', crossTenantRoles: ['ops'], sharedLibraries: ['@acme/core'] };
    const rule = buildContext(c, profile, OPTS).rules.find((r) => r.id === 'core-persistence');
    assert.ok(rule, 'rule present');
    for (const needle of ['AuditedEntity', 'AuditedTenantEntity', '`ops`', '`@acme/core`', 'tenant_id', 'tenantId', 'system', 'roles', 'x-tenant-id', 'x-user-id', 'x-request-id', 'runCrossTenant']) {
      assert.ok(rule.body.includes(needle), `missing ${needle}`);
    }
    for (const field of ['createdAt', 'createdBy', 'updatedAt', 'updatedBy']) assert.ok(rule.body.includes(field), field);
    assert.ok(!rule.body.includes('{{sc:'));
    assert.ok(/audit fields filled/i.test(rule.body) && /tenant A cannot read tenant B/i.test(rule.body));
  });
});

test('core-logging logs masked bodies and names both config keys', async () => {
  await withRealCatalog(async (c) => {
    const log = c.coreRules.find((r) => r.id === 'core-logging');
    assert.ok(!/do not log full bodies/i.test(log.body), 'old no-body rule is gone');
    for (const needle of ['LOG_MASK_FIELDS', 'app.logging.mask-fields', 'LOG_BODIES', 'app.logging.log-bodies', 'LOG_MAX_BODY_BYTES', 'app.logging.max-body-bytes', 'http_in', 'http_out', 'message_in', 'durationMs', '<base64 N bytes>', '16 KB', 'content-type', 'user-agent']) {
      assert.ok(log.body.includes(needle), `missing ${needle}`);
    }
    assert.ok(/release gate/i.test(log.body), 'release gate kept');
    assert.ok(bullets(log.essentials) <= 15);
    const obs = c.addons.get('observability').rules.body;
    assert.ok(/release gate/i.test(obs) && /masker/i.test(obs), 'observability keeps the gate and names the masker');
  });
});

test('typeorm add-on is detected from package.json for typescript only', async () => {
  await withRealCatalog(async (c) => {
    const a = c.addons.get('typeorm');
    assert.ok(a, 'typeorm add-on exists');
    assert.deepEqual(a.languages, ['typescript']);
    assert.deepEqual(a.detect, { files: [], contains: [], excludeContains: [], packageDeps: ['typeorm'] });
    assert.equal(a.rules.id, 'addon-typeorm');
    assert.ok(/AuditSubscriber/.test(a.rules.body) && /TenantScopedRepository/.test(a.rules.body) && /synchronize: false/.test(a.rules.body));
    const nest = { ...c.stacks.get('spring-boot'), id: 'nest', language: 'typescript', detect: { files: [], contains: [], excludeContains: [], packageDeps: ['@nestjs/core'] } };
    const cat = { ...c, stacks: new Map([['nest', nest]]) };
    const dir = await mkdtemp(path.join(os.tmpdir(), 'sc-typeorm-'));
    try {
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0', typeorm: '^0.3.20' } }));
      assert.deepEqual((await detectProject(dir, cat)).addons, ['typeorm']);
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0', 'typeorm-extension': '^3.0.0' } }));
      assert.deepEqual((await detectProject(dir, cat)).addons, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('cross-stack content has no banned phrases and bounded essentials', async () => {
  await withRealCatalog(async (c) => {
    assert.deepEqual(validateCatalog(c), []);
    const docs = [
      c.coreRules.find((r) => r.id === 'core-persistence'),
      c.coreRules.find((r) => r.id === 'core-logging'),
      c.addons.get('typeorm').rules,
      c.addons.get('observability').rules,
    ];
    for (const d of docs) {
      assert.ok(d, 'doc exists');
      assert.ok(bullets(d.essentials) >= 5 && bullets(d.essentials) <= 15, `${d.id} essentials ${bullets(d.essentials)}`);
      const lower = d.body.toLowerCase();
      for (const p of BANNED_ORCHESTRATION) assert.ok(!lower.includes(p), `${d.id}: ${p}`);
      assert.ok(Buffer.byteLength(d.body) < 24000);
    }
  });
});
