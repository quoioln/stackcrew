import { StackcrewError } from '../errors.js';
import { GENERATED_NOTICE } from './notice.js';

export const AGENTS_BLOCK_BUDGET = 16000;
const TOOLS = ['cursor', 'codex', 'antigravity'];
const bytes = (s) => Buffer.byteLength(s, 'utf8');

const TOP_LEVEL_BULLET = /^[-*] /;

/**
 * First `n` top-level bullets (lines starting `- ` or `* ` at column 0) of an essentials
 * block, each with its continuation lines. Text before the first bullet is dropped; a blank
 * line followed by a non-indented non-bullet line ends the current bullet. Returns '' when
 * there are no bullets.
 */
export function topEssentials(essentials, n = 5) {
  const out = [];
  let count = 0;
  let inBullet = false;
  let pendingBlanks = [];
  for (const line of essentials.split('\n')) {
    if (TOP_LEVEL_BULLET.test(line)) {
      if (count === n) break;
      count += 1;
      inBullet = true;
      out.push(...pendingBlanks, line);
      pendingBlanks = [];
    } else if (line.trim() === '') {
      if (inBullet) pendingBlanks.push(line);
    } else if (inBullet) {
      if (pendingBlanks.length > 0 && !/^\s/.test(line)) {
        inBullet = false;
        pendingBlanks = [];
      } else {
        out.push(...pendingBlanks, line);
        pendingBlanks = [];
      }
    }
  }
  return out.join('\n').trim();
}

/** @param {import('../types.js').RenderContext} ctx @returns {import('../types.js').FileOp|null} */
export function renderAgentsMdBlock(ctx) {
  const { tools } = ctx.profile;
  if (!TOOLS.some((t) => tools.includes(t))) return null;

  let content = `## stackcrew rules\n\n${GENERATED_NOTICE}\n\n${ctx.alwaysOn.trim()}`;
  if (tools.includes('codex')) {
    for (const rule of ctx.rules) {
      if (rule.essentials.trim() === '') continue;
      const top = topEssentials(rule.essentials);
      if (top === '') continue;
      content += `\n\n### ${rule.title} — essentials\n\n${top}`;
    }
    content += `\n\nFull rules: use the skill \`stackcrew-${ctx.vars.stackId}-rules\`.`;
  }
  content += '\n';

  const total = bytes(content);
  if (total > AGENTS_BLOCK_BUDGET) {
    const largest = [...ctx.rules]
      .sort((a, b) => bytes(b.essentials) - bytes(a.essentials))
      .slice(0, 3)
      .map((r) => `${r.title} (${bytes(r.essentials)} bytes)`)
      .join(', ');
    throw new StackcrewError(
      'BUDGET',
      `AGENTS.md block is ${total} bytes, over the ${AGENTS_BLOCK_BUDGET}-byte budget. Largest rules by essentials: ${largest}`,
    );
  }
  return { path: 'AGENTS.md', kind: 'block', content };
}
