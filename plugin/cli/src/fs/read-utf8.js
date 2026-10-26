import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { StackcrewError } from '../errors.js';

/** Read a project file as UTF-8 (BOM kept). Undefined if absent. Throws MARKER if not UTF-8. */
export async function readUtf8File(projectDir, rel) {
  let buf;
  try {
    buf = await readFile(path.join(projectDir, rel));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return undefined;
    throw err;
  }
  const utf16 = buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff));
  try {
    if (utf16) throw new Error('utf-16');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    // Same check as readBlockHost in src/fs/apply.js (not exported there).
    throw new StackcrewError('MARKER', `${rel}: not UTF-8 text; stackcrew will not edit it (convert it to UTF-8 first)`);
  }
}
