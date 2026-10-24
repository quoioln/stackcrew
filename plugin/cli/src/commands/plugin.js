import { parseCommandArgs } from './args.js';
import { loadCatalog } from '../catalog/load.js';
import { buildPlugin } from '../plugin/build.js';
import { PKG_ROOT, getCatalogDir, readPackageVersion } from '../paths.js';

export async function pluginCommand(args, io) {
  parseCommandArgs(args, {}, 'stackcrew plugin');
  const catalog = await loadCatalog(getCatalogDir());
  const written = await buildPlugin({ pkgRoot: PKG_ROOT, outRoot: PKG_ROOT, version: await readPackageVersion(), catalog });
  for (const rel of written) io.stdout.write(`${rel}\n`);
  return 0;
}
