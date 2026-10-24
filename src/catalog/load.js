import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getCatalogDir } from '../paths.js';
import { StackcrewError } from '../errors.js';
import { parseFrontmatter } from '../util/frontmatter.js';
import { toLf } from '../util/hash.js';

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const arr = (v) => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);
const isMissing = (e) => e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');
const abs = (dir, source) => path.join(dir, ...source.split('/'));

async function readText(file) {
  const text = await readFile(file, 'utf8');
  return toLf(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

/** Returns file text, or null when the file does not exist. */
async function readOptional(file) {
  try {
    return await readText(file);
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

async function listEntries(dirAbs) {
  try {
    return (await readdir(dirAbs, { withFileTypes: true })).sort((a, b) => byName(a.name, b.name));
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
}

const listDirs = async (dirAbs) => (await listEntries(dirAbs)).filter((e) => e.isDirectory()).map((e) => e.name);
const listMd = async (dirAbs) => (await listEntries(dirAbs)).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name);

/** All files under `root` recursively as SkillFile (POSIX relPath), sorted; `skip` = relPaths to omit. */
async function readTree(root, skip = []) {
  const out = [];
  async function walk(sub) {
    for (const e of await listEntries(path.join(root, sub))) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(rel);
      else if (e.isFile() && !skip.includes(rel)) out.push({ relPath: rel, content: await readText(path.join(root, rel)) });
    }
  }
  await walk('');
  return out.sort((a, b) => byName(a.relPath, b.relPath));
}

function parseDoc(text, source) {
  try {
    return parseFrontmatter(text);
  } catch (e) {
    if (e instanceof StackcrewError) throw new StackcrewError('CATALOG', `${source}: ${e.message}`);
    throw e;
  }
}

function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new StackcrewError('CATALOG', `${source}: invalid JSON (${e.message})`);
  }
}

export function extractEssentials(body) {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => /^## Essentials\s*$/.test(l));
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

/** A missing file yields an empty RuleDoc (id '') that validateCatalog reports. */
async function loadRule(dir, source) {
  const text = await readOptional(abs(dir, source));
  if (text === null) return { id: '', title: '', categories: [], languages: [], essentials: '', body: '', source };
  const { data, body } = parseDoc(text, source);
  return {
    id: str(data.id),
    title: str(data.title),
    categories: arr(data.categories),
    languages: arr(data.languages),
    essentials: extractEssentials(body),
    body,
    source,
  };
}

async function loadGuard(dir, source) {
  const text = await readOptional(abs(dir, source));
  if (text === null) return [];
  const json = parseJson(text, source);
  const rules = json && typeof json === 'object' ? json.rules : undefined;
  if (rules === undefined) return [];
  if (!Array.isArray(rules)) throw new StackcrewError('CATALOG', `${source}: "rules" must be an array`);
  return rules.map((r) => ({
    id: str(r && r.id),
    globs: arr(r && r.globs),
    excludeGlobs: arr(r && r.excludeGlobs),
    regex: str(r && r.regex),
    flags: str(r && r.flags),
    message: str(r && r.message),
  }));
}

async function loadJsonObject(dir, source) {
  const text = await readOptional(abs(dir, source));
  if (text === null) throw new StackcrewError('CATALOG', `${source}: file not found`);
  const json = parseJson(text, source);
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new StackcrewError('CATALOG', `${source}: expected a JSON object`);
  }
  return json;
}

function normDetect(d) {
  const o = d && typeof d === 'object' ? d : {};
  return { files: arr(o.files), contains: arr(o.contains), excludeContains: arr(o.excludeContains), packageDeps: arr(o.packageDeps) };
}

async function loadSkills(dir, base) {
  const skills = [];
  for (const folder of await listDirs(abs(dir, base))) {
    const source = `${base}/${folder}/SKILL.md`;
    const text = await readOptional(abs(dir, source));
    if (text === null) throw new StackcrewError('CATALOG', `${base}/${folder}: missing SKILL.md`);
    const { data, body } = parseDoc(text, source);
    skills.push({
      name: str(data.name),
      description: str(data.description),
      kind: str(data.kind),
      paths: arr(data.paths),
      requiresAddons: arr(data.requiresAddons),
      body,
      files: await readTree(abs(dir, `${base}/${folder}`), ['SKILL.md']),
      source,
    });
  }
  return skills;
}

async function loadStack(dir, id) {
  const base = `stacks/${id}`;
  const j = await loadJsonObject(dir, `${base}/stack.json`);
  return {
    id: str(j.id),
    name: str(j.name),
    category: str(j.category),
    language: str(j.language),
    minVersion: str(j.minVersion),
    globs: arr(j.globs),
    aliases: arr(j.aliases),
    priority: j.priority,
    detect: normDetect(j.detect),
    rules: await loadRule(dir, `${base}/rules.md`),
    testing: await loadRule(dir, `${base}/testing.md`),
    skills: await loadSkills(dir, `${base}/skills`),
    guard: await loadGuard(dir, `${base}/guard.json`),
    lintFiles: await readTree(abs(dir, `${base}/lint`)),
    wireFiles: await readTree(abs(dir, `${base}/wire`)),
  };
}

async function loadAddon(dir, folder) {
  const base = `addons/${folder}`;
  const j = await loadJsonObject(dir, `${base}/addon.json`);
  // The key must be written down on purpose: [] means every language, and a forgotten key must not silently mean that.
  if (!Array.isArray(j.languages)) {
    throw new StackcrewError('CATALOG', `${base}/addon.json: "languages" must be an array (use [] for every language)`);
  }
  return {
    id: str(j.id),
    name: str(j.name),
    languages: arr(j.languages),
    detect: normDetect(j.detect),
    rules: await loadRule(dir, `${base}/rules.md`),
  };
}

async function loadMdDir(dir, base, make) {
  const out = [];
  for (const file of await listMd(abs(dir, base))) {
    const source = `${base}/${file}`;
    const { data, body } = parseDoc(await readText(abs(dir, source)), source);
    out.push(make(data, body));
  }
  return out;
}

/**
 * Load the content catalog from `dir`. Missing optional dirs are empty;
 * a malformed file throws StackcrewError 'CATALOG' naming the file.
 * @returns {Promise<import('../types.js').Catalog>}
 */
export async function loadCatalog(dir = getCatalogDir()) {
  const alwaysOn = (await readOptional(abs(dir, 'core/always-on.md'))) ?? '';

  const coreRules = [];
  for (const file of await listMd(abs(dir, 'core/rules'))) coreRules.push(await loadRule(dir, `core/rules/${file}`));

  const languages = new Map();
  for (const lang of await listDirs(abs(dir, 'languages'))) {
    languages.set(lang, {
      id: lang,
      rule: await loadRule(dir, `languages/${lang}/rule.md`),
      guard: await loadGuard(dir, `languages/${lang}/guard.json`),
    });
  }

  const stacks = new Map();
  for (const id of await listDirs(abs(dir, 'stacks'))) stacks.set(id, await loadStack(dir, id));

  const addons = new Map();
  for (const id of await listDirs(abs(dir, 'addons'))) addons.set(id, await loadAddon(dir, id));

  const roles = await loadMdDir(dir, 'roles', (data, body) => ({
    id: str(data.id),
    model: str(data.model),
    skillKinds: arr(data.skillKinds),
    description: str(data.description),
    body,
  }));

  const pluginCommands = await loadMdDir(dir, 'plugin-commands', (data, body) => ({
    name: str(data.name),
    description: str(data.description),
    body,
  }));

  const sharedSkills = await loadSkills(dir, 'skills');
  return { dir, alwaysOn, coreRules, languages, stacks, addons, sharedSkills, roles, pluginCommands };
}
