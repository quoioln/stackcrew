import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { createProfile } from '../src/profile.js';
import { buildContext } from '../src/render/context.js';

const MINI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'catalog-mini');

/** Build a RenderContext from the mini catalog for renderer tests. */
export async function miniCtx(tools, { addons = [], wired = false } = {}) {
  const catalog = await loadCatalog(MINI);
  const profile = createProfile({ stack: 'demo-java', addons, tools, mode: 'greenfield', basePackage: 'com.acme' }, catalog);
  profile.java.wired = wired;
  return buildContext(catalog, profile, { cli: 'npx --yes stackcrew@0.0.0-test', version: '0.0.0-test' });
}
