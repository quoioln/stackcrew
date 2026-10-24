import { stringifyFrontmatter } from '../util/frontmatter.js';
import { GENERATED_NOTICE, withNotice } from './notice.js';

const RULES_DIR = '.claude/rules/stackcrew';
const AGENTS_DIR = '.claude/agents';
const CLAUDE_MD_BLOCK =
  'stackcrew: coding rules for this repo are in .claude/rules/stackcrew/ (auto-loaded). Architecture decisions: docs/stackcrew/architecture-profile.md.';

/** @param {import('../types.js').RenderContext} ctx @returns {import('../types.js').FileOp[]} */
export function renderClaude(ctx) {
  if (!ctx.profile.tools.includes('claude')) return [];
  const ops = [{ path: `${RULES_DIR}/core.md`, kind: 'owned', content: GENERATED_NOTICE + '\n\n' + ctx.alwaysOn }];

  for (const rule of ctx.rules) {
    const fm = stringifyFrontmatter([['paths', rule.globs ?? ctx.stack.globs]]);
    ops.push({ path: `${RULES_DIR}/${rule.id}.md`, kind: 'owned', content: withNotice(fm, rule.body) });
  }

  for (const role of ctx.roles) {
    const entries = [
      ['name', role.name],
      ['description', role.description],
      ['model', role.model],
    ];
    // stringifyFrontmatter cannot express `[]`, so an empty list omits the key.
    if (role.skills.length > 0) entries.push(['skills', role.skills]);
    ops.push({ path: `${AGENTS_DIR}/${role.name}.md`, kind: 'owned', content: stringifyFrontmatter(entries) + role.body });
  }

  ops.push({ path: 'CLAUDE.md', kind: 'block', content: CLAUDE_MD_BLOCK });
  return ops;
}
