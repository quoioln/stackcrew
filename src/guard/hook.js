import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { toPosix } from '../util/glob.js';
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

/**
 * Lines introduced by a tool call (multiset diff).
 * @returns {{ line: number, text: string, approx?: boolean }[]}
 */
export function newLines(toolName, toolInput, currentFileText) {
  const t = toolInput ?? {};
  if (toolName === 'Write') return diffLines(currentFileText ?? null, t.content ?? '', false);
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

    const r = toPosix(root).replace(/\/+$/, '');
    const a = toPosix(filePath);
    if (!a.toLowerCase().startsWith(r.toLowerCase() + '/')) return OK;
    const relPath = a.slice(r.length + 1);

    const raw = readFile(`${r}/.stackcrew/guard.json`);
    if (raw === null || raw === undefined) return OK;
    const cfg = JSON.parse(raw);
    if (!cfg || cfg.enabled === false || !Array.isArray(cfg.rules)) return OK;

    const compiled = compileGuardRules(cfg.rules);
    const current = toolName === 'Write' ? readFile(filePath) : null;
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
    } catch {
      return null;
    }
  };
  const { exitCode, stderr } = runHook(input, { env: process.env, readFile });
  if (stderr) process.stderr.write(stderr);
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
