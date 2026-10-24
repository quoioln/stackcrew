import test from 'node:test';
import assert from 'node:assert/strict';
import { miniCtx } from '../test-helpers/render-ctx.js';
import { parseFrontmatter } from '../src/util/frontmatter.js';
import { GENERATED_NOTICE } from '../src/render/notice.js';
import { renderAntigravity } from '../src/render/antigravity.js';

test('rule frontmatter has trigger glob and quoted globs', async () => {
  const ctx = await miniCtx(['antigravity']);
  const op = renderAntigravity(ctx).find((o) => o.path === `.agents/rules/stackcrew-${ctx.stack.rules.id}.md`);
  assert.equal(op.kind, 'owned');
  assert.ok(op.content.includes('globs: "**/*.java"'));
  const { data, body } = parseFrontmatter(op.content);
  assert.equal(data.trigger, 'glob');
  assert.equal(data.globs, '**/*.java');
  assert.ok(!('description' in data));
  assert.ok(body.includes(GENERATED_NOTICE));
});

test('rule files are flat under .agents/rules', async () => {
  const ctx = await miniCtx(['antigravity']);
  const rules = renderAntigravity(ctx).filter((o) => o.path.startsWith('.agents/rules/'));
  assert.equal(rules.length, ctx.rules.length);
  for (const o of rules) assert.match(o.path, /^\.agents\/rules\/stackcrew-[^/]+\.md$/);
  assert.deepEqual(renderAntigravity(await miniCtx(['claude'])), []);
});

test('antigravity agents have model inherit and optional skills', async () => {
  const ctx = await miniCtx(['antigravity']);
  const role = ctx.roles.find((r) => r.skills.length > 0);
  const op = renderAntigravity(ctx).find((o) => o.path === `.agents/agents/${role.name}.md`);
  const { data, body } = parseFrontmatter(op.content);
  assert.equal(data.name, role.name);
  assert.equal(data.description, role.description);
  assert.equal(data.model, 'inherit');
  assert.deepEqual(data.skills, role.skills);
  assert.equal(body.trim(), role.body.trim());
  assert.ok(!op.content.includes(GENERATED_NOTICE));

  const bare = { ...ctx, roles: [{ ...role, skills: [] }] };
  const op2 = renderAntigravity(bare).find((o) => o.path.startsWith('.agents/agents/'));
  assert.ok(!op2.content.includes('skills'));
});

test('throws BUDGET over 24000 bytes', async () => {
  const ctx = await miniCtx(['antigravity']);
  const big = { ...ctx, rules: ctx.rules.map((r, i) => (i === 0 ? { ...r, body: 'x'.repeat(25000) } : r)) };
  assert.throws(() => renderAntigravity(big), (e) => e.code === 'BUDGET');
});
