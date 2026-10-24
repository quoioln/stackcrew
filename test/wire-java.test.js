import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { main } from '../src/cli.js';
import { ARCHUNIT_VERSION, planJavaWiring } from '../src/wire/java.js';

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

const POM = `<project>
  <dependencyManagement>
    <dependencies>
      <dependency><groupId>x</groupId><artifactId>bom</artifactId></dependency>
    </dependencies>
  </dependencyManagement>
  <!-- <dependencies></dependencies> -->
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <dependencies>
          <dependency><groupId>p</groupId><artifactId>q</artifactId></dependency>
        </dependencies>
      </plugin>
    </plugins>
  </build>
</project>
`;

const one = (r, p) => r.edits.find((e) => e.path === p);

test('ARCHUNIT_VERSION is a 1.x version', () => {
  assert.match(ARCHUNIT_VERSION, /^1\.\d+\.\d+$/);
});

test('pom: inserts block into project dependencies, not dependencyManagement', () => {
  const r = planJavaWiring({ pomXml: POM });
  const out = one(r, 'pom.xml').content;
  const block = out.indexOf('<!-- stackcrew:begin -->');
  assert.ok(block > out.indexOf('</dependencyManagement>'));
  assert.ok(block < out.indexOf('<build>'));
  assert.ok(out.includes('<artifactId>archunit-junit5</artifactId>'));
  assert.ok(out.includes(`<version>${ARCHUNIT_VERSION}</version>`));
  assert.ok(out.includes('<scope>test</scope>'));
  assert.ok(out.indexOf('<!-- stackcrew:end -->') < out.indexOf('  </dependencies>\n  <build>'));
  assert.match(out, /\n {4}<!-- stackcrew:begin -->\n {4}<dependency>\n/);
  assert.equal(out.split('archunit-junit5').length, 2);
  assert.deepEqual(r.notes, []);
});

test('pom: second run is identical, and CRLF is kept', () => {
  const first = one(planJavaWiring({ pomXml: POM }), 'pom.xml').content;
  assert.equal(one(planJavaWiring({ pomXml: first }), 'pom.xml').content, first);
  const crlf = POM.replace(/\n/g, '\r\n');
  const c1 = one(planJavaWiring({ pomXml: crlf }), 'pom.xml').content;
  assert.ok(!/(?<!\r)\n/.test(c1), 'no bare LF in CRLF file');
  assert.equal(one(planJavaWiring({ pomXml: c1 }), 'pom.xml').content, c1);
});

test('pom: stale version in an existing block is replaced in place', () => {
  const first = one(planJavaWiring({ pomXml: POM }), 'pom.xml').content;
  const stale = first.replace(`<version>${ARCHUNIT_VERSION}</version>`, '<version>0.1.0</version>');
  assert.equal(one(planJavaWiring({ pomXml: stale }), 'pom.xml').content, first);
});

test('pom without project dependencies returns a note, no edit', () => {
  const r = planJavaWiring({
    pomXml: '<project>\n  <dependencyManagement><dependencies></dependencies></dependencyManagement>\n</project>\n',
  });
  assert.deepEqual(r.edits, []);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /pom\.xml/);
  assert.match(r.notes[0], /archunit-junit5/);
});

test('pom: indent falls back to closing indent + 4 when no dependency exists', () => {
  const out = one(planJavaWiring({ pomXml: '<project>\n  <dependencies>\n  </dependencies>\n</project>\n' }), 'pom.xml').content;
  assert.match(out, /\n {6}<!-- stackcrew:begin -->\n/);
  assert.match(out, /<!-- stackcrew:end -->\n {2}<\/dependencies>/);
});

const KTS = `plugins { java }
buildscript {
    dependencies {
        classpath("x:y:1")
    }
}
// dependencies {
/* dependencies { */
val s = "dependencies {"
dependencies {
    implementation("a:b:1")
}
`;

