import { StackcrewError } from '../errors.js';
import { stringifyFrontmatter } from '../util/frontmatter.js';
import { withNotice } from './notice.js';

const RULES_DIR = '.agents/rules';
const AGENTS_DIR = '.agents/agents';
const MAX_BYTES = 24000;

/** @param {import('../types.js').RenderContext} ctx @returns {import('../types.js').FileOp[]} */
export function renderAntigravity(ctx) {
  if (!ctx.profile.tools.includes('antigravity')) return [];
  const ops = [];

  for (const rule of ctx.rules) {
    const fm = stringifyFrontmatter([
      ['trigger', 'glob'],
      ['globs', (rule.globs ?? ctx.stack.globs).join(',')],
    ]);
    const content = withNotice(fm, rule.body);
    const size = Buffer.byteLength(content, 'utf8');
    if (size > MAX_BYTES) {
      throw new StackcrewError('BUDGET', `Antigravity rule "${rule.id}" is ${size} bytes, over the ${MAX_BYTES}-byte budget`);
    }
    ops.push({ path: `${RULES_DIR}/stackcrew-${rule.id}.md`, kind: 'owned', content });
  }

  for (const role of ctx.roles) {
    const entries = [
      ['name', role.name],
      ['description', role.description],
      ['model', 'inherit'],
    ];
    // stringifyFrontmatter cannot express `[]`, so an empty list omits the key.
    if (role.skills.length > 0) entries.push(['skills', role.skills]);
    ops.push({ path: `${AGENTS_DIR}/${role.name}.md`, kind: 'owned', content: stringifyFrontmatter(entries) + role.body });
  }
  return ops;
}
