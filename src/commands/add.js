import { parseCommandArgs } from './args.js';
import { runSync } from './run-sync.js';
import { loadCatalog } from '../catalog/load.js';
import { readProfile, writeProfile, validateProfile, PROFILE_FILE } from '../profile.js';

const USAGE = 'stackcrew add <addon...>';

export async function addCommand(args, io) {
  const { positionals } = parseCommandArgs(args, {}, USAGE);
  if (positionals.length === 0) {
    io.stderr.write(`Usage: ${USAGE}\n`);
    return 1;
  }
  const catalog = await loadCatalog();
  const profile = await readProfile(io.cwd);
  if (!profile) {
    io.stderr.write('stackcrew: no stackcrew.json found; run `stackcrew init` first\n');
    return 1;
  }
  const next = { ...profile, addons: [...(profile.addons ?? [])] };
  for (const id of positionals) if (!next.addons.includes(id)) next.addons.push(id);
  const errors = validateProfile(next, catalog);
  if (errors.length > 0) {
    for (const e of errors) io.stderr.write(`${PROFILE_FILE}: ${e}\n`);
    io.stderr.write(`Available addons: ${[...catalog.addons.keys()].sort().join(', ')}\n`);
    return 1;
  }
  await writeProfile(io.cwd, next);
  return runSync(io.cwd, {}, io);
}
