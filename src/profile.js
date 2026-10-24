import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { StackcrewError } from './errors.js';

export const PROFILE_FILE = 'stackcrew.json';
export const TOOLS = ['claude', 'cursor', 'codex', 'antigravity'];

const MODES = ['greenfield', 'brownfield'];
const BASE_PACKAGE_RE = /^([a-z_]\w*)(\.[a-z_]\w*)*$/;

/** @returns {Promise<import('./types.js').Profile|null>} */
export async function readProfile(projectDir) {
  let raw;
  try {
    raw = await readFile(path.join(projectDir, PROFILE_FILE), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(raw.replace(/^﻿/, ''));
  } catch (err) {
    throw new StackcrewError('PROFILE', `${PROFILE_FILE} is not valid JSON: ${err.message}`);
  }
}

export async function writeProfile(projectDir, profile) {
  await writeFile(path.join(projectDir, PROFILE_FILE), JSON.stringify(profile, null, 2) + '\n');
}

export function createProfile({ stack, addons = [], tools = TOOLS, mode, guard = true, basePackage = null }, catalog) {
  const profile = { version: 1, stack, addons, tools, mode, guard, context: {}, decisions: [] };
  if (catalog.stacks.get(stack)?.language === 'java') {
    profile.java = { basePackage: basePackage ?? '', wired: false };
  }
  return profile;
}

const isStr = (v) => typeof v === 'string';

export function validateProfile(profile, catalog) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return ['profile: must be an object'];
  const errors = [];
  if (profile.version !== 1) errors.push('version: must be 1');

  const stack = catalog.stacks.get(profile.stack);
  if (!stack) errors.push(`stack: unknown stack "${profile.stack}"`);

  if (!Array.isArray(profile.addons)) {
    errors.push('addons: must be an array');
  } else {
    profile.addons.forEach((id, i) => {
      const addon = catalog.addons.get(id);
      if (!addon) errors.push(`addons[${i}]: unknown addon "${id}"`);
      else if (stack && addon.languages.length > 0 && !addon.languages.includes(stack.language)) {
        errors.push(`addons[${i}]: addon "${id}" does not apply to language "${stack.language}"`);
      }
    });
  }

  if (!Array.isArray(profile.tools) || profile.tools.length === 0) {
    errors.push('tools: must be a non-empty array');
  } else {
    const bad = profile.tools.filter((t) => !TOOLS.includes(t));
    if (bad.length > 0) errors.push(`tools: unknown tool(s) ${bad.map((t) => `"${t}"`).join(', ')} (allowed: ${TOOLS.join(', ')})`);
  }

  if (!MODES.includes(profile.mode)) errors.push(`mode: must be one of ${MODES.join(', ')}`);
  if (typeof profile.guard !== 'boolean') errors.push('guard: must be a boolean');

  if (!Array.isArray(profile.decisions)) {
    errors.push('decisions: must be an array');
  } else {
    profile.decisions.forEach((d, i) => {
      const ok = d && typeof d === 'object'
        && ['id', 'area', 'decision', 'rationale'].every((k) => isStr(d[k]))
        && Array.isArray(d.rejected) && d.rejected.every(isStr);
      if (!ok) errors.push(`decisions[${i}]: must have string id, area, decision, rationale and string[] rejected`);
    });
  }

  const bp = profile.java?.basePackage;
  if (profile.java !== undefined && !isStr(bp)) errors.push('java.basePackage: must be a string');
  else if (isStr(bp) && bp !== '' && !BASE_PACKAGE_RE.test(bp)) errors.push(`java.basePackage: "${bp}" is not a valid Java package`);

  return errors;
}
