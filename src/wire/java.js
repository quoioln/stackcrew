import { upsertMarkedBlock, MD_MARKERS, GRADLE_MARKERS } from '../fs/marked-block.js';

/** Latest 1.x com.tngtech.archunit:archunit-junit5 (verified against Maven Central maven-metadata.xml). */
export const ARCHUNIT_VERSION = '1.5.1';

const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/** Indent of the first line whose trimmed text equals `marker`, or null when absent. */
function markerIndent(text, marker) {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === marker) return line.slice(0, line.length - line.trimStart().length);
  }
  return null;
}

/** Replace every non-newline char in [from, to) with a space, keeping offsets. */
function blank(text, from, to) {
  return text.slice(0, from) + text.slice(from, to).replace(/[^\r\n]/g, ' ') + text.slice(to);
}

function blankAll(text, regex, keep = () => false) {
  let out = text;
  for (const m of text.matchAll(regex)) {
    if (!keep(m[0])) out = blank(out, m.index, m.index + m[0].length);
  }
  return out;
}

// ---------- pom.xml ----------

function pomDependencyLines(indent) {
  const i1 = `${indent}    `;
  return [
    `${indent}<dependency>`,
    `${i1}<groupId>com.tngtech.archunit</groupId>`,
    `${i1}<artifactId>archunit-junit5</artifactId>`,
    `${i1}<version>${ARCHUNIT_VERSION}</version>`,
    `${i1}<scope>test</scope>`,
    `${indent}</dependency>`,
  ];
}

const POM_SNIPPET = pomDependencyLines('').join('\n');

function planPom(text) {
  const eol = eolOf(text);
  const existingIndent = markerIndent(text, MD_MARKERS.begin);
  if (existingIndent !== null) {
    return { content: upsertMarkedBlock(text, pomDependencyLines(existingIndent).join('\n'), MD_MARKERS) };
  }

  let masked = blankAll(text, /<!--[\s\S]*?-->/g, (c) => c.trim() === MD_MARKERS.begin || c.trim() === MD_MARKERS.end);
  for (const tag of ['dependencyManagement', 'build', 'profiles']) {
    masked = blankAll(masked, new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'g'));
  }
  const open = /<dependencies\s*>/.exec(masked);
  const close = open ? /<\/dependencies\s*>/.exec(masked.slice(open.index)) : null;
  if (!open || !close) {
    return {
      note: 'pom.xml: no project-level <dependencies> found; add this inside <project>:\n'
        + `<dependencies>\n${POM_SNIPPET.replace(/^/gm, '    ')}\n</dependencies>`,
    };
  }
  const closeIdx = open.index + close.index;
  const lineStart = text.lastIndexOf('\n', closeIdx - 1) + 1;
  const closeIndent = /^[ \t]*$/.test(text.slice(lineStart, closeIdx)) ? text.slice(lineStart, closeIdx) : '';

  const section = masked.slice(open.index + open[0].length, closeIdx);
  const dep = /<dependency\b/.exec(section);
  let indent = `${closeIndent}    `;
  if (dep) {
    const depAbs = open.index + open[0].length + dep.index;
    const depLineStart = text.lastIndexOf('\n', depAbs - 1) + 1;
    const prefix = text.slice(depLineStart, depAbs);
    if (/^[ \t]*$/.test(prefix)) indent = prefix;
  }

  const block = [indent + MD_MARKERS.begin, ...pomDependencyLines(indent), indent + MD_MARKERS.end].join(eol);
  if (/^[ \t]*$/.test(text.slice(lineStart, closeIdx))) {
    return { content: text.slice(0, lineStart) + block + eol + text.slice(lineStart) };
  }
  return { content: text.slice(0, closeIdx) + eol + block + eol + text.slice(closeIdx) };
}

// ---------- Gradle ----------

function gradleLine(kotlin, indent) {
  const coord = `com.tngtech.archunit:archunit-junit5:${ARCHUNIT_VERSION}`;
  return kotlin ? `${indent}testImplementation("${coord}")` : `${indent}testImplementation '${coord}'`;
}

/** Offset just after the `{` of the first top-level `dependencies {`, or -1. */
function findTopLevelDependencies(text) {
  let depth = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    if (two === '//') {
      while (i < n && text[i] !== '\n') i++;
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      i += q.length;
      while (i < n && !text.startsWith(q, i)) {
        if (text[i] === '\\') i++;
        else if (!triple && text[i] === '\n') break;
        i++;
      }
      i += q.length;
    } else if (c === '{') {
      depth++;
      i++;
    } else if (c === '}') {
      depth--;
      i++;
    } else if (depth === 0 && c === 'd' && !/[\w.$]/.test(text[i - 1] ?? ' ')) {
      const m = /^dependencies\s*\{/.exec(text.slice(i, i + 64));
      if (m) return i + m[0].length;
      i++;
    } else {
      i++;
    }
  }
  return -1;
}

function planGradle(text, file) {
  const kotlin = file.endsWith('.kts');
  const eol = eolOf(text);
  const existingIndent = markerIndent(text, GRADLE_MARKERS.begin);
  if (existingIndent !== null) {
    return { content: upsertMarkedBlock(text, gradleLine(kotlin, existingIndent), GRADLE_MARKERS) };
  }
  const at = findTopLevelDependencies(text);
  if (at === -1) {
    return {
      note: `${file}: no top-level dependencies { } block found; add this to it:\n${gradleLine(kotlin, '    ')}`,
    };
  }
  const indent = '    ';
  const block = [indent + GRADLE_MARKERS.begin, gradleLine(kotlin, indent), indent + GRADLE_MARKERS.end].join(eol);
  const nl = text.indexOf('\n', at);
  const lineEnd = nl === -1 ? text.length : nl;
  if (text.slice(at, lineEnd).trim() === '') {
    const insertAt = nl === -1 ? text.length : nl + 1;
    const lead = nl === -1 ? eol : '';
    return { content: text.slice(0, insertAt) + lead + block + eol + text.slice(insertAt) };
  }
  return { content: text.slice(0, at) + eol + block + eol + text.slice(at) };
}

/**
 * Plan ArchUnit wiring for Maven/Gradle build files. Pure: takes decoded file
 * texts (undefined = file absent) and returns the edits and notes; the caller does I/O.
 * Throws StackcrewError MARKER when an existing marked block is corrupt.
 * @param {{ pomXml?: string, buildGradle?: string, buildGradleKts?: string }} files
 * @returns {{ edits: { path: 'pom.xml'|'build.gradle'|'build.gradle.kts', content: string }[], notes: string[] }}
 */
export function planJavaWiring({ pomXml, buildGradle, buildGradleKts } = {}) {
  const edits = [];
  const notes = [];
  const jobs = [
    ['pom.xml', pomXml, (t) => planPom(t)],
    ['build.gradle', buildGradle, (t) => planGradle(t, 'build.gradle')],
    ['build.gradle.kts', buildGradleKts, (t) => planGradle(t, 'build.gradle.kts')],
  ];
  for (const [file, text, plan] of jobs) {
    if (typeof text !== 'string') continue;
    const r = plan(text);
    if (r.content !== undefined) edits.push({ path: file, content: r.content });
    if (r.note) notes.push(r.note);
  }
  return { edits, notes };
}
