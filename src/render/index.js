import { StackcrewError } from '../errors.js';
import { renderSkills } from './skills.js';
import { renderClaude } from './claude.js';
import { renderCursor } from './cursor.js';
import { renderCodex } from './codex.js';
import { renderAntigravity } from './antigravity.js';
import { renderAgentsMdBlock } from './agents-md.js';
import { renderShared } from './shared.js';

/** Reject duplicate output paths and anything under docs/sdlc/ (case-folded, like the apply phase). */
export function assertUniquePaths(ops) {
  const seen = new Set();
  for (const op of ops) {
    const key = op.path.toLowerCase();
    if (key.startsWith('docs/sdlc/')) {
      throw new StackcrewError('RENDER', `refusing to write under docs/sdlc/: ${op.path}`);
    }
    if (seen.has(key)) throw new StackcrewError('RENDER', `duplicate output path: ${op.path}`);
    seen.add(key);
  }
}

/** @param {import('../types.js').RenderContext} ctx @returns {import('../types.js').RenderResult} */
export function renderProject(ctx) {
  const ops = [
    ...renderSkills(ctx),
    ...renderClaude(ctx),
    ...renderCursor(ctx),
    ...renderCodex(ctx),
    ...renderAntigravity(ctx),
  ];
  const agentsBlock = renderAgentsMdBlock(ctx);
  if (agentsBlock) ops.push(agentsBlock);
  ops.push(...renderShared(ctx));
  assertUniquePaths(ops);
  return { ops, warnings: [...ctx.skillDirs.warnings] };
}
