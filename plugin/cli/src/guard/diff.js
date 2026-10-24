/** Parse `git diff --unified=0` output into added lines per file (new-side, 1-based line numbers). */

const SIMPLE_ESC = { t: 9, n: 10, r: 13, a: 7, b: 8, f: 12, v: 11, '\\': 92, '"': 34 };

/** Decode a git C-style quoted path body: \ \" \t \n and \NNN octal bytes, then UTF-8 decode. */
function decodeQuoted(body) {
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = body[i + 1];
    if (next !== undefined && next >= '0' && next <= '7') {
      let j = i + 1;
      let oct = '';
      while (j < body.length && oct.length < 3 && body[j] >= '0' && body[j] <= '7') oct += body[j++];
      bytes.push(parseInt(oct, 8) & 0xff);
      i = j - 1;
    } else if (next !== undefined && Object.hasOwn(SIMPLE_ESC, next)) {
      bytes.push(SIMPLE_ESC[next]);
      i++;
    } else {
      bytes.push(92);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function unquotePath(raw) {
  // git appends a TAB after the path when it contains spaces; a real TAB is never inside quotes (it is \t).
  const p = raw.replace(/\t.*$/, '');
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) return decodeQuoted(p.slice(1, -1));
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