test('gradle kts and groovy: block after top-level dependencies, not buildscript', () => {
  const k = one(planJavaWiring({ buildGradleKts: KTS }), 'build.gradle.kts').content;
  assert.ok(k.includes(`    testImplementation("com.tngtech.archunit:archunit-junit5:${ARCHUNIT_VERSION}")`));
  assert.ok(k.indexOf('// stackcrew:begin') > k.indexOf('val s ='));
  assert.match(k, /dependencies \{\n {4}\/\/ stackcrew:begin\n {4}testImplementation\(.*\)\n {4}\/\/ stackcrew:end\n {4}implementation\("a:b:1"\)/);
  const g = one(planJavaWiring({ buildGradle: KTS.replace('plugins { java }', "plugins { id 'java' }") }), 'build.gradle').content;
  assert.ok(g.includes(`    testImplementation 'com.tngtech.archunit:archunit-junit5:${ARCHUNIT_VERSION}'`));
  assert.ok(g.indexOf('// stackcrew:begin') > g.indexOf('val s ='));
});

test('gradle: idempotent, CRLF kept, and one-line dependencies block works', () => {
  const k = one(planJavaWiring({ buildGradleKts: KTS }), 'build.gradle.kts').content;
  assert.equal(one(planJavaWiring({ buildGradleKts: k }), 'build.gradle.kts').content, k);
  const crlf = KTS.replace(/\n/g, '\r\n');
  const c = one(planJavaWiring({ buildGradleKts: crlf }), 'build.gradle.kts').content;
  assert.ok(!/(?<!\r)\n/.test(c));
  const inline = one(planJavaWiring({ buildGradle: 'dependencies { implementation "a:b:1" }\n' }), 'build.gradle').content;
  assert.match(inline, /\/\/ stackcrew:end\n implementation "a:b:1" \}\n$/);
  assert.equal(one(planJavaWiring({ buildGradle: inline }), 'build.gradle').content, inline);
});

test('gradle without top-level dependencies returns a note, no edit', () => {
  const r = planJavaWiring({ buildGradle: 'buildscript {\n  dependencies { classpath "x:y:1" }\n}\n' });
  assert.deepEqual(r.edits, []);
  assert.match(r.notes[0], /build\.gradle/);
});

test('several build files are all wired', () => {
  const r = planJavaWiring({ pomXml: POM, buildGradle: 'dependencies {\n}\n', buildGradleKts: 'dependencies {\n}\n' });
  assert.deepEqual(r.edits.map((e) => e.path).sort(), ['build.gradle', 'build.gradle.kts', 'pom.xml']);
});

test('half marker in a build file throws MARKER', () => {
  assert.throws(() => planJavaWiring({ buildGradle: 'dependencies {\n  // stackcrew:begin\n}\n' }), { code: 'MARKER' });
});

async function tmp() {
  const d = await mkdtemp(path.join(tmpdir(), 'stackcrew-wire-'));
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
const TEST_FILE = 'src/test/java/com/acme/app/stackcrew/StackcrewArchitectureTest.java';
async function javaProject(pom = POM) {
  const dir = await tmp();
  await mkdir(path.join(dir, 'src/main/java/com/acme/app'), { recursive: true });
  await writeFile(path.join(dir, 'src/main/java/com/acme/app/App.java'), 'package com.acme.app;\n@SpringBootApplication\nclass App {}\n');
  if (pom !== null) await writeFile(path.join(dir, 'pom.xml'), pom);
  assert.equal((await run(dir, 'init', '--stack', 'demo-java')).code, 0);
  return dir;
}

test('sync --wire on demo-java writes pom block and ArchUnit test file', async () => {
  const dir = await javaProject();
  const r = await run(dir, 'sync', '--wire');
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /wired: pom\.xml/);
  assert.match(r.out, /note: \.stackcrew\/lint\/checkstyle\.xml is generated but not wired; add maven-checkstyle-plugin \(or the Gradle checkstyle plugin\) pointing at it\./);
  assert.ok((await readFile(path.join(dir, 'pom.xml'), 'utf8')).includes('archunit-junit5'));
  assert.ok(existsSync(path.join(dir, TEST_FILE)));
  const profile = JSON.parse(await readFile(path.join(dir, 'stackcrew.json'), 'utf8'));
  assert.deepEqual(profile.java, { basePackage: 'com.acme.app', wired: true });
  const again = await run(dir, 'sync', '--wire');
  assert.equal(again.code, 0, again.err);
  assert.doesNotMatch(again.out, /wired: pom\.xml/);
});

