/** Current ESLint 9 / typescript-eslint 8 releases (npm view eslint@9 / @eslint/js@9 / typescript-eslint@8, 2026-10-26). */
export const ESLINT_DEPS = { eslint: '^9.39.5', '@eslint/js': '^9.39.5', 'typescript-eslint': '^8.72.0' };

/** ESLint's flat-config lookup order. */
export const FLAT_CONFIG_FILES = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts'];
/** ESLint 8's legacy lookup order (package.json `eslintConfig` comes after these). */
export const LEGACY_CONFIG_FILES = ['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml', '.eslintrc.json', '.eslintrc'];

export const FLAT_IMPORT = "import stackcrewConfig from './.stackcrew/lint/eslint.stackcrew.mjs';";
export const LEGACY_EXTENDS = './.stackcrew/lint/eslintrc.stackcrew.cjs';

const FLAT_MARKER = '.stackcrew/lint/eslint.stackcrew.mjs';
/** Either one supplies the @typescript-eslint plugin that the stackcrew flat config's rules need. */
const TS_ESLINT_PACKAGES = ['typescript-eslint', '@typescript-eslint/eslint-plugin'];
const FLAT_EDITABLE = /\.(js|mjs|ts|mts)$/;
const EXPORT_DEFAULT = /^export default /gm;

// A plain array (no defineConfig/globalIgnores, which need ESLint >= 9.22) so it loads on every ESLint 9.x.
const NEW_FLAT_CONFIG = `// Created by stackcrew sync --wire. This file is yours to edit.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
${FLAT_IMPORT}

export default [
  { ignores: ['dist/**', '.next/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...stackcrewConfig,
];
`;

const FLAT_SNIPPET = `${FLAT_IMPORT}\nexport default [...yourExistingConfig, ...stackcrewConfig];`;
const LEGACY_SNIPPET = `"extends": [..., "${LEGACY_EXTENDS}"]`;
const INSTALL_NOTE = (added) =>
  `run your package manager's install (npm install / yarn / pnpm install) to install: ${added.join(', ')}`;

const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** First integer in the eslint dependency range, or null when absent or digit-free. */
export function eslintMajor(pkg) {
  const range = pkg?.dependencies?.eslint ?? pkg?.devDependencies?.eslint;
  if (typeof range !== 'string') return null;
  const m = /\d+/.exec(range);
  return m ? Number(m[0]) : null;
}

/** Serialize with the original's indent, BOM and line endings. */
function stringifyLike(original, value) {
  const bom = original.startsWith('﻿') ? '﻿' : '';
  const ind = /^([ \t]+)\S/m.exec(original);
  const indent = ind ? (ind[1][0] === '\t' ? '\t' : ind[1].length) : 2;
  const out = `${JSON.stringify(value, null, indent)}\n`;
  return bom + (original.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out);
}

/** Append LEGACY_EXTENDS to an ESLint 8 config object's `extends`. */
function withLegacyExtends(config) {
  const current = config.extends;
  const list = current === undefined ? [] : Array.isArray(current) ? current : [current];
  return { ...config, extends: [...list, LEGACY_EXTENDS] };
}

const stripBom = (text) => text.replace(/^﻿/, '');

function parseJson(text) {
  try {
    return JSON.parse(stripBom(text));
  } catch {
    return undefined;
  }
}

function flatEdit(text) {
  const eol = eolOf(text);
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = stripBom(text).replace(EXPORT_DEFAULT, 'const stackcrewBaseConfig = ');
  const tail = 'export default [...[stackcrewBaseConfig].flat(), ...stackcrewConfig];';
  return `${bom}${FLAT_IMPORT}${eol}${body}${body.endsWith('\n') ? '' : eol}${tail}${eol}`;
}

function planFlat(configs) {
  const file = FLAT_CONFIG_FILES.find((f) => typeof configs[f] === 'string');
  const legacy = LEGACY_CONFIG_FILES.some((f) => typeof configs[f] === 'string');
  if (!file) {
    if (legacy) return { note: `ESLint >= 9 reads flat config (eslint.config.*), not .eslintrc; create eslint.config.mjs or add this to your flat config:\n${FLAT_SNIPPET}` };
    return { create: true };
  }
  const text = configs[file];
  if (text.includes(FLAT_MARKER)) return { wired: file };
  const defaults = stripBom(text).match(EXPORT_DEFAULT)?.length ?? 0;
  if (!FLAT_EDITABLE.test(file) || defaults !== 1 || text.includes('module.exports')) {
    return { note: `${file}: cannot be edited automatically (expected one ESM \`export default\`); add this to it:\n${FLAT_SNIPPET}` };
  }
  return { edit: { path: file, content: flatEdit(text) }, wired: file };
}

