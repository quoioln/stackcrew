import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function getCatalogDir() {
  return process.env.STACKCREW_CATALOG_DIR || path.join(PKG_ROOT, 'catalog');
}

export async function readPackageVersion() {
  const pkg = JSON.parse(await readFile(path.join(PKG_ROOT, 'package.json'), 'utf8'));
  return pkg.version;
}
