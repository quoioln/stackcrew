import { parseCommandArgs } from './args.js';
import { loadCatalog } from '../catalog/load.js';

export async function listCommand(args, io) {
  parseCommandArgs(args, {}, 'stackcrew list');
  const catalog = await loadCatalog();
  io.stdout.write('Stacks:\n');
  for (const s of [...catalog.stacks.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    io.stdout.write(`  ${s.id}  ${s.name}  ${s.category}  min ${s.minVersion}\n`);
  }
  io.stdout.write('Addons:\n');
  for (const a of [...catalog.addons.values()].sort((x, y) => x.id.localeCompare(y.id))) {
    io.stdout.write(`  ${a.id}  ${a.name}  languages: ${a.languages.join(', ') || 'all'}\n`);
  }
  return 0;
}
