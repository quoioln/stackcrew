import { StackcrewError } from '../errors.js';

export const MD_MARKERS = { begin: '<!-- stackcrew:begin -->', end: '<!-- stackcrew:end -->' };
export const GRADLE_MARKERS = { begin: '// stackcrew:begin', end: '// stackcrew:end' };

/** Locate lines whose trimmed text equals the marker (whole-line match only). */
function markerLines(text, marker) {
  const found = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    const lineEnd = nl === -1 ? text.length : nl;
    const contentEnd = lineEnd > start && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
    if (text.slice(start, contentEnd).trim() === marker) found.push({ start, contentEnd });
    if (nl === -1) break;
    start = nl + 1;
  }
  return found;
}

/**
 * Insert or replace the stackcrew-managed block in `existing`, leaving every
 * byte outside the markers untouched. The host file's EOL style is kept.
 * Markers count only when they are alone on a line (trimmed line equals marker).
 * @param {string} existing
 * @param {string} content
 * @param {{ begin: string, end: string }} [markers]
 * @returns {string}
 */
export function upsertMarkedBlock(existing, content, markers = MD_MARKERS) {
  const { begin, end } = markers;
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const body = content.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  const begins = markerLines(existing, begin);
  const ends = markerLines(existing, end);
  const nBegin = begins.length;
  const nEnd = ends.length;

  if (nBegin === 0 && nEnd === 0) {
    let out = existing;
    if (out !== '') {
      if (!out.endsWith('\n')) out += eol;
      out += eol;
    }
    return `${out}${begin}${eol}${body}${eol}${end}${eol}`;
  }

  if (nBegin === 1 && nEnd === 1 && begins[0].start < ends[0].start) {
    return `${existing.slice(0, begins[0].contentEnd)}${eol}${body}${eol}${existing.slice(ends[0].start)}`;
  }

  throw new StackcrewError(
    'MARKER',
    `Expected exactly one "${begin}" line followed by one "${end}" line, found ${nBegin} begin and ${nEnd} end marker line(s). ` +
      'Fix or remove the stray marker and run again; nothing was written.'
  );
}
