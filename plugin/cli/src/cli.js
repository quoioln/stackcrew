import { readPackageVersion } from './paths.js';
import { StackcrewError } from './errors.js';
import { initCommand } from './commands/init.js';
import { syncCommand } from './commands/sync.js';
import { addCommand } from './commands/add.js';
import { listCommand } from './commands/list.js';
import { detectCommand } from './commands/detect.js';
import { checkCommand } from './commands/check.js';
import { pluginCommand } from './commands/plugin.js';

const COMMANDS = [
  ['init', 'Set up stackcrew in the current project'],
  ['sync', 'Regenerate rules, skills and roles from the profile'],
  ['add', 'Add a stack or addon to the profile'],
  ['list', 'List available stacks and addons'],
  ['detect', 'Detect the project stack'],
  ['check', 'Check changed files against guard rules'],
  ['plugin', 'Regenerate the Claude Code plugin files'],
  ['version', 'Print the stackcrew version'],
  ['help', 'Show this help'],
];

export function usage() {
  const width = Math.max(...COMMANDS.map(([name]) => name.length));
  const lines = COMMANDS.map(([name, desc]) => `  ${name.padEnd(width)}  ${desc}`);
  return `Usage: stackcrew <command> [options]\n\nCommands:\n${lines.join('\n')}\n`;
}

const HANDLERS = { init: initCommand, sync: syncCommand, add: addCommand, list: listCommand, detect: detectCommand, check: checkCommand, plugin: pluginCommand };

function defaultIo() {
  return {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: Boolean(process.stdin.isTTY),
  };
}

export async function main(argv, io = defaultIo()) {
  try {
    return await dispatch(argv, io);
  } catch (err) {
    if (err instanceof StackcrewError) {
      io.stderr.write(`stackcrew: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

async function dispatch(argv, io) {
  const [command] = argv;
  if (command === 'help' || command === '--help' || command === '-h') {
    io.stdout.write(usage());
    return 0;
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    io.stdout.write(`${await readPackageVersion()}\n`);
    return 0;
  }
  if (Object.hasOwn(HANDLERS, command)) return HANDLERS[command](argv.slice(1), io);
  if (command !== undefined) io.stderr.write(`Unknown command: ${command}\n`);
  io.stderr.write(usage());
  return 1;
}
