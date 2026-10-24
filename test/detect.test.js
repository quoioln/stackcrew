import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { detectProject } from '../src/detect.js';

const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'catalog-mini');

async function withDir(files, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sc-detect-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SPRING_POM = '<project><parent><artifactId>org.springframework.boot</artifactId></parent></project>';

test('detects demo-java from pom with spring boot', async () => {
  const c = await loadCatalog(MINI);
  await withDir({ 'pom.xml': SPRING_POM }, async (dir) => {
    const r = await detectProject(dir, c);
    assert.equal(r.stack, 'demo-java');
    assert.deepEqual(r.candidates, ['demo-java']);
    assert.equal(r.mode, 'brownfield');
  });
});

test('excludeContains rejects quarkus pom', async () => {
  const c = await loadCatalog(MINI);
  await withDir({ 'pom.xml': SPRING_POM + '<x>io.quarkus</x>' }, async (dir) => {
    const r = await detectProject(dir, c);
    assert.equal(r.stack, null);
    assert.deepEqual(r.candidates, []);
  });
});

test('tie between equal-priority stacks yields null + candidates', async () => {
  const base = await loadCatalog(MINI);
  const demo = base.stacks.get('demo-java');
  const stacks = new Map(base.stacks);
  stacks.set('demo-java-2', { ...demo, id: 'demo-java-2', name: 'Demo Java 2' });
  const c = { ...base, stacks };
  await withDir({ 'pom.xml': SPRING_POM }, async (dir) => {
    const r = await detectProject(dir, c);
    assert.equal(r.stack, null);
    assert.deepEqual([...r.candidates].sort(), ['demo-java', 'demo-java-2']);
  });
});

test('higher priority wins over lower', async () => {
  const base = await loadCatalog(MINI);
  const demo = base.stacks.get('demo-java');
  const stacks = new Map(base.stacks);
  stacks.set('hi', { ...demo, id: 'hi', priority: demo.priority + 5 });
  await withDir({ 'pom.xml': SPRING_POM }, async (dir) => {
    const r = await detectProject(dir, { ...base, stacks });
    assert.equal(r.stack, 'hi');
    assert.equal(r.candidates.length, 2);
  });
});

test('package.json deps match; malformed package.json does not throw', async () => {
  const base = await loadCatalog(MINI);
  const demo = base.stacks.get('demo-java');
  const web = { ...demo, id: 'web', language: 'ts', detect: { files: [], contains: [], excludeContains: [], packageDeps: ['react'] } };
  const c = { ...base, stacks: new Map([['web', web]]), addons: new Map() };
  await withDir({ 'package.json': JSON.stringify({ devDependencies: { react: '1' } }) }, async (dir) => {
    assert.equal((await detectProject(dir, c)).stack, 'web');
  });
  await withDir({ 'package.json': '{oops' }, async (dir) => {
    const r = await detectProject(dir, c);
    assert.equal(r.stack, null);
    assert.equal(r.mode, 'brownfield');
  });
});

test('reads a BOM-prefixed package.json', async () => {
  const base = await loadCatalog(MINI);
  const demo = base.stacks.get('demo-java');
  const web = { ...demo, id: 'web', language: 'ts', detect: { files: [], contains: [], excludeContains: [], packageDeps: ['react'] } };
  const c = { ...base, stacks: new Map([['web', web]]), addons: new Map() };
  const json = JSON.stringify({ dependencies: { react: '1' } });
  await withDir({ 'package.json': '\uFEFF' + json }, async (dir) => {
    assert.equal((await detectProject(dir, c)).stack, 'web');
  });
});

test('empty dir is greenfield with no stack', async () => {
  const c = await loadCatalog(MINI);
  await withDir({}, async (dir) => {
    const r = await detectProject(dir, c);
    assert.deepEqual(r, { stack: null, candidates: [], addons: [], mode: 'greenfield', basePackage: null });
  });
});

test('src dir alone makes it brownfield', async () => {
  const c = await loadCatalog(MINI);
  await withDir({ 'src/readme.txt': 'x' }, async (dir) => {
    assert.equal((await detectProject(dir, c)).mode, 'brownfield');
  });
});

test('finds basePackage from @SpringBootApplication', async () => {
  const c = await loadCatalog(MINI);
  await withDir({
    'pom.xml': SPRING_POM,
    'src/main/java/com/example/kyc/Other.java': 'package com.example.kyc.other;\nclass Other {}\n',
    'src/main/java/com/example/kyc/App.java': 'package com.example.kyc;\n\n@SpringBootApplication\npublic class App {}\n',
  }, async (dir) => {
    assert.equal((await detectProject(dir, c)).basePackage, 'com.example.kyc');
  });
});

test('basePackage is null when no @SpringBootApplication', async () => {
  const c = await loadCatalog(MINI);
  await withDir({ 'pom.xml': SPRING_POM, 'src/main/java/A.java': 'package a;\nclass A {}\n' }, async (dir) => {
    assert.equal((await detectProject(dir, c)).basePackage, null);
  });
});

test('detects addon by pom content', async () => {
  const c = await loadCatalog(MINI);
  await withDir({ 'pom.xml': SPRING_POM + '<artifactId>spring-kafka</artifactId>' }, async (dir) => {
    assert.deepEqual((await detectProject(dir, c)).addons, ['demo-addon']);
  });
});

test('no addons reported when no stack detected', async () => {
  const c = await loadCatalog(MINI);
  await withDir({ 'pom.xml': '<artifactId>spring-kafka</artifactId>' }, async (dir) => {
    const r = await detectProject(dir, c);
    assert.equal(r.stack, null);
    assert.deepEqual(r.addons, []);
  });
});
