import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseCommandArgs } from './args.js';
import { parseUnifiedDiff } from '../guard/diff.js';
import { compileGuardRules, scanLines } from '../guard/scan.js';
import { StackcrewError } from '../errors.js';

const USAGE = 'stackcrew check [--base <ref>] [--staged]';
const DIFF_BASE = ['-c', 'core.quotepath=false', 'diff', '--unified=0', '--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/'];

/** Raised internally for "cannot run" conditions; reported on stderr with exit code 2. */
class CannotRun extends Error {}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function gitOrFail(args, cwd) {
  const r = git(args, cwd);
  if (r.error || r.status !== 0) {
    const detail = r.error ? r.error.message : (r.stderr || '').split('\n')[0].trim();
    throw new CannotRun(`git ${args.join(' ')} failed: ${detail}`);
  }
  return r.stdout;
}

function untrackedFiles(top) {
  const out = gitOrFail(['-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard', '-z'], top);
  const result = [];
  for (const rel of out.split('\0').filter(Boolean)) {
    const abs = path.join(top, rel);
    let buf;
    try {
      if (!statSync(abs).isFile()) continue;
      buf = readFileSync(abs);
    } catch (e) {
      throw new CannotRun(`cannot read untracked file ${rel}: ${e.message}`);
    }
    if (buf.subarray(0, 8192).includes(0)) continue;
    const lines = buf
      .toString('utf8')
      .split('\n')
      .map((t, i) => ({ line: i + 1, text: t.endsWith('\r') ? t.slice(0, -1) : t }));
    if (lines.length && lines[lines.length - 1].text === '') lines.pop();
    if (lines.length) result.push({ file: rel, lines });
  }
  return result;
}

function loadRules(top) {
  let raw;
  try {
    raw = readFileSync(path.join(top, '.stackcrew', 'guard.json'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new CannotRun('not initialized (.stackcrew/guard.json missing); run `stackcrew sync`');
    }
    throw new CannotRun(`cannot read .stackcrew/guard.json: ${e.message}`);
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    throw new CannotRun(`invalid .stackcrew/guard.json: ${e.message}`);
  }
  if (!cfg || !Array.isArray(cfg.rules)) throw new CannotRun('invalid .stackcrew/guard.json: "rules" must be an array');
  try {
    return compileGuardRules(cfg.rules);
  } catch (e) {
    if (e instanceof StackcrewError) throw new CannotRun(e.message);
    throw e;
  }
}

function clip(text) {
  const t = text.trim();
  return t.length > 200 ? t.slice(0, 200) : t;
}

/** @returns {Promise<number>} 0 clean, 1 violations, 2 cannot run */
export async function checkCommand(args, io) {
  try {
    const { values } = parseCommandArgs(args, {
      base: { type: 'string' },
      staged: { type: 'boolean' },
    }, USAGE);
    return run(values, io);
  } catch (e) {
    if (e instanceof StackcrewError && e.code === 'CLI') {
      io.stderr.write(`stackcrew check: ${e.message}\n`);
      return 2;
    }
    if (!(e instanceof CannotRun)) throw e;
    io.stderr.write(`stackcrew check: ${e.message}\n`);
    return 2;
  }
}

function run(values, io) {
  const probe = git(['rev-parse', '--show-toplevel'], io.cwd);
  if (probe.error) throw new CannotRun(`git rev-parse --show-toplevel failed: ${probe.error.message}`);
  if (probe.status !== 0) throw new CannotRun('not a git repository');
  const top = probe.stdout.trim();

  const base = values.base;
  if (base !== undefined) {
    const found = !base.startsWith('-') && git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], top).status === 0;
    if (!found) throw new CannotRun(`base ref not found: ${base} (fetch it first, e.g. \`git fetch origin <branch>\`)`);
  }

  const compiled = loadRules(top);

  let files;
  if (base !== undefined) {
    files = parseUnifiedDiff(gitOrFail([...DIFF_BASE, `${base}...HEAD`, '--'], top));
  } else if (values.staged) {
    files = parseUnifiedDiff(gitOrFail([...DIFF_BASE, '--cached', '--'], top));
  } else {
    files = parseUnifiedDiff(gitOrFail([...DIFF_BASE, 'HEAD', '--'], top)).concat(untrackedFiles(top));
  }

  const violations = [];
  let lineCount = 0;
  for (const f of files) {
    lineCount += f.lines.length;
    violations.push(...scanLines(f.file, f.lines, compiled));
  }

  if (violations.length === 0) {
    io.stdout.write(`stackcrew check: 0 violations in ${lineCount} added line(s) across ${files.length} file(s)\n`);
    return 0;
  }
  for (const v of violations) {
    io.stdout.write(`${v.file}:${v.line} [${v.ruleId}] ${v.message}\n    > ${clip(v.text)}\n`);
  }
  io.stdout.write(`stackcrew check: ${violations.length} violation(s)\n`);
  return 1;
}
