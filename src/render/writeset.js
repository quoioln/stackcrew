const CLAUDE_DIR = '.claude/skills';
const AGENTS_DIR = '.agents/skills';
const AGENT_DIR = '.agent/skills';
const CURSOR_DIR = '.cursor/skills';

export const CURSOR_DUPLICATE_WARNING =
  'cursor-duplicate-skills: Cursor reads both .claude/skills and .agents/skills, so stackcrew skills may appear twice in Cursor.';

/**
 * Decide which skill directories receive stackcrew skills for the chosen tools.
 * @param {string[]} tools
 * @returns {import('../types.js').SkillDirPlan}
 */
export function planSkillDirs(tools) {
  const has = (t) => tools.includes(t);
  const claude = has('claude');
  const cursor = has('cursor');
  const codex = has('codex');
  const antigravity = has('antigravity');

  const generic = [];
  const addGeneric = (dir) => {
    if (!generic.includes(dir)) generic.push(dir);
  };
  if (codex) addGeneric(AGENTS_DIR);
  if (antigravity && !codex) addGeneric(claude && cursor ? AGENT_DIR : AGENTS_DIR);
  if (cursor && !claude && !generic.includes(AGENTS_DIR)) addGeneric(AGENTS_DIR);

  const taskDirs = [];
  if (claude) taskDirs.push({ dir: CLAUDE_DIR, format: 'claude' });
  for (const dir of generic) taskDirs.push({ dir, format: 'generic' });

  const commandDirs = generic.map((dir) => ({ dir, format: 'generic' }));
  if (cursor && claude && !generic.includes(AGENTS_DIR)) commandDirs.push({ dir: CURSOR_DIR, format: 'generic' });

  const warnings = cursor && claude && codex ? [CURSOR_DUPLICATE_WARNING] : [];
  return { taskDirs, commandDirs, warnings };
}
