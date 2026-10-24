import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { StackcrewError } from '../errors.js';
import { sha256, toLf } from '../util/hash.js';
import { upsertMarkedBlock } from './marked-block.js';

export const MANIFEST_PATH = '.stackcrew/manifest.json';

/** Returns an error reason for an unsafe op path, or null when it is fine. */
function pathProblem(p) {
  if (typeof p !== 'string' || p === '') return 'empty path';
  if (p.includes('\\')) return 'backslash in path';
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'absolute path';
  const segments = p.split('/');
  if (segments.includes('..')) return 'path contains ".."';
  if (segments.includes('')) return 'empty path segment';
  return null;
}

/** Read UTF-8 text; null when the file is absent, a directory marker when it is not a file. */
async function readText(abs) {
  try {
    return await readFile(abs, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    if (err.code === 'EISDIR') return { notAFile: true };
    throw err;
  }
}

/** Hash of on-disk content: null if absent, a value that never matches a real hash if not a regular file. */
function diskHash(text) {
  if (text === null) return null;
  if (typeof text === 'object') return '<not-a-file>';
  return sha256(text);
}

/** Read a block host as UTF-8 text (BOM kept). Null if absent. Throws MARKER if not UTF-8. */
async function readBlockHost(abs, rel) {
  let buf;
  try {
    buf = await readFile(abs);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    if (err.code === 'EISDIR') throw new StackcrewError('RENDER', `Cannot update a block in ${rel}: it is not a file`);
    throw err;
  }
  const utf16 = buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff));
  try {
    if (utf16) throw new Error('utf-16');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    throw new StackcrewError(
      'MARKER',
      `${rel}: not UTF-8 text; stackcrew will not edit it (convert it to UTF-8 first)`
    );
  }
}

async function readManifest(abs) {
  let raw;
  try {
    raw = await readFile(abs, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { status: 'missing', files: {} };
    throw err;
  }
  try {
    const m = JSON.parse(raw);
    const ok =
      m !== null &&
      typeof m === 'object' &&
      !Array.isArray(m) &&
      m.version === 1 &&
      m.files !== null &&
      typeof m.files === 'object' &&
      !Array.isArray(m.files) &&
      Object.values(m.files).every((v) => typeof v === 'string');
    return ok ? { status: 'ok', files: { ...m.files } } : { status: 'corrupt', files: {} };
  } catch {
    return { status: 'corrupt', files: {} };
  }
}

async function writeFileMkdir(abs, text) {
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, text, 'utf8');
}

/**
 * Apply file ops to a project. Everything is validated and decided in memory
 * first; the filesystem is touched only if nothing failed.
 * @param {string} projectDir
 * @param {import('../types.js').FileOp[]} ops
 * @param {{ force?: boolean, dryRun?: boolean }} [options]
 * @returns {Promise<import('../types.js').ApplyReport>}
 */
export async function applyOps(projectDir, ops, { force = false, dryRun = false } = {}) {
  const abs = (rel) => path.join(projectDir, ...rel.split('/'));

  // Phase 1: validate paths.
  const seen = new Set();
  for (const op of ops) {
    const problem = pathProblem(op.path);
    if (problem) throw new StackcrewError('RENDER', `Unsafe output path ${JSON.stringify(op.path)}: ${problem}`);
    const folded = op.path.toLowerCase();
    if (seen.has(folded)) throw new StackcrewError('RENDER', `Duplicate output path: ${op.path}`);
    seen.add(folded);
  }

  // Phase 2: compute block results (MARKER errors abort here, before any write).
  const blockWrites = [];
  const blocks = [];
  const blocksUnchanged = [];
  for (const op of ops.filter((o) => o.kind === 'block')) {
    const before = (await readBlockHost(abs(op.path), op.path)) ?? '';
    const after = upsertMarkedBlock(before, op.content);
    blocks.push(op.path);
    if (after !== before) blockWrites.push({ path: op.path, text: after });
    else blocksUnchanged.push(op.path);
  }

  // Phase 3: manifest.
  const manifest = await readManifest(abs(MANIFEST_PATH));
  const oldFiles = manifest.files;
  const newFiles = {};
  // Case-insensitive filesystems: A.md and a.md are the same file.
  const oldHashFor = (p) => {
    if (p in oldFiles) return oldFiles[p];
    const key = Object.keys(oldFiles).find((k) => k.toLowerCase() === p.toLowerCase());
    return key === undefined ? undefined : oldFiles[key];
  };

  // Phase 4: decide owned ops.
  const written = [];
  const unchanged = [];
  const skippedModified = [];
  const fileWrites = [];
  for (const op of ops.filter((o) => o.kind === 'owned')) {
    const text = toLf(op.content);
    const newHash = sha256(text);
    const onDisk = diskHash(await readText(abs(op.path)));
    if (onDisk === null) {
      written.push(op.path);
      fileWrites.push({ path: op.path, text });
      newFiles[op.path] = newHash;
    } else if (onDisk === newHash) {
      unchanged.push(op.path);
      newFiles[op.path] = newHash;
    } else if (onDisk === oldHashFor(op.path) || force) {
      written.push(op.path);
      fileWrites.push({ path: op.path, text });
      newFiles[op.path] = newHash;
    } else {
      skippedModified.push(op.path);
      const old = oldHashFor(op.path);
      if (old !== undefined) newFiles[op.path] = old;
    }
  }

  // Phase 5: stale deletions, only with a valid manifest.
  const deleted = [];
  const deletions = [];
  if (manifest.status === 'ok') {
    for (const [p, oldHash] of Object.entries(oldFiles)) {
      if (seen.has(p.toLowerCase()) || pathProblem(p)) continue;
      const onDisk = diskHash(await readText(abs(p)));
      if (onDisk === null) continue;
      if (onDisk === oldHash || force) {
        deleted.push(p);
        deletions.push(p);
      } else {
        skippedModified.push(p);
        newFiles[p] = oldHash;
      }
    }
  }

  const report = { written, unchanged, deleted, skippedModified, blocks, blocksUnchanged, manifestStatus: manifest.status };
  if (dryRun) return report;

  // Phase 6/7: perform writes, then deletions, then the manifest.
  for (const w of fileWrites) await writeFileMkdir(abs(w.path), w.text);
  for (const w of blockWrites) await writeFileMkdir(abs(w.path), w.text);
  for (const p of deletions) await unlink(abs(p));
  const sorted = Object.fromEntries(Object.keys(newFiles).sort().map((k) => [k, newFiles[k]]));
  await writeFileMkdir(abs(MANIFEST_PATH), JSON.stringify({ version: 1, files: sorted }, null, 2) + '\n');

  return report;
}
