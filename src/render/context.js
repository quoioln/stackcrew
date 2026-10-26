import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { StackcrewError } from '../errors.js';
import { fillTemplate } from '../util/template.js';
import { parseFrontmatter } from '../util/frontmatter.js';
import { toLf } from '../util/hash.js';
import { extractEssentials } from '../catalog/load.js';
import { planSkillDirs } from './writeset.js';
import { resolveConventions, conventionVars } from '../conventions.js';

const CUSTOM_DIR = '.stackcrew/custom';

/** Read `.stackcrew/custom/*.md` as custom rules (sorted by file name). */
export async function loadCustomRules(projectDir) {
  let names;
  try {
    names = await readdir(path.join(projectDir, CUSTOM_DIR));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
    throw err;
  }
  const rules = [];
  for (const file of names.filter((n) => n.endsWith('.md')).sort()) {
    const rel = `${CUSTOM_DIR}/${file}`;
    const raw = await readFile(path.join(projectDir, CUSTOM_DIR, file), 'utf8');
    const { data, body } = parseFrontmatter(toLf(raw.replace(/^\uFEFF/, '')));
    if (typeof data.title !== 'string' || data.title.trim() === '') {
      throw new StackcrewError('PROFILE', `${rel}: title is required`);
    }
    const rule = {
      id: `custom-${file.slice(0, -3)}`,
      title: data.title,
      categories: [],
      languages: [],
      essentials: extractEssentials(body),
      body,
      source: rel,
      alwaysOn: data.alwaysOn === true,
    };
    if (Array.isArray(data.globs) && data.globs.length > 0) rule.globs = data.globs;
    rules.push(rule);
  }
  return rules;
}

/** Build the template-filled render context. Does not mutate the catalog. */
export function buildContext(catalog, profile, { customRules = [], cli, version } = {}) {
  const stack = catalog.stacks.get(profile.stack);
  if (!stack) throw new StackcrewError('RENDER', `Unknown stack "${profile.stack}"`);
  const language = catalog.languages.get(stack.language);
  if (!language) throw new StackcrewError('RENDER', `Unknown language "${stack.language}" for stack "${stack.id}"`);

  const conventions = resolveConventions(profile);
  const vars = {
    ...conventionVars(conventions),
    stackId: stack.id,
    stackName: stack.name,
    cli: cli ?? '',
    version: version ?? '',
    basePackage: profile.java?.basePackage ?? '',
  };
  const fill = (s) => fillTemplate(s, vars);
  const fillRule = (r) => ({ ...r, body: fill(r.body), essentials: fill(r.essentials) });
  const fillSkill = (s) => ({
    ...s,
    description: fill(s.description),
    body: fill(s.body),
    files: s.files.map((f) => ({ ...f, content: fill(f.content) })),
  });

  const addons = profile.addons.map((id) => catalog.addons.get(id)).filter(Boolean);
  const coreRules = catalog.coreRules.filter(
    (r) =>
      (r.categories.length === 0 || r.categories.includes(stack.category)) &&
      (r.languages.length === 0 || r.languages.includes(stack.language)),
  );
  const alwaysOnCustom = customRules.filter((r) => r.alwaysOn === true);
  const otherCustom = customRules.filter((r) => r.alwaysOn !== true);

  const rules = [
    ...coreRules,
    language.rule,
    stack.rules,
    stack.testing,
    ...addons.map((a) => a.rules),
    ...otherCustom,
  ].map(fillRule);

  const alwaysOn =
    fill(
      [catalog.alwaysOn, ...alwaysOnCustom.map((r) => r.body)]
        .map((s) => s.trimEnd())
        .filter(Boolean)
        .join('\n\n'),
    ) + '\n';

  const skills = [
    ...stack.skills.filter((s) => s.requiresAddons.every((a) => profile.addons.includes(a))),
    ...catalog.sharedSkills.filter((s) => s.kind === 'advisor'),
  ].map(fillSkill);
  const commandSkills = catalog.sharedSkills.filter((s) => s.kind === 'command').map(fillSkill);

  const roles = catalog.roles.map((role) => ({
    name: role.id === 'tech-lead' ? 'stackcrew-tech-lead' : `stackcrew-${stack.id}-${role.id}`,
    description: fill(role.description),
    model: role.model,
    body: fill(role.body),
    skills: skills.filter((s) => role.skillKinds.includes(s.kind)).map((s) => s.name),
  }));

  return {
    catalog,
    profile,
    stack,
    language,
    addons,
    rules,
    alwaysOn,
    skills,
    commandSkills,
    roles,
    skillDirs: planSkillDirs(profile.tools),
    conventions,
    vars,
  };
}
