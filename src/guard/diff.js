/** Parse `git diff --unified=0` output into added lines per file (new-side, 1-based line numbers). */

function unquotePath(raw) {
  let p = raw;
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) {
    p = p.slice(1, -1).replace(/\\([\\"])/g, '$1');
  } else {
    p = p.replace(/\t.*$/, '');
  }
  return p;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * @param {string} text
 * @returns {import('../types.js').DiffFile[]}
 */
export function parseUnifiedDiff(text) {
  const files = [];
  let current = null; // { file, lines }, or null when the current file is skipped
  let oldLeft = 0;
  let newLeft = 0;
  let counter = 0;

  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    // Inside a hunk the header counts decide what is content, so an added line
    // whose text starts with "++ " is never mistaken for a "+++ " file header.
    if (oldLeft > 0 || newLeft > 0) {
      const c = line[0];
      if (c === '+') {
        if (current) current.lines.push({ line: counter, text: line.slice(1) });
        counter++;
        newLeft--;
        continue;
      }
      if (c === '-') {
        oldLeft--;
        continue;
      }
      if (c === ' ') {
        counter++;
        oldLeft--;
        newLeft--;
        continue;
      }
      if (c === '\\') continue;
      oldLeft = 0;
      newLeft = 0;
    }

    if (line.startsWith('diff --git ')) {
      current = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = unquotePath(line.slice(4));
      if (target === '/dev/null') {
        current = null;
      } else {
        current = { file: target.replace(/^b\//, ''), lines: [] };
        files.push(current);
      }
      continue;
    }
    const m = HUNK_RE.exec(line);
    if (m) {
      oldLeft = m[2] === undefined ? 1 : Number(m[2]);
      newLeft = m[4] === undefined ? 1 : Number(m[4]);
      counter = Number(m[3]);
    }
  }
  return files.filter((f) => f.lines.length > 0);
}
