import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { upsertMarkedBlock, MD_MARKERS, GRADLE_MARKERS } from '../src/fs/marked-block.js';
import { applyOps, MANIFEST_PATH } from '../src/fs/apply.js';
import { sha256 } from '../src/util/hash.js';

const B = MD_MARKERS.begin;
const E = MD_MARKERS.end;

async function tmp() {
  return mkdtemp(path.join(tmpdir(), 'sc-apply-'));
}
const exists = (p) => access(p).then(() => true, () => false);
const owned = (p, content) => ({ path: p, kind: 'owned', content });
const block = (p, content) => ({ path: p, kind: 'block', content });

test('appends block to file without markers, keeps other bytes', () => {
  const r = upsertMarkedBlock('# Title\n', 'B');
  assert.equal(r, `# Title\n\n${B}\nB\n${E}\n`);
  assert.equal(upsertMarkedBlock('', 'B'), `${B}\nB\n${E}\n`);
  assert.equal(upsertMarkedBlock('x', 'B'), `x\n\n${B}\nB\n${E}\n`);
});

test('preserves SDLC section bytes', () => {
  const existing = '## SDLC Workflow\nX\n';
  assert.ok(upsertMarkedBlock(existing, 'B').startsWith(existing));
});

test('keeps CRLF', () => {
  assert.equal(
    upsertMarkedBlock('a\r\n', 'B'),
    `a\r\n\r\n${B}\r\nB\r\n${E}\r\n`
  );
  const again = upsertMarkedBlock(upsertMarkedBlock('a\r\n', 'B'), 'one\ntwo');
  assert.equal(again, `a\r\n\r\n${B}\r\none\r\ntwo\r\n${E}\r\n`);
});

test('replaces only between markers', () => {
  const existing = `top\n${B}\nold\n${E}\nbottom\n`;
  assert.equal(upsertMarkedBlock(existing, 'new'), `top\n${B}\nnew\n${E}\nbottom\n`);
});

test('supports gradle markers', () => {
  const r = upsertMarkedBlock('x\n', 'c', GRADLE_MARKERS);
  assert.equal(r, `x\n\n${GRADLE_MARKERS.begin}\nc\n${GRADLE_MARKERS.end}\n`);
});

test('malformed markers throw MARKER', () => {
  for (const bad of [`${B}\nx\n`, `${E}\n`, `${E}\n${B}\n`, `${B}\n${E}\n${B}\n${E}\n`]) {
    assert.throws(() => upsertMarkedBlock(bad, 'c'), { code: 'MARKER' });
  }
});

test('half marker aborts all writes', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'AGENTS.md'), `intro\n${B}\nhalf\n`);
  await assert.rejects(
    applyOps(dir, [owned('.claude/rules/stackcrew/a.md', 'A'), block('AGENTS.md', 'X')]),
    { code: 'MARKER' }
  );
  assert.equal(await exists(path.join(dir, '.claude/rules/stackcrew/a.md')), false);
  assert.equal(await exists(path.join(dir, MANIFEST_PATH)), false);
  assert.equal(await readFile(path.join(dir, 'AGENTS.md'), 'utf8'), `intro\n${B}\nhalf\n`);
});

test('writes owned files and manifest', async () => {
  const dir = await tmp();
  const r = await applyOps(dir, [owned('docs/stackcrew/a.md', 'A\r\nB\r\n'), block('CLAUDE.md', 'blk')]);
  assert.deepEqual(r.written, ['docs/stackcrew/a.md']);
  assert.deepEqual(r.blocks, ['CLAUDE.md']);
  assert.equal(r.manifestStatus, 'missing');
  assert.equal(await readFile(path.join(dir, 'docs/stackcrew/a.md'), 'utf8'), 'A\nB\n');
  const m = JSON.parse(await readFile(path.join(dir, MANIFEST_PATH), 'utf8'));
  assert.deepEqual(m, { version: 1, files: { 'docs/stackcrew/a.md': sha256('A\nB\n') } });
  const r2 = await applyOps(dir, [owned('docs/stackcrew/a.md', 'A\nB\n'), block('CLAUDE.md', 'blk')]);
  assert.deepEqual(r2.unchanged, ['docs/stackcrew/a.md']);
  assert.deepEqual(r2.written, []);
  assert.deepEqual(r2.blocks, ['CLAUDE.md']);
  assert.equal(r2.manifestStatus, 'ok');
});

