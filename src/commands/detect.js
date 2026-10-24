import { parseCommandArgs } from './args.js';
import { loadCatalog } from '../catalog/load.js';
import { detectProject } from '../detect.js';

export async function detectCommand(args, io) {
  parseCommandArgs(args, {}, 'stackcrew detect');
  const catalog = await loadCatalog();
  const d = await detectProject(io.cwd, catalog);
  io.stdout.write(`stack: ${d.stack ?? 'none'}\n`);
  io.stdout.write(`candidates: ${d.candidates.join(', ') || 'none'}\n`);
  io.stdout.write(`addons: ${d.addons.join(', ') || 'none'}\n`);
  io.stdout.write(`mode: ${d.mode}\n`);
  io.stdout.write(`basePackage: ${d.basePackage ?? 'none'}\n`);
  return 0;
}
