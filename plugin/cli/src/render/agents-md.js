import { StackcrewError } from '../errors.js';
import { GENERATED_NOTICE } from './notice.js';

export const AGENTS_BLOCK_BUDGET = 12000;
const TOOLS = ['cursor', 'codex', 'antigravity'];
const bytes = (s) => Buffer.byteLength(s, 'utf8');

/** @param {import('../types.js').RenderContext} ctx @returns {import('../types.js').FileOp|null} */
export function renderAgentsMdBlock(ctx) {
  const { tools } = ctx.profile;
  if (!TOOLS.some((t) => tools.includes(t))) return null;

  let content = `## stackcrew rules\n\n${GENERATED_NOTICE}\n\n${ctx.alwaysOn.trim()}`;
  if (tools.includes('codex')) {
    for (const rule of ctx.rules) {
      if (rule.essentials.trim() === '') continue;
      content += `\n\n### ${rule.title} — essentials\n\n${rule.essentials.trim()}`;
    }
    content += `\n\nFull rules: use the skill \`stackcrew-${ctx.vars.stackId}-rules\`.`;
  }
  content += '\n';

  const total = bytes(content);
  if (total > AGENTS_BLOCK_BUDGET) {
    const top = [...ctx.rules]
      .sort((a, b) => bytes(b.essentials) - bytes(a.essentials))
      .slice(0, 3)
      .map((r) => `${r.title} (${bytes(r.essentials)} bytes)`)
      .join(', ');
    throw new StackcrewError(
      'BUDGET',
      `AGENTS.md block is ${total} bytes, over the ${AGENTS_BLOCK_BUDGET}-byte budget. Largest rules by essentials: ${top}`,
    );
  }
  return { path: 'AGENTS.md', kind: 'block', content };
}
