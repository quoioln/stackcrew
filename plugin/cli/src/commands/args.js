import { parseArgs } from 'node:util';
import { StackcrewError } from '../errors.js';

/** Parse args strictly; unknown flags become a StackcrewError carrying the command usage. */
export function parseCommandArgs(args, options, usage) {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: true });
  } catch (err) {
    throw new StackcrewError('CLI', `${err.message}\nUsage: ${usage}`);
  }
}

export function splitList(value) {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}
