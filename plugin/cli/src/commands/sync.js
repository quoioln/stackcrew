import { parseCommandArgs } from './args.js';
import { runSync } from './run-sync.js';

const USAGE = 'stackcrew sync [--force] [--wire] [--dry-run]';

export async function syncCommand(args, io) {
  const { values } = parseCommandArgs(args, {
    force: { type: 'boolean' },
    wire: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
  }, USAGE);
  return runSync(io.cwd, { force: values.force, wire: values.wire, dryRun: values['dry-run'] }, io);
}