test('CRLF checkout of an owned file is not a hand edit', async () => {
  const dir = await tmp();
  await applyOps(dir, [owned('docs/stackcrew/a.md', 'A\nB\n')]);
  await writeFile(path.join(dir, 'docs/stackcrew/a.md'), 'A\r\nB\r\n');
  const r = await applyOps(dir, [owned('docs/stackcrew/a.md', 'A2\n')]);
  assert.deepEqual(r.written, ['docs/stackcrew/a.md']);
  assert.deepEqual(r.skippedModified, []);
});

test('refuses to overwrite hand-edited owned file', async () => {
  const dir = await tmp();
  const p = 'docs/stackcrew/a.md';
  await applyOps(dir, [owned(p, 'A\n')]);
  await writeFile(path.join(dir, p), 'edited\n');
  const r = await applyOps(dir, [owned(p, 'NEW\n')]);
  assert.deepEqual(r.skippedModified, [p]);
  assert.equal(await readFile(path.join(dir, p), 'utf8'), 'edited\n');
  const m = JSON.parse(await readFile(path.join(dir, MANIFEST_PATH), 'utf8'));
  assert.equal(m.files[p], sha256('A\n'));
  const f = await applyOps(dir, [owned(p, 'NEW\n')], { force: true });
  assert.deepEqual(f.written, [p]);
  assert.equal(await readFile(path.join(dir, p), 'utf8'), 'NEW\n');
});

test('existing untracked file differing from new content is skipped', async () => {
  const dir = await tmp();
  await mkdir(path.join(dir, 'docs/stackcrew'), { recursive: true });
  await writeFile(path.join(dir, 'docs/stackcrew/a.md'), 'mine\n');
  const r = await applyOps(dir, [owned('docs/stackcrew/a.md', 'NEW\n')]);
  assert.deepEqual(r.skippedModified, ['docs/stackcrew/a.md']);
  assert.equal(await readFile(path.join(dir, 'docs/stackcrew/a.md'), 'utf8'), 'mine\n');
});

test('deletes stale owned file listed in manifest', async () => {
  const dir = await tmp();
  await applyOps(dir, [owned('docs/stackcrew/a.md', 'A\n'), owned('docs/stackcrew/b.md', 'B\n')]);
  const r = await applyOps(dir, [owned('docs/stackcrew/a.md', 'A\n')]);
  assert.deepEqual(r.deleted, ['docs/stackcrew/b.md']);
  assert.equal(await exists(path.join(dir, 'docs/stackcrew/b.md')), false);
  const m = JSON.parse(await readFile(path.join(dir, MANIFEST_PATH), 'utf8'));
  assert.deepEqual(Object.keys(m.files), ['docs/stackcrew/a.md']);
});

test('modified stale file is skipped, force deletes it', async () => {
  const dir = await tmp();
  await applyOps(dir, [owned('docs/stackcrew/b.md', 'B\n')]);
  await writeFile(path.join(dir, 'docs/stackcrew/b.md'), 'mine\n');
  const r = await applyOps(dir, []);
  assert.deepEqual(r.skippedModified, ['docs/stackcrew/b.md']);
  assert.deepEqual(r.deleted, []);
  assert.equal(await exists(path.join(dir, 'docs/stackcrew/b.md')), true);
  const m = JSON.parse(await readFile(path.join(dir, MANIFEST_PATH), 'utf8'));
  assert.equal(m.files['docs/stackcrew/b.md'], sha256('B\n'));
  const f = await applyOps(dir, [], { force: true });
  assert.deepEqual(f.deleted, ['docs/stackcrew/b.md']);
  assert.equal(await exists(path.join(dir, 'docs/stackcrew/b.md')), false);
});