test('sync --wire --dry-run writes nothing', async () => {
  const dir = await javaProject();
  const r = await run(dir, 'sync', '--wire', '--dry-run');
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /would wire: pom\.xml/);
  assert.equal(await readFile(path.join(dir, 'pom.xml'), 'utf8'), POM);
  assert.ok(!existsSync(path.join(dir, TEST_FILE)));
  assert.equal(JSON.parse(await readFile(path.join(dir, 'stackcrew.json'), 'utf8')).java.wired, false);
});

test('sync --wire with no base package exits 1', async () => {
  const dir = await tmp();
  assert.equal((await run(dir, 'init', '--stack', 'demo-java')).code, 0);
  const r = await run(dir, 'sync', '--wire');
  assert.equal(r.code, 1);
  assert.match(r.err, /set java\.basePackage in stackcrew\.json/);
});

test('sync --wire refuses a non-UTF-8 build file and writes nothing', async () => {
  const dir = await javaProject(null);
  await writeFile(path.join(dir, 'pom.xml'), Buffer.from([0xff, 0xfe, 0x3c, 0x00]));
  await writeFile(path.join(dir, 'build.gradle'), 'dependencies {\n}\n');
  const r = await run(dir, 'sync', '--wire');
  assert.equal(r.code, 1);
  assert.match(r.err, /pom\.xml: not UTF-8/);
  assert.equal(await readFile(path.join(dir, 'build.gradle'), 'utf8'), 'dependencies {\n}\n');
  assert.ok(!existsSync(path.join(dir, TEST_FILE)));
});

const DM_ONLY_POM = '<project>\n  <dependencyManagement>\n    <dependencies>\n      <dependency><groupId>x</groupId><artifactId>bom</artifactId></dependency>\n    </dependencies>\n  </dependencyManagement>\n</project>\n';

test('planJavaWiring: self-closing dependencies, profile-only pom, subprojects-only gradle, brace in string', () => {
  const sc = planJavaWiring({ pomXml: '<project>\n  <dependencies/>\n</project>\n' });
  assert.deepEqual([sc.edits, sc.wired], [[], []]);
  assert.equal(sc.notes.length, 1);
  const prof = planJavaWiring({ pomXml: '<project>\n  <profiles><profile><dependencies>\n  </dependencies></profile></profiles>\n</project>\n' });
  assert.deepEqual([prof.edits, prof.wired], [[], []]);
  const sub = planJavaWiring({ buildGradle: 'subprojects {\n  dependencies {\n    implementation "a:b:1"\n  }\n}\nallprojects { dependencies { } }\n' });
  assert.deepEqual([sub.edits, sub.wired], [[], []]);
  assert.match(sub.notes[0], /build\.gradle/);
  const str = planJavaWiring({ buildGradle: 'def s = "{"\ndependencies {\n}\n' });
  assert.deepEqual(str.wired, ['build.gradle']);
  assert.ok(str.edits[0].content.indexOf('// stackcrew:begin') > str.edits[0].content.indexOf('dependencies {'));
});

test('planJavaWiring: hand-declared archunit-junit5 is left alone and counts as wired', () => {
  const pom = POM.replace('</dependencies>\n  <build>', '<dependency><groupId>com.tngtech.archunit</groupId><artifactId>archunit-junit5</artifactId><scope>test</scope></dependency>\n  </dependencies>\n  <build>');
  const r = planJavaWiring({ pomXml: pom });
  assert.deepEqual([r.edits, r.wired], [[], ['pom.xml']]);
  assert.equal(r.notes[0], 'pom.xml already declares archunit-junit5; not adding it again');
  const g = planJavaWiring({ buildGradleKts: 'dependencies {\n  testImplementation("com.tngtech.archunit:archunit-junit5:1.0.0")\n}\n' });
  assert.deepEqual([g.edits, g.wired], [[], ['build.gradle.kts']]);
  const commented = planJavaWiring({ buildGradle: 'dependencies {\n  // testImplementation "com.tngtech.archunit:archunit-junit5:1"\n}\n' });
  assert.equal(commented.edits.length, 1);
});

async function assertNotWired(dir, r) {
  assert.equal(r.code, 1, r.err + r.out);
  assert.match(r.out, /wire: no build file could be wired; add this test dependency and re-run `stackcrew sync --wire`:/);
  assert.match(r.out, /archunit-junit5/);
  assert.ok(!existsSync(path.join(dir, TEST_FILE)));
  assert.equal(JSON.parse(await readFile(path.join(dir, 'stackcrew.json'), 'utf8')).java.wired, false);
}

