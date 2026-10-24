import { stringifyFrontmatter } from '../util/frontmatter.js';
import { withNotice } from './notice.js';

// Codex only reads skills from .agents/skills, so skillDirs is deliberately not consulted.
const SKILLS_DIR = '.agents/skills';
const AGENTS_DIR = '.codex/agents';

const BS = String.fromCharCode(92);
const NAMED = new Map([
  [92, BS + BS],
  [34, BS + '"'],
  [10, BS + 'n'],
  [9, BS + 't'],
  [13, BS + 'r'],
]);

function basicString(s) {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (NAMED.has(code)) out += NAMED.get(code);
    else if (code < 32 || code === 127) out += BS + 'u' + code.toString(16).padStart(4, '0');
    else out += ch;
  }
  return '"' + out + '"';
}

function multiline(body) {
  const text = body.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)).trimEnd();
  const LF = String.fromCharCode(10);
  if (!text.includes("'''")) return "'''" + LF + text + LF + "'''";
  let out = '';
  for (const ch of text) out += ch === BS || ch === '"' ? BS + ch : ch;
  return '"""' + LF + out + LF + '"""';
}

/** @param {import('../types.js').RenderedRole} role @returns {string} */
export function toTomlAgent(role) {
  return (
    `name = ${basicString(role.name)}\n` +
    `description = ${basicString(role.description)}\n` +
    `developer_instructions = ${multiline(role.body)}\n`
  );
}

/** @param {import('../types.js').RenderContext} ctx @returns {import('../types.js').FileOp[]} */
export function renderCodex(ctx) {
  if (!ctx.profile.tools.includes('codex')) return [];
  const { stackName, stackId } = ctx.vars;
  const name = `stackcrew-${stackId}-rules`;
  const base = `${SKILLS_DIR}/${name}`;

  const fm = stringifyFrontmatter([
    ['name', name],
    [
      'description',
      `Use when writing, editing or reviewing ${stackName} code in this repository to load the full stackcrew rules for ${stackName}.`,
    ],
  ]);
  const links = ctx.rules.map((r) => `- [${r.title}](rules/${r.id}.md)`).join('\n');
  const ops = [
    { path: `${base}/SKILL.md`, kind: 'owned', content: withNotice(fm, `# ${stackName} rules (stackcrew)\n\n${links}\n`) },
  ];
  for (const rule of ctx.rules) ops.push({ path: `${base}/rules/${rule.id}.md`, kind: 'owned', content: rule.body });

  for (const role of ctx.roles) {
    ops.push({ path: `${AGENTS_DIR}/${role.name}.toml`, kind: 'owned', content: toTomlAgent(role) });
  }
  return ops;
}