test('stale file already absent is dropped from manifest', async () => {
  const dir = await tmp();
  await applyOps(dir, [owned('docs/stackcrew/b.md', 'B\n')]);
  await rm(path.join(dir, 'docs/stackcrew/b.md'));
  const r = await applyOps(dir, []);
  assert.deepEqual(r.deleted, []);
  const m = JSON.parse(await readFile(path.join(dir, MANIFEST_PATH), 'utf8'));
  assert.deepEqual(m.files, {});
});

test('missing manifest deletes nothing', async () => {
  const dir = await tmp();
  await mkdir(path.join(dir, 'docs/stackcrew'), { recursive: true });
  await writeFile(path.join(dir, 'docs/stackcrew/old.md'), 'old\n');
  const r = await applyOps(dir, [owned('docs/stackcrew/a.md', 'A\n')]);
  assert.equal(r.manifestStatus, 'missing');
  assert.deepEqual(r.deleted, []);
  assert.equal(await exists(path.join(dir, 'docs/stackcrew/old.md')), true);
});

test('corrupt manifest deletes nothing', async () => {
  const oldSha = sha256('old\n');
  const oldKey = 'docs/stackcrew/old.md';
  const cases = [
    '{',
    '[]',
    '{"version":2,"files":{}}',
    '{"version":1,"files":{"x":1}}',
    '{"version":1}',
    JSON.stringify({ version: 2, files: { [oldKey]: oldSha } }),
    `{"version":1,"files":{"${oldKey}":"${oldSha}","x":1}}`
  ];
  for (const bad of cases) {
    const dir = await tmp();
    await mkdir(path.join(dir, '.stackcrew'), { recursive: true });
    await mkdir(path.join(dir, 'docs/stackcrew'), { recursive: true });
    await writeFile(path.join(dir, MANIFEST_PATH), bad);
    await writeFile(path.join(dir, 'docs/stackcrew/old.md'), 'old\n');
    const r = await applyOps(dir, [owned('docs/stackcrew/a.md', 'A\n')]);
    assert.equal(r.manifestStatus, 'corrupt', bad);
    assert.deepEqual(r.deleted, []);
    assert.equal(await exists(path.join(dir, 'docs/stackcrew/old.md')), true);
  }
});

test('tampered manifest path outside project is never deleted', async () => {
  const dir = await tmp();
  const outside = path.join(dir, 'outside.txt');
  const proj = path.join(dir, 'proj');
  await mkdir(path.join(proj, '.stackcrew'), { recursive: true });
  await writeFile(outside, 'keep\n');
  await writeFile(
    path.join(proj, MANIFEST_PATH),
    JSON.stringify({ version: 1, files: { '../outside.txt': sha256('keep\n') } })
  );
  const r = await applyOps(proj, []);
  assert.deepEqual(r.deleted, []);
  assert.equal(await exists(outside), true);
});

test('dryRun writes nothing', async () => {
  const dir = await tmp();
  const r = await applyOps(dir, [owned('docs/stackcrew/a.md', 'A\n'), block('AGENTS.md', 'x')], { dryRun: true });
  assert.deepEqual(r.written, ['docs/stackcrew/a.md']);
  assert.deepEqual(r.blocks, ['AGENTS.md']);
  assert.equal(await exists(path.join(dir, 'docs')), false);
  assert.equal(await exists(path.join(dir, 'AGENTS.md')), false);
  assert.equal(await exists(path.join(dir, '.stackcrew')), false);
});

test('block ops are never in the manifest and keep host EOL', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'AGENTS.md'), '## SDLC Workflow\r\nX\r\n');
  await applyOps(dir, [block('AGENTS.md', 'B')]);
  assert.equal(
    await readFile(path.join(dir, 'AGENTS.md'), 'utf8'),
    `## SDLC Workflow\r\nX\r\n\r\n${B}\r\nB\r\n${E}\r\n`
  );
  const m = JSON.parse(await readFile(path.join(dir, MANIFEST_PATH), 'utf8'));
  assert.deepEqual(m.files, {});
});