test('sync --wire with no build file exits 1, no ArchUnit test, wired stays false', async () => {
  const dir = await javaProject(null);
  await assertNotWired(dir, await run(dir, 'sync', '--wire'));
});

test('sync --wire with a dependencyManagement-only pom: same, pom unchanged', async () => {
  const dir = await javaProject(DM_ONLY_POM);
  await assertNotWired(dir, await run(dir, 'sync', '--wire'));
  assert.equal(await readFile(path.join(dir, 'pom.xml'), 'utf8'), DM_ONLY_POM);
});

test('sync --wire with a hand-declared archunit pom: pom untouched, wired true, test emitted', async () => {
  const pom = '<project>\n  <dependencies>\n    <dependency><groupId>com.tngtech.archunit</groupId><artifactId>archunit-junit5</artifactId><version>1.0.0</version><scope>test</scope></dependency>\n  </dependencies>\n</project>\n';
  const dir = await javaProject(pom);
  const r = await run(dir, 'sync', '--wire');
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /note: pom\.xml already declares archunit-junit5; not adding it again/);
  assert.equal(await readFile(path.join(dir, 'pom.xml'), 'utf8'), pom);
  assert.ok(existsSync(path.join(dir, TEST_FILE)));
  assert.equal(JSON.parse(await readFile(path.join(dir, 'stackcrew.json'), 'utf8')).java.wired, true);
});

const AGGREGATOR_POM = '<project>\n  <packaging>pom</packaging>\n  <modules><module>app</module></modules>\n  <dependencies>\n  </dependencies>\n</project>\n';

test('planJavaWiring: aggregator pom (packaging pom / modules) gets no edit and does not count as wired', () => {
  for (const pom of [
    '<project>\n  <packaging>pom</packaging>\n  <dependencies>\n  </dependencies>\n</project>\n',
    '<project>\n  <modules>\n    <module>app</module>\n  </modules>\n  <dependencies>\n  </dependencies>\n</project>\n',
    AGGREGATOR_POM,
  ]) {
    const r = planJavaWiring({ pomXml: pom });
    assert.deepEqual([r.edits, r.wired], [[], []]);
    assert.match(r.notes[0], /^multi-module Maven: wire ArchUnit in the module that holds the application classes/);
  }
  const commented = planJavaWiring({ pomXml: '<project>\n  <!-- <packaging>pom</packaging> <modules/> -->\n  <dependencies>\n  </dependencies>\n</project>\n' });
  assert.deepEqual(commented.wired, ['pom.xml']);
});

test('sync --wire on a multi-module Maven root exits 1, pom unchanged, wired stays false', async () => {
  const dir = await javaProject(AGGREGATOR_POM);
  const r = await run(dir, 'sync', '--wire');
  assert.equal(r.code, 1, r.err + r.out);
  assert.match(r.out, /multi-module Maven/);
  assert.match(r.out, /archunit-junit5/);
  assert.equal(await readFile(path.join(dir, 'pom.xml'), 'utf8'), AGGREGATOR_POM);
  assert.ok(!existsSync(path.join(dir, TEST_FILE)));
  assert.equal(JSON.parse(await readFile(path.join(dir, 'stackcrew.json'), 'utf8')).java.wired, false);
});

test('sync --wire with a half-marker AGENTS.md aborts before ANY wiring write', async () => {
  const dir = await javaProject();
  const agents = 'intro\n<!-- stackcrew:begin -->\nhalf\n';
  await writeFile(path.join(dir, 'AGENTS.md'), agents);
  const before = await readFile(path.join(dir, 'stackcrew.json'), 'utf8');
  const r = await run(dir, 'sync', '--wire');
  assert.equal(r.code, 1, r.err + r.out);
  assert.equal(await readFile(path.join(dir, 'pom.xml'), 'utf8'), POM);
  assert.equal(await readFile(path.join(dir, 'stackcrew.json'), 'utf8'), before);
  assert.equal(JSON.parse(before).java.wired, false);
  assert.equal(await readFile(path.join(dir, 'AGENTS.md'), 'utf8'), agents);
  assert.ok(!existsSync(path.join(dir, TEST_FILE)));
});
