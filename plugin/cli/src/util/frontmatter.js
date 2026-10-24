import { StackcrewError } from '../errors.js';

function unquote(s) {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return unquote(s);
}

function splitFlow(inner) {
  const items = [];
  let cur = '';
  let quote = null;
  for (const c of inner) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ',') {
      items.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim() !== '') items.push(cur);
  return items.map((x) => unquote(x.trim()));
}

/** Parse a minimal YAML-subset frontmatter block. */
export function parseFrontmatter(text) {
  const src = text.replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) return { data: {}, body: text };
  const lines = src.slice(4).split('\n');
  const end = lines.indexOf('---');
  if (end === -1) throw new StackcrewError('FRONTMATTER', 'Unterminated frontmatter block (missing closing ---)');
  const data = {};
  let listKey = null;
  for (const line of lines.slice(0, end)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(unquote(item[1].trim()));
      continue;
    }
    const kv = /^([^\s:][^:]*?):(?:\s+(.*)|\s*)$/.exec(line);
    if (!kv) throw new StackcrewError('FRONTMATTER', `Cannot parse frontmatter line: ${line}`);
    const [, key, value] = kv;
    listKey = null;
    if (value === undefined || value.trim() === '') {
      data[key] = [];
      listKey = key;
    } else if (value.trim().startsWith('[') && value.trim().endsWith(']')) {
      data[key] = splitFlow(value.trim().slice(1, -1));
    } else {
      data[key] = parseScalar(value);
    }
  }
  return { data, body: lines.slice(end + 1).join('\n') };
}

function quoted(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function scalar(v) {
  if (typeof v === 'boolean') return String(v);
  const s = String(v);
  if (s === '' || /[:#*{}\[\],&!|>'"%@\\]/.test(s) || s !== s.trim()) return quoted(s);
  return s;
}

/** Serialize ordered entries to a frontmatter block (`---\n...\n---\n`). */
export function stringifyFrontmatter(entries) {
  const out = ['---'];
  for (const [key, value] of entries) {
    if (Array.isArray(value)) {
      out.push(`${key}:`);
      for (const item of value) out.push(`  - ${quoted(String(item))}`);
    } else {
      out.push(`${key}: ${scalar(value)}`);
    }
  }
  out.push('---');
  return out.join('\n') + '\n';
}
