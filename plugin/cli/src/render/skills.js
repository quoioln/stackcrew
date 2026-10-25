import { stringifyFrontmatter } from '../util/frontmatter.js';
import { withNotice } from './notice.js';

// Only name + description, for every tool. No `paths`: Claude Code hides a path-scoped skill until a
// matching file is touched, so it would have no slash command at session start and role agents
// could not preload it. One stack per repo plus stack-named descriptions keep skills from misfiring.
function skillMd(skill) {
  const entries = [
    ['name', skill.name],
    ['description', skill.description],
  ];
  return withNotice(stringifyFrontmatter(entries), skill.body);
}

function emit(dirs, skills) {
  const ops = [];
  for (const { dir } of dirs) {
    for (const skill of skills) {
      const base = `${dir}/${skill.name}`;
      ops.push({ path: `${base}/SKILL.md`, kind: 'owned', content: skillMd(skill) });
      for (const f of skill.files) ops.push({ path: `${base}/${f.relPath}`, kind: 'owned', content: f.content });
    }
  }
  return ops;
}

/** @param {import('../types.js').RenderContext} ctx @returns {import('../types.js').FileOp[]} */
export function renderSkills(ctx) {
  return [...emit(ctx.skillDirs.taskDirs, ctx.skills), ...emit(ctx.skillDirs.commandDirs, ctx.commandSkills)];
}
