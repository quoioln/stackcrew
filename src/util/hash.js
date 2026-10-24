import { createHash } from 'node:crypto';

/** Normalize CRLF to LF. */
export function toLf(text) {
  return text.replace(/\r\n/g, '\n');
}

/** Hex sha256 of the LF-normalized text. */
export function sha256(text) {
  return createHash('sha256').update(toLf(text), 'utf8').digest('hex');
}
