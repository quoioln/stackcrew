import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { validateCatalog } from '../src/catalog/validate.js';
import { createProfile } from '../src/profile.js';
import { buildContext } from '../src/render/context.js';
import { renderShared } from '../src/render/shared.js';

const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'catalog-mini');
const OPTS = { cli: 'npx stackcrew', version: '9.9.9' };

async function tsCtx(conventions) {
  const catalog = await loadCatalog(MINI);
  const profile = createProfile({ stack: 'demo-ts', mode: 'greenfield' }, catalog);
  if (conventions) profile.conventions = conventions;
  return buildContext(catalog, profile, OPTS);
}

const guardOf = (ctx) => JSON.parse(renderShared(ctx).find((o) => o.path === '.stackcrew/guard.json').content);

test('loadGuard keeps globsFrom', async () => {
  const c = await loadCatalog(MINI);
  assert.equal(c.stacks.get('demo-ts').guard[0].globsFrom, 'typeFreeFiles');
  assert.equal(c.languages.get('typescript').guard[0].globsFrom, undefined);
  assert.deepEqual(validateCatalog(c), []);
});

test('globsFrom rule takes typeFreeFiles from conventions', async () => {
  const ctx = await tsCtx({ typeFreeFiles: ['src/**/*.handler.ts'] });
  const rule = guardOf(ctx).rules.find((r) => r.id === 'SC-TYPEFILE');
  assert.deepEqual(rule.globs, ['src/**/*.handler.ts']);
  assert.ok(guardOf(ctx).rules.every((r) => !('globsFrom' in r)));
  assert.deepEqual(Object.keys(rule), ['id', 'globs', 'excludeGlobs', 'regex', 'flags', 'message']);
});

test('globsFrom rule keeps catalog globs when typeFreeFiles is empty', async () => {
  const rule = guardOf(await tsCtx()).rules.find((r) => r.id === 'SC-TYPEFILE');
  assert.deepEqual(rule.globs, ['**/*.service.ts']);
  assert.ok(!('globsFrom' in rule));
});

test('validator rejects an unknown globsFrom value', async () => {
  const c = await loadCatalog(MINI);
  c.stacks.get('demo-ts').guard[0].globsFrom = 'somethingElse';
  assert.ok(validateCatalog(c).some((e) => e.includes('guard rule "SC-TYPEFILE"') && e.includes('globsFrom')));
});

test('language lint files render into .stackcrew/lint before stack lint files', async () => {
  const ctx = await tsCtx();
  const paths = renderShared(ctx).map((o) => o.path);
  assert.ok(paths.includes('.stackcrew/lint/demo-lint.json'));
  const op = renderShared(ctx).find((o) => o.path === '.stackcrew/lint/demo-lint.json');
  assert.ok(op.content.includes('"stack": "demo-ts"'));
  const c = await loadCatalog(MINI);
  assert.deepEqual(c.languages.get('typescript').lintFiles.map((f) => f.relPath), ['demo-lint.json']);
  assert.deepEqual(c.languages.get('java').lintFiles, []);
});

test('language lint files go through the placeholder check', async () => {
  const c = await loadCatalog(MINI);
  c.languages.get('typescript').lintFiles[0].content += '{{sc:nope}}';
  assert.ok(validateCatalog(c).some((e) => e.includes('{{sc:nope}}') && e.includes('languages/typescript/lint/demo-lint.json')));
});

test('a stack lint file with the same name as its language lint file is a catalog error', async () => {
  const c = await loadCatalog(MINI);
  c.stacks.get('demo-ts').lintFiles.push({ relPath: 'demo-lint.json', content: '{}' });
  assert.ok(validateCatalog(c).some((e) => e.startsWith('stacks/demo-ts/stack.json: ') && e.includes('lint/demo-lint.json') && e.includes('lint file of language')));
});