test('rejects bad paths with RENDER and writes nothing', async () => {
  const bad = ['../x', 'a/../x', '/abs', 'C:/x', 'c:x', 'a\\b', '', 'a//..'];
  for (const p of bad) {
    const dir = await tmp();
    await assert.rejects(
      applyOps(dir, [owned('docs/stackcrew/ok.md', 'A'), owned(p, 'x')]),
      { code: 'RENDER' },
      JSON.stringify(p)
    );
    assert.equal(await exists(path.join(dir, 'docs')), false);
    assert.equal(await exists(path.join(dir, MANIFEST_PATH)), false);
  }
});

test('non-UTF-8 block hosts are refused and left byte-identical', async () => {
  const hosts = {
    'utf16le.md': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi\n', 'utf16le')]),
    'utf16be.md': Buffer.from([0xfe, 0xff, 0x00, 0x68]),
    'latin1.md': Buffer.from([0x63, 0x61, 0x66, 0xe9])
  };
  for (const [name, bytes] of Object.entries(hosts)) {
    const dir = await tmp();
    await writeFile(path.join(dir, name), bytes);
    await assert.rejects(
      applyOps(dir, [owned('docs/stackcrew/a.md', 'A'), block(name, 'B')]),
      (err) => err.code === 'MARKER' && err.message.includes('not UTF-8 text'),
      name
    );
    assert.deepEqual(await readFile(path.join(dir, name)), bytes);
    assert.equal(await exists(path.join(dir, 'docs')), false);
    assert.equal(await exists(path.join(dir, MANIFEST_PATH)), false);
  }
});

test('UTF-8 BOM host keeps its bytes before the block', async () => {
  const dir = await tmp();
  const head = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('café\n', 'utf8')]);
  await writeFile(path.join(dir, 'AGENTS.md'), head);
  await applyOps(dir, [block('AGENTS.md', 'B')]);
  const out = await readFile(path.join(dir, 'AGENTS.md'));
  assert.deepEqual(out.subarray(0, head.length), head);
  assert.equal(out.subarray(head.length).toString('utf8'), `\n${B}\nB\n${E}\n`);
});

test('case-only path change does not delete the kept file', async () => {
  const dir = await tmp();
  await applyOps(dir, [owned('docs/stackcrew/A.md', 'X\n')]);
  const r = await applyOps(dir, [owned('docs/stackcrew/a.md', 'X\n')]);
  assert.deepEqual(r.deleted, []);
  assert.equal(await exists(path.join(dir, 'docs/stackcrew/a.md')), true);
  const m = JSON.parse(await readFile(path.join(dir, MANIFEST_PATH), 'utf8'));
  assert.deepEqual(Object.keys(m.files), ['docs/stackcrew/a.md']);
});

test('rejects case-only duplicate paths', async () => {
  const dir = await tmp();
  await assert.rejects(
    applyOps(dir, [owned('docs/stackcrew/A.md', '1'), owned('docs/stackcrew/a.md', '2')]),
    { code: 'RENDER' }
  );
});

test('markers mentioned inline in prose are not markers', () => {
  const both = `Use \`${B}\` and \`${E}\` to mark.\n`;
  assert.equal(upsertMarkedBlock(both, 'X'), `${both}\n${B}\nX\n${E}\n`);
  const one = `Mention ${B} only.\n`;
  assert.equal(upsertMarkedBlock(one, 'X'), `${one}\n${B}\nX\n${E}\n`);
  const withBlock = `see ${B} here\n${B}\nold\n${E}\nend\n`;
  assert.equal(upsertMarkedBlock(withBlock, 'N'), `see ${B} here\n${B}\nN\n${E}\nend\n`);
});

test('rejects path traversal', async () => {
  const dir = await tmp();
  await assert.rejects(applyOps(dir, [owned('../x', 'x')]), { code: 'RENDER' });
});

test('rejects duplicate paths', async () => {
  const dir = await tmp();
  await assert.rejects(
    applyOps(dir, [owned('docs/stackcrew/a.md', '1'), block('docs/stackcrew/a.md', '2')]),
    { code: 'RENDER' }
  );
});
