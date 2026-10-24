export function toPosix(p) {
  return p.replace(/\\/g, '/');
}

const escapeChar = (c) => (/[.+^$()|\[\]\\{}*?]/.test(c) ? '\\' + c : c);

/** Convert a glob (`**`, `*`, `?`, `{a,b}`) to an anchored, case-sensitive RegExp. */
export function globToRegExp(glob) {
  let re = '';
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const atStart = i === 0 || glob[i - 1] === '/';
        if (glob[i + 2] === '/' && atStart) {
          re += '(?:.*/)?';
          i += 2;
        } else if (i + 2 >= glob.length && glob[i - 1] === '/') {
          // trailing `/**`: drop the preceding slash into the optional group
          re = re.slice(0, -1) + '(?:/.*)?';
          i += 1;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      depth++;
      re += '(?:';
    } else if (c === '}' && depth > 0) {
      depth--;
      re += ')';
    } else if (c === ',' && depth > 0) {
      re += '|';
    } else {
      re += escapeChar(c);
    }
  }
  re += ')'.repeat(depth);
  return new RegExp(`^${re}$`);
}

export function matchesAny(relPath, globs) {
  let p = toPosix(relPath);
  if (p.startsWith('./')) p = p.slice(2);
  return globs.some((g) => globToRegExp(g).test(p));
}
