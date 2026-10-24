import { stringifyFrontmatter } from '../util/frontmatter.js';
import { withNotice } from './notice.js';

function skillMd(skill, format) {
  const entries = [
    ['name', skill.name],
    ['description', skill.description],
  ];
  if (format === 'claude' && skill.paths.length > 0) entries.push(['paths', skill.paths]);
  return withNotice(stringifyFrontmatter(entries), skill.body);
}

function emit(dirs, skills) {
  const ops = [];
  for (const { dir, format } of dirs) {
    for (const skill of skills) {
      const base = `${dir}/${skill.name}`;
      ops.push({ path: `${base}/SKILL.md`, kind: 'owned', content: skillMd(skill, format) });
      for (const f of skill.files) ops.push({ path: `${base}/${f.relPath}`, kind: 'owned', content: f.content });
    }
  }
  return ops;
}

/** @param {import('../types.js').RenderContext} ctx @returns {import('../types.js').FileOp[]} */
export function renderSkills(ctx) {
  return [...emit(ctx.skillDirs.taskDirs, ctx.skills), ...emit(ctx.skillDirs.commandDirs, ctx.commandSkills)];
}