function planLegacy(pkg, packageJson, configs) {
  const file = LEGACY_CONFIG_FILES.find((f) => typeof configs[f] === 'string');
  const manual = (where) => ({ note: `${where}: cannot be edited automatically; add this to it:\n${LEGACY_SNIPPET}` });
  if (file) {
    const text = configs[file];
    if (text.includes(LEGACY_EXTENDS)) return { wired: file };
    const parsed = file === '.eslintrc.json' ? parseJson(text) : undefined;
    if (!isObject(parsed)) return manual(file);
    return { edit: { path: file, content: stringifyLike(text, withLegacyExtends(parsed)) }, wired: file };
  }
  if (isObject(pkg.eslintConfig)) {
    if (JSON.stringify(pkg.eslintConfig).includes(LEGACY_EXTENDS)) return { wired: 'package.json' };
    return { edit: { path: 'package.json', content: stringifyLike(packageJson, { ...pkg, eslintConfig: withLegacyExtends(pkg.eslintConfig) }) }, wired: 'package.json' };
  }
  return { note: `no ESLint config found; add this to your .eslintrc.json (or the \`eslintConfig\` key in package.json):\n${LEGACY_SNIPPET}` };
}

/** Add the ESLINT_DEPS that are not declared yet to devDependencies (sorted). */
function addDeps(pkg, packageJson) {
  const declared = (name) => pkg.dependencies?.[name] !== undefined || pkg.devDependencies?.[name] !== undefined;
  const added = Object.keys(ESLINT_DEPS).filter((n) => !declared(n));
  if (added.length === 0) return { added };
  const dev = { ...pkg.devDependencies };
  for (const n of added) dev[n] = ESLINT_DEPS[n];
  const sorted = Object.fromEntries(Object.entries(dev).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { added, edit: { path: 'package.json', content: stringifyLike(packageJson, { ...pkg, devDependencies: sorted }) } };
}

/**
 * Plan ESLint wiring for a TypeScript project. Pure: `configs` maps each existing ESLint config
 * file name to its text; the caller does the I/O.
 * `wired` lists the files that carry the stackcrew config after the edits.
 * @param {{ packageJson?: string, configs: Record<string, string> }} files
 * @returns {{ edits: { path: string, content: string }[], notes: string[], wired: string[] }}
 */
export function planNodeWiring({ packageJson, configs = {} } = {}) {
  const edits = [];
  const notes = [];
  const wired = [];
  const result = () => ({ edits, notes, wired });

  const pkg = typeof packageJson === 'string' ? parseJson(packageJson) : undefined;
  if (!isObject(pkg)) {
    notes.push(`package.json: ${typeof packageJson === 'string' ? 'is not valid JSON' : 'not found'}; stackcrew cannot detect ESLint without it. Add ESLint and this to your config:\n${FLAT_SNIPPET}`);
    return result();
  }

  const hasConfig = isObject(pkg.eslintConfig) || [...FLAT_CONFIG_FILES, ...LEGACY_CONFIG_FILES].some((f) => typeof configs[f] === 'string');
  const declared = (name) => pkg.dependencies?.[name] !== undefined || pkg.devDependencies?.[name] !== undefined;
  const hasDep = (pkg.dependencies?.eslint ?? pkg.devDependencies?.eslint) !== undefined;
  const major = eslintMajor(pkg);

  let plan;
  if (!hasDep) {
    if (hasConfig) {
      notes.push(`ESLint config found but no \`eslint\` dependency in package.json; add eslint and re-run, or add this to your config:\n${FLAT_SNIPPET}`);
      return result();
    }
    const deps = addDeps(pkg, packageJson);
    edits.push(deps.edit);
    edits.push({ path: 'eslint.config.mjs', content: NEW_FLAT_CONFIG });
    wired.push('package.json', 'eslint.config.mjs');
    notes.push(INSTALL_NOTE(deps.added));
    return result();
  }
  if (major === null || major < 8) {
    const range = pkg.dependencies?.eslint ?? pkg.devDependencies?.eslint;
    const why = major === null ? `cannot read the ESLint major from "${range}"` : `unsupported ESLint version "${range}"`;
    notes.push(`${why} (stackcrew wires ESLint 8 and 9+); add the stackcrew config yourself:\n${FLAT_SNIPPET}`);
    return result();
  }

  plan = major >= 9 ? planFlat(configs) : planLegacy(pkg, packageJson, configs);
  if (plan.create) {
    edits.push({ path: 'eslint.config.mjs', content: NEW_FLAT_CONFIG });
    wired.push('eslint.config.mjs');
    const missing = ['@eslint/js', 'typescript-eslint'].filter((n) => !declared(n));
    if (missing.length > 0) notes.push(`eslint.config.mjs imports ${missing.join(', ')}, which package.json does not declare; install ${missing.length > 1 ? 'them' : 'it'}`);
    return result();
  }
  if (plan.edit) edits.push(plan.edit);
  if (plan.edit && major >= 9 && !TS_ESLINT_PACKAGES.some(declared)) {
    notes.push(`${plan.edit.path}: the stackcrew rules use @typescript-eslint rules, but package.json declares neither ${TS_ESLINT_PACKAGES.join(' nor ')}; install typescript-eslint and add its configs to your ESLint config`);
  }
  if (plan.wired) wired.push(plan.wired);
  if (plan.note) notes.push(plan.note);
  return result();
}
