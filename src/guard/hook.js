import { readFileSync, realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { toPosix } from '../util/glob.js';
import { toLf } from '../util/hash.js';
import { compileGuardRules, scanLines } from './scan.js';

const TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

const splitLines = (s) => String(s ?? '').split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

/** Lines of `content` whose running occurrence count exceeds their count in `baseline`. */
function diffLines(baseline, content, approx) {
  const counts = new Map();
  if (baseline !== null) {
    for (const t of splitLines(baseline)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const seen = new Map();
  const out = [];
  splitLines(content).forEach((text, i) => {
    const n = (seen.get(text) ?? 0) + 1;
    seen.set(text, n);
    if (n > (counts.get(text) ?? 0)) {
      const l = { line: i + 1, text };
      if (approx) l.approx = true;
      out.push(l);
    }
  });
  return out;
}

const lf = (v) => (typeof v === 'string' ? toLf(v) : v);

/** LF-normalized copy of a tool input: the file text is LF-normalized too, so CRLF files match. */
function normalizeInput(t) {
  const out = { ...t, old_string: lf(t.old_string), new_string: lf(t.new_string), content: lf(t.content) };
  if (Array.isArray(t.edits)) out.edits = t.edits.map((e) => ({ ...e, old_string: lf(e?.old_string), new_string: lf(e?.new_string) }));
  return out;
}

/** Apply one Edit to text; null when old_string is empty or not found. */
function applyEdit(text, e) {
  const old = e?.old_string;
  if (typeof old !== 'string' || old === '' || !text.includes(old)) return null;
  const nu = String(e.new_string ?? '');
  return e.replace_all === true ? text.split(old).join(nu) : text.replace(old, () => nu);
}

/** Full-file after-text for Edit/MultiEdit, or null when it cannot be computed exactly. */
function applyEdits(toolName, t, text) {
  const edits = toolName === 'Edit' ? [t] : Array.isArray(t.edits) ? t.edits : [];
  if (edits.length === 0) return null;
  let cur = text;
  for (const e of edits) {
    cur = applyEdit(cur, e);
    if (cur === null) return null;
  }
  return cur;
}

/**
 * Lines introduced by a tool call (multiset diff). For Edit/MultiEdit with a readable file the
 * full before/after text is diffed (exact line numbers); otherwise the old_string/new_string
 * fragments are diffed (approximate line numbers).
 * @returns {{ line: number, text: string, approx?: boolean }[]}
 */
export function newLines(toolName, toolInput, currentFileText) {
  const t = normalizeInput(toolInput ?? {});
  const current = typeof currentFileText === 'string' ? toLf(currentFileText) : currentFileText;
  if (toolName === 'Write') return diffLines(current ?? null, t.content ?? '', false);
  if ((toolName === 'Edit' || toolName === 'MultiEdit') && typeof current === 'string') {
    const after = applyEdits(toolName, t, current);
    if (after !== null) return diffLines(current, after, false);
  }
  if (toolName === 'Edit') return diffLines(t.old_string ?? '', t.new_string ?? '', true);
  if (toolName === 'MultiEdit') {
    return (Array.isArray(t.edits) ? t.edits : []).flatMap((e) => diffLines(e?.old_string ?? '', e?.new_string ?? '', true));
  }
  return [];
}

function format(violations) {
  const body = violations
    .map((v) => `- [${v.ruleId}] ${v.file}:${v.approx ? '~' : ''}${v.line}: ${v.message}\n    > ${v.text}`)
    .join('\n');
  return (
    `stackcrew guard blocked this edit:\n${body}\n` +
    'Fix the code to follow the rule. For a justified exception add `stackcrew-allow: <ruleId> <reason>` in a comment on that line.\n'
  );
}

const OK = { exitCode: 0, stderr: '' };

/**
 * @param {unknown} input parsed hook payload
 * @param {{ env: Record<string,string|undefined>, readFile: (absPath: string) => string | null }} deps
 * @returns {{ exitCode: 0|2, stderr: string }}
 */
export function runHook(input, { env, readFile }) {
  try {
    if (!input || typeof input !== 'object') return OK;
    const toolName = input.tool_name;
    if (!TOOLS.has(toolName)) return OK;
    const root = env.CLAUDE_PROJECT_DIR || input.cwd;
    const filePath = input.tool_input?.file_path;
    if (!root || typeof root !== 'string' || typeof filePath !== 'string') return OK;

    const r = posix.normalize(toPosix(root)).replace(/\/+$/, '');
    const a = posix.normalize(toPosix(filePath));
    if (!a.toLowerCase().startsWith(r.toLowerCase() + '/')) return OK;
    const relPath = a.slice(r.length + 1);

    const raw = readFile(`${r}/.stackcrew/guard.json`);
    if (raw === null || raw === undefined) return OK;
    const cfg = JSON.parse(raw);
    if (!cfg || cfg.enabled === false || !Array.isArray(cfg.rules)) return OK;

    const compiled = compileGuardRules(cfg.rules);
    const current = readFile(filePath);
    const violations = scanLines(relPath, newLines(toolName, input.tool_input, current), compiled);
    if (violations.length === 0) return OK;
    return { exitCode: 2, stderr: format(violations) };
  } catch {
    return OK;
  }
}

function main() {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return;
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }
  const readFile = (p) => {
    try {
      return readFileSync(p, 'utf8');
    } catch (e) {
      if (e?.code === 'ENOENT') return null;
      throw e;
    }
  };
  const { exitCode, stderr } = runHook(input, { env: process.env, readFile });
  if (stderr) process.stderr.write(stderr);
  process.exitCode = exitCode;
}

function isEntry() {
  const arg = process.argv[1];
  if (!arg) return false;
  if (import.meta.url === pathToFileURL(arg).href) return true;
  try {
    const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
    return norm(fileURLToPath(import.meta.url)) === norm(realpathSync(arg));
  } catch {
    return false;
  }
}

if (isEntry()) main();
