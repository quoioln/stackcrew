import test from 'node:test';
import assert from 'node:assert/strict';
import { miniCtx } from '../test-helpers/render-ctx.js';
import { parseFrontmatter } from '../src/util/frontmatter.js';
import { GENERATED_NOTICE } from '../src/render/notice.js';
import { lintSkillDescription } from '../src/catalog/validate.js';
import { renderCodex, toTomlAgent } from '../src/render/codex.js';

const skillOf = async () => {
  const ctx = await miniCtx(['codex']);
  const name = `stackcrew-${ctx.vars.stackId}-rules`;
  const ops = renderCodex(ctx);
  return { ctx, name, ops, skill: ops.find((o) => o.path === `.agents/skills/${name}/SKILL.md`) };
};

test('rules skill lists every rule and ships each as a file', async () => {
  const { ctx, name, ops, skill } = await skillOf();
  const { data, body } = parseFrontmatter(skill.content);
  assert.equal(data.name, name);
  assert.ok(body.includes(GENERATED_NOTICE));
  assert.ok(body.includes(`# ${ctx.vars.stackName} rules (stackcrew)`));
  for (const r of ctx.rules) {
    assert.ok(body.includes(`- [${r.title}](rules/${r.id}.md)`));
    const f = ops.find((o) => o.path === `.agents/skills/${name}/rules/${r.id}.md`);
    assert.equal(f.kind, 'owned');
    assert.equal(f.content, r.body);
  }
  assert.deepEqual(renderCodex(await miniCtx(['claude'])), []);
});

test('rules skill description passes lintSkillDescription', async () => {
  const { ctx, skill } = await skillOf();
  const { data } = parseFrontmatter(skill.content);
  assert.equal(
    data.description,
    `Use when writing, editing or reviewing ${ctx.vars.stackName} code in this repository to load the full stackcrew rules for ${ctx.vars.stackName}.`,
  );
  assert.deepEqual(lintSkillDescription({ name: data.name, description: data.description, kind: 'rules', source: 'x' }, ctx.vars.stackName), []);
});

test('codex agents are toml files', async () => {
  const { ctx, ops } = await skillOf();
  const role = ctx.roles[0];
  const op = ops.find((o) => o.path === `.codex/agents/${role.name}.toml`);
  assert.equal(op.content, toTomlAgent(role));
});

const BS = String.fromCharCode(92);
const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const Q3 = '"'.repeat(3);

test('toml escapes quotes and handles triple quotes in body', () => {
  const desc = 'say "hi"' + BS + LF + TAB + 'x' + String.fromCharCode(1);
  const plain = toTomlAgent({ name: 'a', description: desc, model: 'm', body: 'it' + "'" + 's "fine"' + BS + 'n', skills: [] });
  const wantDesc = 'say ' + BS + '"hi' + BS + '"' + BS + BS + BS + 'n' + BS + 't' + 'x' + BS + 'u0001';
  assert.equal(
    plain.split(LF)[1],
    'description = "' + wantDesc + '"',
  );
  assert.ok(plain.startsWith('name = "a"' + LF));
  assert.ok(plain.includes("developer_instructions = '''" + LF));
  assert.ok(plain.endsWith("'''" + LF));

  const body = "has ''' and " + Q3 + ' and ' + BS;
  const tri = toTomlAgent({ name: 'a', description: 'd', model: 'm', body, skills: [] });
  assert.ok(tri.includes('developer_instructions = ' + Q3 + LF));
  const esc = ('has ' + "'''" + ' and ' + (BS + '"').repeat(3) + ' and ' + BS + BS);
  assert.ok(tri.includes(esc));
  assert.ok(tri.endsWith(Q3 + LF));
});
