/** Banned in any catalog markdown (case-insensitive): the catalog must not orchestrate workflows. */
export const BANNED_ORCHESTRATION = [
  'auto-advance',
  'next phase',
  'when the user sends an idea',
  'run the pipeline',
  'proceed to the next phase',
  'invoke the next skill',
];

/** Banned in skill descriptions (case-insensitive): they make skills trigger too broadly. */
export const BANNED_DESCRIPTION_WORDS = ['always', 'any code', 'all code', 'every task', 'whenever the user', 'proactively'];

const DESCRIPTION_MAX = 500;
const ESSENTIALS_MAX_BULLETS = 15;
const CATEGORIES = ['backend', 'frontend', 'fullstack'];
const ROLE_IDS = ['tech-lead', 'developer', 'tester'];
const MODELS = ['opus', 'sonnet', 'haiku'];
const ROLE_SKILL_KINDS = ['task', 'testing', 'advisor'];
const STACK_SKILL_KINDS = ['task', 'testing'];
const SHARED_SKILL_KINDS = ['advisor', 'command'];
// The plugin build has no stack context, so command content may only use these.
const COMMAND_PLACEHOLDERS = ['cli', 'version'];

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isStrArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const skillFolder = (source) => source.split('/').slice(-2)[0];

/**
 * Lint one skill description. Errors are prefixed with the skill's source path.
 * @param {import('../types.js').SkillDoc} skill
 * @param {string} [stackName] required in task/testing descriptions when given
 * @returns {string[]}
 */
export function lintSkillDescription(skill, stackName) {
  const errs = [];
  const err = (m) => errs.push(`${skill.source}: ${m}`);
  const d = skill.description ?? '';
  if (d.trim() === '') {
    err('description is empty');
    return errs;
  }
  if (d.length > DESCRIPTION_MAX) err(`description is ${d.length} chars (max ${DESCRIPTION_MAX})`);
  if (skill.kind === 'command') {
    if (!d.startsWith('Use only when')) err('command skill description must start with "Use only when"');
  } else if (!d.startsWith('Use when')) {
    err('description must start with "Use when"');
  }
  const lower = d.toLowerCase();
  for (const w of BANNED_DESCRIPTION_WORDS) {
    if (lower.includes(w)) err(`description contains banned word "${w}"`);
  }
  if ((skill.kind === 'task' || skill.kind === 'testing') && stackName && !d.includes(stackName)) {
    err(`description must mention the stack name "${stackName}"`);
  }
  return errs;
}

function checkOrchestration(text, source, errs) {
  const lower = text.toLowerCase();
  for (const p of BANNED_ORCHESTRATION) {
    if (lower.includes(p)) errs.push(`${source}: banned orchestration phrase "${p}"`);
  }
}

function checkPlaceholders(text, allowed, source, errs) {
  for (const m of text.matchAll(/\{\{sc:([^}]*)\}\}/g)) {
    if (!allowed.includes(m[1])) {
      errs.push(`${source}: placeholder {{sc:${m[1]}}} is not allowed here (allowed: ${allowed.map((a) => `{{sc:${a}}}`).join(', ')})`);
    }
  }
}

function checkRule(rule, expectedId, errs) {
  const err = (m) => errs.push(`${rule.source}: ${m}`);
  if (rule.id !== expectedId) err(`id "${rule.id}" must be "${expectedId}"`);
  if (!isStr(rule.title)) err('title is required');
  if (!/^## Essentials\s*$/m.test(rule.body)) {
    err('missing "## Essentials" heading');
  } else {
    const bullets = rule.essentials.split('\n').filter((l) => /^[-*] /.test(l)).length;
    if (bullets > ESSENTIALS_MAX_BULLETS) err(`## Essentials has ${bullets} bullets (max ${ESSENTIALS_MAX_BULLETS})`);
  }
  checkOrchestration(rule.body, rule.source, errs);
}

function checkGuard(guard, source, errs) {
  guard.forEach((r, i) => {
    const label = r.id ? `guard rule "${r.id}"` : `guard rule #${i + 1}`;
    const err = (m) => errs.push(`${source}: ${label}: ${m}`);
    if (!isStr(r.id)) err('id is required');
    if (!isStrArray(r.globs) || r.globs.length === 0) err('globs must be a non-empty string array');
    if (!isStrArray(r.excludeGlobs)) err('excludeGlobs must be a string array');
    if (!isStr(r.regex)) {
      err('regex is required');
    } else {
      try {
        new RegExp(r.regex, r.flags);
      } catch (e) {
        err(`regex does not compile (${e.message})`);
      }
    }
  });
}

function checkDetect(detect, source, errs) {
  for (const k of ['files', 'contains', 'excludeContains', 'packageDeps']) {
    if (!detect || !isStrArray(detect[k])) errs.push(`${source}: detect.${k} must be a string array`);
  }
}

function checkSkill(skill, allowedKinds, where, stackName, addons, errs) {
  const err = (m) => errs.push(`${skill.source}: ${m}`);
  const folder = skillFolder(skill.source);
  if (skill.name !== folder) err(`name "${skill.name}" must equal its folder "${folder}"`);
  if (!skill.name.startsWith('stackcrew-')) err(`name "${skill.name}" must start with "stackcrew-"`);
  if (!allowedKinds.includes(skill.kind)) err(`kind "${skill.kind}" is invalid for ${where} skills (allowed: ${allowedKinds.join(', ')})`);
  errs.push(...lintSkillDescription(skill, stackName));
  if (!isStrArray(skill.paths)) err('paths must be a string array');
  if (!isStrArray(skill.requiresAddons)) err('requiresAddons must be a string array');
  for (const a of skill.requiresAddons) if (!addons.has(a)) err(`requiresAddons references unknown add-on "${a}"`);
  checkOrchestration(`${skill.description}\n${skill.body}`, skill.source, errs);
  const prefix = skill.source.replace(/SKILL\.md$/, '');
  for (const f of skill.files) {
    if (f.relPath.endsWith('.md')) checkOrchestration(f.content, prefix + f.relPath, errs);
  }
  if (skill.kind === 'command') checkPlaceholders(`${skill.description}\n${skill.body}`, COMMAND_PLACEHOLDERS, skill.source, errs);
}

