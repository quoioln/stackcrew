import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';

const BROWNFIELD_FILES = ['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'go.mod'];
const MAX_JAVA_FILES = 2000;
// Specs with `contains` but no `files` (e.g. addons) are checked against these build manifests.
const DEFAULT_SCAN_FILES = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'package.json'];

async function readText(file) {
  try {
    return (await readFile(file, 'utf8')).replace(/^﻿/, '');
  } catch {
    return null;
  }
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readPackageDeps(projectDir) {
  const text = await readText(path.join(projectDir, 'package.json'));
  if (text === null) return new Set();
  try {
    const pkg = JSON.parse(text);
    return new Set([...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})]);
  } catch {
    return new Set();
  }
}

/** @param {import('./types.js').DetectSpec} spec */
async function matches(spec, projectDir, deps) {
  const files = spec.files.length === 0 && spec.contains.length > 0 ? DEFAULT_SCAN_FILES : spec.files;
  for (const file of files) {
    const text = await readText(path.join(projectDir, file));
    if (text === null) continue;
    if (spec.contains.length > 0 && !spec.contains.some((s) => text.includes(s))) continue;
    if (spec.excludeContains.some((s) => text.includes(s))) continue;
    return true;
  }
  return spec.packageDeps.some((d) => deps.has(d));
}

async function looksLikeExistingProject(projectDir) {
  for (const f of BROWNFIELD_FILES) if (await exists(path.join(projectDir, f))) return true;
  return exists(path.join(projectDir, 'src'));
}

async function findBasePackage(projectDir) {
  const root = path.join(projectDir, 'src', 'main', 'java');
  let seen = 0;
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (seen >= MAX_JAVA_FILES) return null;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const found = await walk(full);
        if (found) return found;
      } else if (e.isFile() && e.name.endsWith('.java')) {
        seen++;
        const text = await readText(full);
        if (text !== null && text.includes('@SpringBootApplication')) {
          const m = /^\s*package\s+([\w.]+)\s*;/m.exec(text);
          if (m) return m[1];
        }
      }
    }
    return null;
  }
  return walk(root);
}

export async function detectProject(projectDir, catalog) {
  const deps = await readPackageDeps(projectDir);

  const found = [];
  for (const stack of catalog.stacks.values()) {
    if (await matches(stack.detect, projectDir, deps)) found.push(stack);
  }
  const top = found.reduce((max, s) => Math.max(max, s.priority), -Infinity);
  const winners = found.filter((s) => s.priority === top);
  const stack = winners.length === 1 ? winners[0] : null;

  const addons = [];
  if (stack) {
    for (const addon of catalog.addons.values()) {
      if (addon.languages.length > 0 && !addon.languages.includes(stack.language)) continue;
      if (await matches(addon.detect, projectDir, deps)) addons.push(addon.id);
    }
  }

  return {
    stack: stack ? stack.id : null,
    candidates: found.map((s) => s.id),
    addons,
    mode: (await looksLikeExistingProject(projectDir)) ? 'brownfield' : 'greenfield',
    basePackage: await findBasePackage(projectDir),
  };
}
