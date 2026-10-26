/** Per-project conventions: defaults, validation and the template variables derived from them. */

export const CONVENTION_DEFAULTS = Object.freeze({
  sharedLibraries: Object.freeze([]),
  baseEntity: 'BaseEntity',
  baseTenantEntity: 'BaseTenantEntity',
  tenantClaim: 'tenant_id',
  tenantColumn: 'tenantId',
  rolesClaim: 'roles',
  crossTenantRoles: Object.freeze(['super_admin']),
  sharedComponents: 'src/components/ui',
  systemUser: 'system',
  typeFreeFiles: Object.freeze([]),
});

export const CONVENTION_KEYS = Object.keys(CONVENTION_DEFAULTS);

/**
 * Variables exposed to catalog content as `{{sc:name}}`: the convention keys (typeFreeFiles only feeds guard globs),
 * plus crossTenantRolesCsv, a derived form of crossTenantRoles for config files (not a key of stackcrew.json).
 */
export const CONVENTION_VAR_NAMES = [...CONVENTION_KEYS.filter((k) => k !== 'typeFreeFiles'), 'crossTenantRolesCsv'];

const IDENT_KEYS = ['baseEntity', 'baseTenantEntity', 'tenantColumn'];
const TOKEN_KEYS = ['tenantClaim', 'rolesClaim', 'systemUser'];
const LIST_KEYS = ['sharedLibraries', 'crossTenantRoles', 'typeFreeFiles'];
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
/** Claim names, the system user and roles go into Java and TypeScript string literals, YAML and a comma-separated list. */
const TOKEN_RE = /^[A-Za-z0-9_.:/-]+$/;
const TOKEN_CHARS = 'A-Z a-z 0-9 _ . : / -';

/** @param {import('./types.js').Profile} profile @returns {import('./types.js').Conventions} */
export function resolveConventions(profile) {
  const declared = profile.conventions ?? {};
  const out = {};
  for (const k of CONVENTION_KEYS) {
    const v = Object.prototype.hasOwnProperty.call(declared, k) ? declared[k] : CONVENTION_DEFAULTS[k];
    out[k] = Array.isArray(v) ? [...v] : v;
  }
  return out;
}

/** @param {unknown} value @returns {string[]} */
export function validateConventions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['conventions: must be an object'];
  const errors = [];
  for (const k of Object.keys(value)) {
    if (!CONVENTION_KEYS.includes(k)) errors.push(`conventions: unknown key "${k}" (allowed: ${CONVENTION_KEYS.join(', ')})`);
  }
  const has = (k) => Object.prototype.hasOwnProperty.call(value, k);
  for (const k of IDENT_KEYS) {
    if (has(k) && !(typeof value[k] === 'string' && IDENT_RE.test(value[k]))) {
      errors.push(`conventions.${k}: must be an identifier (letters, digits, _ or $; not starting with a digit)`);
    }
  }
  for (const k of TOKEN_KEYS) {
    if (has(k) && !(typeof value[k] === 'string' && TOKEN_RE.test(value[k]))) {
      errors.push(`conventions.${k}: must be a non-empty string of the characters ${TOKEN_CHARS}`);
    }
  }
  if (has('sharedComponents')) {
    const p = value.sharedComponents;
    const ok = typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes(String.fromCharCode(92)) && !p.split('/').includes('..');
    if (!ok) errors.push('conventions.sharedComponents: must be a non-empty relative POSIX path (no leading "/", no "\\", no ".." segment)');
  }
  for (const k of LIST_KEYS) {
    if (has(k) && !(Array.isArray(value[k]) && value[k].every((x) => typeof x === 'string' && x !== ''))) {
      errors.push(`conventions.${k}: must be an array of non-empty strings`);
    }
  }
  if (has('crossTenantRoles') && Array.isArray(value.crossTenantRoles)) {
    for (const role of value.crossTenantRoles.filter((r) => typeof r === 'string' && r !== '' && !TOKEN_RE.test(r))) {
      errors.push(`conventions.crossTenantRoles: role ${JSON.stringify(role)} must use only the characters ${TOKEN_CHARS}`);
    }
  }
  return errors;
}

const ticks = (list) => list.map((x) => `\`${x}\``).join(', ');

/** Display form of a convention value (as used by the template variables). */
export function conventionDisplay(c, key) {
  // Config-file form: plain roles joined with "," (no spaces, no backticks); no roles gives "" (grants nothing).
  if (key === 'crossTenantRolesCsv') return c.crossTenantRoles.join(',');
  if (key === 'crossTenantRoles') return c.crossTenantRoles.length === 0 ? 'none (cross-tenant access is disabled)' : ticks(c.crossTenantRoles);
  if (key === 'sharedLibraries') return c.sharedLibraries.length === 0 ? 'none declared (set conventions.sharedLibraries in stackcrew.json)' : ticks(c.sharedLibraries);
  if (key === 'typeFreeFiles') return c.typeFreeFiles.length === 0 ? '_none_' : ticks(c.typeFreeFiles);
  return c[key];
}

/** @param {import('./types.js').Conventions} c @returns {Record<string,string>} */
export function conventionVars(c) {
  const vars = {};
  for (const k of CONVENTION_VAR_NAMES) vars[k] = conventionDisplay(c, k);
  return vars;
}