/**
 * Validate the catalog against the layout and content rules.
 * @param {import('../types.js').Catalog} catalog
 * @returns {string[]} errors, each prefixed by the source path
 */
export function validateCatalog(catalog) {
  const errs = [];
  const ruleIds = new Map();
  const claimId = (rule) => {
    if (rule.id === '') return;
    if (ruleIds.has(rule.id)) errs.push(`${rule.source}: duplicate id "${rule.id}" (also in ${ruleIds.get(rule.id)})`);
    else ruleIds.set(rule.id, rule.source);
  };

  if (catalog.alwaysOn.trim() === '') errs.push('core/always-on.md: missing or empty');
  else checkOrchestration(catalog.alwaysOn, 'core/always-on.md', errs);

  for (const rule of catalog.coreRules) {
    checkRule(rule, `core-${rule.source.replace(/^core\/rules\/|\.md$/g, '')}`, errs);
    claimId(rule);
  }

  for (const [lang, l] of catalog.languages) {
    checkRule(l.rule, `lang-${lang}`, errs);
    claimId(l.rule);
    checkGuard(l.guard, `languages/${lang}/guard.json`, errs);
  }

  for (const [folder, a] of catalog.addons) {
    const src = `addons/${folder}/addon.json`;
    if (a.id !== folder) errs.push(`${src}: id "${a.id}" must equal its folder "${folder}"`);
    if (!isStr(a.name)) errs.push(`${src}: name is required`);
    // An empty list means the add-on applies to every language (see validateProfile and detectProject).
    if (!isStrArray(a.languages)) {
      errs.push(`${src}: languages must be a string array (empty = all languages)`);
    } else {
      for (const l of a.languages) if (!catalog.languages.has(l)) errs.push(`${src}: unknown language "${l}"`);
    }
    checkDetect(a.detect, src, errs);
    checkRule(a.rules, `addon-${folder}`, errs);
    claimId(a.rules);
  }

  const sharedNames = new Set();
  for (const s of catalog.sharedSkills) {
    checkSkill(s, SHARED_SKILL_KINDS, 'shared', undefined, catalog.addons, errs);
    if (sharedNames.has(s.name)) errs.push(`${s.source}: duplicate skill name "${s.name}"`);
    sharedNames.add(s.name);
  }

  for (const [folder, st] of catalog.stacks) {
    const src = `stacks/${folder}/stack.json`;
    const err = (m) => errs.push(`${src}: ${m}`);
    if (st.id !== folder) err(`id "${st.id}" must equal its folder "${folder}"`);
    if (!isStr(st.name)) err('name is required');
    if (!CATEGORIES.includes(st.category)) err(`category "${st.category}" must be one of ${CATEGORIES.join('|')}`);
    if (!catalog.languages.has(st.language)) err(`unknown language "${st.language}"`);
    if (!isStr(st.minVersion)) err('minVersion is required');
    if (!isStrArray(st.globs) || st.globs.length === 0) err('globs must be a non-empty string array');
    if (!isStrArray(st.aliases)) err('aliases must be a string array');
    if (typeof st.priority !== 'number' || !Number.isFinite(st.priority)) err('priority must be a number');
    checkDetect(st.detect, src, errs);

    checkRule(st.rules, `stack-${folder}`, errs);
    claimId(st.rules);
    checkRule(st.testing, `stack-${folder}-testing`, errs);
    claimId(st.testing);
    checkGuard(st.guard, `stacks/${folder}/guard.json`, errs);

    const names = new Set(sharedNames);
    for (const s of st.skills) {
      checkSkill(s, STACK_SKILL_KINDS, 'stack', st.name, catalog.addons, errs);
      if (names.has(s.name)) errs.push(`${s.source}: duplicate skill name "${s.name}"`);
      names.add(s.name);
    }
  }

  const roleIds = new Set();
  for (const r of catalog.roles) {
    const src = `roles/${r.id || '?'}.md`;
    if (!ROLE_IDS.includes(r.id)) errs.push(`${src}: id "${r.id}" must be one of ${ROLE_IDS.join('|')}`);
    if (roleIds.has(r.id)) errs.push(`${src}: duplicate role id "${r.id}"`);
    roleIds.add(r.id);
    if (!MODELS.includes(r.model)) errs.push(`${src}: model "${r.model}" must be one of ${MODELS.join('|')}`);
    if (!isStrArray(r.skillKinds) || r.skillKinds.some((k) => !ROLE_SKILL_KINDS.includes(k))) {
      errs.push(`${src}: skillKinds must be a subset of ${ROLE_SKILL_KINDS.join('|')}`);
    }
    if (!isStr(r.description)) errs.push(`${src}: description is required`);
    checkOrchestration(`${r.description}\n${r.body}`, src, errs);
  }

  for (const c of catalog.pluginCommands) {
    const src = `plugin-commands/${c.name || '?'}.md`;
    if (!isStr(c.name)) errs.push(`${src}: name is required`);
    if (!isStr(c.description)) errs.push(`${src}: description is required`);
    checkPlaceholders(`${c.description}\n${c.body}`, COMMAND_PLACEHOLDERS, src, errs);
    checkOrchestration(`${c.description}\n${c.body}`, src, errs);
  }

  return errs;
}
