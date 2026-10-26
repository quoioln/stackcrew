import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { validateCatalog } from '../src/catalog/validate.js';
import { compileGuardRules, scanLines } from '../src/guard/scan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS_DIR = path.join(ROOT, 'catalog', 'languages', 'typescript');

async function withRealCatalog(fn) {
  const saved = process.env.STACKCREW_CATALOG_DIR;
  delete process.env.STACKCREW_CATALOG_DIR;
  try {
    return await fn(await loadCatalog());
  } finally {
    if (saved !== undefined) process.env.STACKCREW_CATALOG_DIR = saved;
  }
}

test('typescript language loads, validates and has lang-typescript rule', async () => {
  await withRealCatalog(async (c) => {
    assert.deepEqual(validateCatalog(c), []);
    const lang = c.languages.get('typescript');
    assert.ok(lang, 'typescript language exists');
    assert.equal(lang.rule.id, 'lang-typescript');
    assert.ok(lang.rule.body.includes('{{sc:sharedLibraries}}'));
    const essentials = lang.rule.body.split('## Essentials')[1].split(/\n## /)[0];
    assert.ok(essentials.split('\n').filter((l) => l.startsWith('- ')).length <= 15);
  });
});

test('typescript guard blocks any forms, ts-ignore, process.env outside config, hardcoded URL; allows the waived and excluded cases', async () => {
  await withRealCatalog(async (c) => {
    const guard = c.languages.get('typescript').guard;
    const compiled = compileGuardRules(guard);
    assert.deepEqual([...new Set(guard.map((r) => r.id))].sort(), ['SC-CONST', 'SC-ENV', 'SC-IGNORE', 'SC-TYPE']);
    const TEST_EXCLUDES = ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/*.test.tsx', '**/test/**', '**/tests/**', '**/e2e/**', '**/__tests__/**'];
    for (const r of guard) {
      assert.deepEqual(r.globs, ['**/*.ts', '**/*.tsx']);
      if (r.id === 'SC-IGNORE') assert.ok(!r.excludeGlobs?.length, 'SC-IGNORE applies to tests too');
      else for (const g of TEST_EXCLUDES) assert.ok(r.excludeGlobs.includes(g), `${r.id} excludes ${g}`);
      assert.ok(r.message.includes('stackcrew-allow: ' + r.id), `${r.id} message names the waiver`);
    }
    const scan = (file, text) => scanLines(file, [{ line: 1, text }], compiled).map((v) => v.ruleId);
    const SRC = 'src/orders/order.service.ts';
    for (const line of ['const x: any = 1;', 'const y = foo as any;', 'const p: Promise<any> = go();', 'const r: Record<string, any> = {};', 'const a: any[] = [];', 'const f = (a) => any;', 'type U = string | any;', 'function f(a: any) {}']) {
      assert.deepEqual(scan(SRC, line), ['SC-TYPE'], line);
    }
    for (const line of ['const company = 1;', '// x: any in comment', ' * a: any in jsdoc', '/* x: any */', 'const many = 2;', 'const anything: string = "";', 'const x: unknown = 1;']) {
      assert.deepEqual(scan(SRC, line), [], line);
    }
    assert.deepEqual(scan(SRC, 'const x: any = 1; // stackcrew-allow: SC-TYPE boundary'), []);
    assert.deepEqual(scan(SRC, '// @ts-ignore'), ['SC-IGNORE']);
    assert.deepEqual(scan(SRC, '// @ts-nocheck'), ['SC-IGNORE']);
    assert.deepEqual(scan('src/a.spec.ts', '// @ts-ignore'), ['SC-IGNORE']);
    assert.deepEqual(scan(SRC, '// @ts-expect-error legacy typing'), []);
    assert.deepEqual(scan(SRC, 'const k = process.env.API_KEY;'), ['SC-ENV']);
    assert.deepEqual(scan('src/config/app.config.ts', 'const k = process.env.API_KEY;'), []);
    for (const f of ['src/env.ts', 'src/env.mjs', 'src/env/index.ts', 'next.config.mjs', 'vitest.config.ts', 'src/a.spec.ts', 'test/x.ts']) {
      assert.deepEqual(scan(f, 'const k = process.env.API_KEY;'), [], f);
    }
    assert.deepEqual(scan(SRC, '// uses process.env here'), []);
    assert.deepEqual(scan(SRC, "const url = 'https://api.example.com/v1';"), ['SC-CONST']);
    assert.deepEqual(scan(SRC, 'const url = `https://${host}/v1`;'), ['SC-CONST']);
    assert.deepEqual(scan(SRC, "const API_URL = 'https://a.b';"), []);
    assert.deepEqual(scan(SRC, "export const API_URL = 'https://a.b';"), []);
    assert.deepEqual(scan('src/a.spec.ts', "const u = 'https://a.b';"), []);
    assert.deepEqual(scan('src/a.js', 'const x: any = 1;'), []);
  });
});

test('typescript guard.json keeps its regex escapes byte-exact', async () => {
  const text = await readFile(path.join(TS_DIR, 'guard.json'), 'utf8');
  const byId = (id) => JSON.parse(text).rules.filter((r) => r.id === id).map((r) => r.regex);
  const BS = String.fromCharCode(92);
  const SKIP = `^(?!${BS}s*(${BS}*|//|/${BS}*))`;
  assert.deepEqual(byId('SC-TYPE'), [
    `${SKIP}.*(${BS}bas${BS}s+any${BS}b|:${BS}s*any${BS}b|=>${BS}s*any${BS}b|${BS}|${BS}s*any${BS}b|<${BS}s*any${BS}s*[>,]|,${BS}s*any${BS}s*[>,]|${BS}bany${BS}[${BS}])`,
  ]);
  assert.deepEqual(byId('SC-IGNORE'), [`@ts-(ignore|nocheck)${BS}b`]);
  assert.deepEqual(byId('SC-ENV'), [`${SKIP}.*${BS}bprocess${BS}.env${BS}b`]);
  assert.deepEqual(byId('SC-CONST'), [`${SKIP}(?!${BS}s*(export${BS}s+)?const${BS}s+[A-Z][A-Z0-9_]*${BS}s*=).*['"${'`'}]https?://`]);
  assert.ok(!text.includes(String.fromCharCode(8)), 'no raw backspace byte');
});

test('typescript language ships both ESLint variants', async () => {
  await withRealCatalog(async (c) => {
    const files = c.languages.get('typescript').lintFiles;
    assert.deepEqual(files.map((f) => f.relPath).sort(), ['eslint.stackcrew.mjs', 'eslintrc.stackcrew.cjs']);
    const flat = files.find((f) => f.relPath === 'eslint.stackcrew.mjs').content;
    assert.ok(flat.includes('export default ['));
    assert.ok(!/plugins\s*:/.test(flat), 'flat config registers no plugins');
    assert.ok(flat.includes('@typescript-eslint/no-restricted-types'));
  });
});

test('legacy ESLint config omits no-restricted-types', async () => {
  await withRealCatalog(async (c) => {
    const legacy = c.languages.get('typescript').lintFiles.find((f) => f.relPath === 'eslintrc.stackcrew.cjs').content;
    assert.ok(legacy.includes('module.exports'));
    assert.ok(!legacy.includes("'@typescript-eslint/no-restricted-types'"), 'rule key absent');
    assert.ok(legacy.includes('@typescript-eslint/no-explicit-any'));
    assert.ok(legacy.includes('@typescript-eslint/no-magic-numbers'));
  });
});
