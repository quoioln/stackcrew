import { StackcrewError } from '../errors.js';
import { stringifyFrontmatter } from '../util/frontmatter.js';
import { withNotice } from './notice.js';

const RULES_DIR = '.cursor/rules/stackcrew';
const AGENTS_DIR = '.cursor/agents';
const MAX_LINES = 500;

/** @param {import('../types.js').RenderContext} ctx @returns {import('../types.js').FileOp[]} */
export function renderCursor(ctx) {
  const { tools } = ctx.profile;
  if (!tools.includes('cursor')) return [];
  const ops = [];

  for (const rule of ctx.rules) {
    const fm = stringifyFrontmatter([
      ['description', rule.title],
      ['globs', (rule.globs ?? ctx.stack.globs).join(',')],
      ['alwaysApply', false],
    ]);
    const content = withNotice(fm, rule.body);
    const lines = content.split('\n').length;
    if (lines > MAX_LINES) {
      throw new StackcrewError('BUDGET', `Cursor rule "${rule.id}" is ${lines} lines, over the ${MAX_LINES}-line budget`);
    }
    ops.push({ path: `${RULES_DIR}/${rule.id}.mdc`, kind: 'owned', content });
  }

  // Cursor reads .claude/agents, so own agent files are only needed without claude.
  if (!tools.includes('claude')) {
    for (const role of ctx.roles) {
      const fm = stringifyFrontmatter([
        ['name', role.name],
        ['description', role.description],
      ]);
      ops.push({ path: `${AGENTS_DIR}/${role.name}.md`, kind: 'owned', content: fm + role.body });
    }
  }
  return ops;
}
