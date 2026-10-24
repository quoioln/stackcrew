import { matchesAny } from '../util/glob.js';
import { StackcrewError } from '../errors.js';

/**
 * Compile guard rules. Stateful flags (g, y) are dropped so `re.test` is repeatable.
 * @param {import('../types.js').GuardRule[]} rules
 * @returns {{ rule: import('../types.js').GuardRule, re: RegExp }[]}
 */
export function compileGuardRules(rules) {
  return rules.map((rule) => {
    try {
      const flags = (rule.flags || '').replace(/[gy]/g, '');
      return { rule, re: new RegExp(rule.regex, flags) };
    } catch (e) {
      throw new StackcrewError('CATALOG', `Guard rule ${rule.id} has an invalid regex: ${e.message}`);
    }
  });
}

const ALLOW_RE = /stackcrew-allow:\s*(SC-[A-Z]+)\s+\S/g;

/** True when the line carries `stackcrew-allow: <ruleId> <reason>` (a reason is required). */
export function isAllowed(text, ruleId) {
  for (const m of text.matchAll(ALLOW_RE)) {
    if (m[1] === ruleId) return true;
  }
  return false;
}

/**
 * @param {string} relPath POSIX, project-relative
 * @param {{ line: number, text: string, approx?: boolean }[]} lines
 * @param {{ rule: import('../types.js').GuardRule, re: RegExp }[]} compiled
 * @returns {(import('../types.js').Violation & { approx?: boolean })[]}
 */
export function scanLines(relPath, lines, compiled) {
  const out = [];
  for (const { rule, re } of compiled) {
    if (!matchesAny(relPath, rule.globs || [])) continue;
    if (matchesAny(relPath, rule.excludeGlobs || [])) continue;
    for (const l of lines) {
      if (!re.test(l.text) || isAllowed(l.text, rule.id)) continue;
      const v = { file: relPath, line: l.line, ruleId: rule.id, message: rule.message, text: l.text };
      if (l.approx) v.approx = true;
      out.push(v);
    }
  }
  return out.sort((a, b) => a.line - b.line);
}
