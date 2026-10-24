import { StackcrewError } from '../errors.js';

export const MD_MARKERS = { begin: '<!-- stackcrew:begin -->', end: '<!-- stackcrew:end -->' };
export const GRADLE_MARKERS = { begin: '// stackcrew:begin', end: '// stackcrew:end' };

function countOf(text, needle) {
  return text.split(needle).length - 1;
}

/**
 * Insert or replace the stackcrew-managed block in `existing`, leaving every
 * byte outside the markers untouched. The host file's EOL style is kept.
 * @param {string} existing
 * @param {string} content
 * @param {{ begin: string, end: string }} [markers]
 * @returns {string}
 */
export function upsertMarkedBlock(existing, content, markers = MD_MARKERS) {
  const { begin, end } = markers;
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const body = content.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  const nBegin = countOf(existing, begin);
  const nEnd = countOf(existing, end);

  if (nBegin === 0 && nEnd === 0) {
    let out = existing;
    if (out !== '') {
      if (!out.endsWith('\n')) out += eol;
      out += eol;
    }
    return `${out}${begin}${eol}${body}${eol}${end}${eol}`;
  }

  if (nBegin === 1 && nEnd === 1) {
    const bi = existing.indexOf(begin);
    const ei = existing.indexOf(end);
    if (bi + begin.length <= ei) {
      return `${existing.slice(0, bi + begin.length)}${eol}${body}${eol}${existing.slice(ei)}`;
    }
  }

  throw new StackcrewError(
    'MARKER',
    `Expected exactly one "${begin}" followed by one "${end}", found ${nBegin} begin and ${nEnd} end marker(s). ` +
      'Fix or remove the stray marker and run again; nothing was written.'
  );
}
