import { readPackageVersion } from './paths.js';

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

const NOT_BUILT = new Set(['init', 'sync', 'add', 'list', 'detect', 'check', 'plugin']);

function defaultIo() {
  return {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: Boolean(process.stdin.isTTY),
  };
}

export async function main(argv, io = defaultIo()) {
  const [command] = argv;
  if (command === 'help' || command === '--help' || command === '-h') {
    io.stdout.write(usage());
    return 0;
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    io.stdout.write(`${await readPackageVersion()}\n`);
    return 0;
  }
  if (NOT_BUILT.has(command)) {
    io.stderr.write(`stackcrew ${command}: not implemented\n`);
    return 1;
  }
  if (command !== undefined) io.stderr.write(`Unknown command: ${command}\n`);
  io.stderr.write(usage());
  return 1;
}
