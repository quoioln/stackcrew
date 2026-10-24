import test from 'node:test';
import assert from 'node:assert/strict';
import { miniCtx } from '../test-helpers/render-ctx.js';
import { parseFrontmatter } from '../src/util/frontmatter.js';
import { GENERATED_NOTICE } from '../src/render/notice.js';
import { AGENTS_BLOCK_BUDGET, renderAgentsMdBlock } from '../src/render/agents-md.js';
import { renderCursor } from '../src/render/cursor.js';

const withRule = (ctx, patch) => ({
  ...ctx,
  rules: ctx.rules.map((r, i) => (i === 0 ? { ...r, ...patch } : r)),
});

test('null when only claude', async () => {
  assert.equal(renderAgentsMdBlock(await miniCtx(['claude'])), null);
});

test('essentials included only when codex selected', async () => {
  const cursorOnly = renderAgentsMdBlock(await miniCtx(['cursor']));
  assert.equal(cursorOnly.path, 'AGENTS.md');
  assert.equal(cursorOnly.kind, 'block');
  assert.ok(cursorOnly.content.startsWith('## stackcrew rules\n\n' + GENERATED_NOTICE + '\n\n'));
  assert.ok(cursorOnly.content.endsWith('\n'));
  assert.ok(!cursorOnly.content.includes('— essentials'));
  assert.ok(!cursorOnly.content.includes('Full rules:'));

  const ctx = await miniCtx(['cursor', 'codex']);
  const both = renderAgentsMdBlock(ctx);
  for (const r of ctx.rules.filter((x) => x.essentials.trim())) {
    assert.ok(both.content.includes(`### ${r.title} — essentials\n\n${r.essentials}`));
  }
  assert.ok(both.content.includes(`Full rules: use the skill \`stackcrew-${ctx.vars.stackId}-rules\`.\n`));
});

test('throws BUDGET when block exceeds 12000 bytes', async () => {
  const ctx = withRule(await miniCtx(['codex']), { essentials: '- x\n'.repeat(5000) });
  assert.throws(
    () => renderAgentsMdBlock(ctx),
    (e) => e.code === 'BUDGET' && /\d+ bytes/.test(e.message) && e.message.includes(ctx.rules[0].title),
  );
  assert.equal(AGENTS_BLOCK_BUDGET, 12000);
});

test('cursor rule frontmatter', async () => {
  const ctx = await miniCtx(['cursor']);
  const ops = renderCursor(ctx);
  const op = ops.find((o) => o.path === `.cursor/rules/stackcrew/${ctx.stack.rules.id}.mdc`);
  assert.equal(op.kind, 'owned');
  const { data, body } = parseFrontmatter(op.content);
  assert.equal(data.globs, '**/*.java');
  assert.equal(data.alwaysApply, false);
  assert.equal(data.description, ctx.stack.rules.title);
  assert.ok(op.content.includes('globs: "**/*.java"'));
  assert.ok(body.includes(GENERATED_NOTICE));
});

test('cursor throws BUDGET over 500 lines', async () => {
  const ctx = withRule(await miniCtx(['cursor']), { body: 'line\n'.repeat(600) });
  assert.throws(() => renderCursor(ctx), (e) => e.code === 'BUDGET');
});

test('cursor empty without cursor', async () => {
  assert.deepEqual(renderCursor(await miniCtx(['claude'])), []);
});

test('cursor agents only without claude', async () => {
  const solo = await miniCtx(['cursor']);
  const agents = renderCursor(solo).filter((o) => o.path.startsWith('.cursor/agents/'));
  assert.equal(agents.length, solo.roles.length);
  const role = solo.roles[0];
  const op = agents.find((o) => o.path === `.cursor/agents/${role.name}.md`);
  const { data, body } = parseFrontmatter(op.content);
  assert.equal(data.name, role.name);
  assert.equal(data.description, role.description);
  assert.equal(body.trim(), role.body.trim());
  assert.ok(!op.content.includes(GENERATED_NOTICE));

  const both = await miniCtx(['cursor', 'claude']);
  assert.equal(renderCursor(both).filter((o) => o.path.startsWith('.cursor/agents/')).length, 0);
});
