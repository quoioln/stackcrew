import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/load.js';
import { createProfile } from '../src/profile.js';
import { buildContext } from '../src/render/context.js';
import { miniCtx } from '../test-helpers/render-ctx.js';
import { parseFrontmatter } from '../src/util/frontmatter.js';
import { GENERATED_NOTICE } from '../src/render/notice.js';
import { AGENTS_BLOCK_BUDGET, renderAgentsMdBlock, topEssentials } from '../src/render/agents-md.js';
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
    assert.ok(both.content.includes(`### ${r.title} — essentials\n\n${topEssentials(r.essentials)}`));
  }
  assert.ok(both.content.includes(`Full rules: use the skill \`stackcrew-${ctx.vars.stackId}-rules\`.\n`));
});

test('throws BUDGET when block exceeds 16000 bytes', async () => {
  // only the first 5 bullets are kept per rule, so inflate a single bullet past the budget
  const ctx = withRule(await miniCtx(['codex']), { essentials: `- ${'x'.repeat(17000)}\n` });
  assert.throws(
    () => renderAgentsMdBlock(ctx),
    (e) => e.code === 'BUDGET' && /\d+ bytes/.test(e.message) && e.message.includes('16000-byte') && e.message.includes(ctx.rules[0].title),
  );
  assert.equal(AGENTS_BLOCK_BUDGET, 16000);
});

test('codex essentials: a rule with 8 bullets contributes exactly the first 5', async () => {
  const essentials = Array.from({ length: 8 }, (_, i) => `- bullet ${i + 1}`).join('\n');
  const ctx = withRule(await miniCtx(['codex']), { essentials });
  const { content } = renderAgentsMdBlock(ctx);
  const head = `### ${ctx.rules[0].title} — essentials\n\n`;
  assert.ok(content.includes(`${head}- bullet 1\n- bullet 2\n- bullet 3\n- bullet 4\n- bullet 5\n`));
  assert.ok(!content.includes('- bullet 6'));
});

test('topEssentials: <=5 bullets unchanged, paragraph before first bullet dropped', () => {
  assert.equal(topEssentials('- a\n- b\n- c'), '- a\n- b\n- c');
  assert.equal(topEssentials('Intro paragraph.\n\n- a\n* b'), '- a\n* b');
  assert.equal(topEssentials('no bullets here'), '');
});

test('topEssentials: nested and continuation lines stay with their bullet', () => {
  const src = [
    '- one', '  - nested one', '    deeper text', '- two', 'lazy continuation', '- three', '',
    '  indented after blank', '- four', '- five', '  - nested five', '- six', '  - nested six',
  ].join('\n');
  const want = [
    '- one', '  - nested one', '    deeper text', '- two', 'lazy continuation', '- three', '',
    '  indented after blank', '- four', '- five', '  - nested five',
  ].join('\n');
  assert.equal(topEssentials(src), want);
  assert.equal(topEssentials('- a\n- b\n- c', 2), '- a\n- b');
});

test('topEssentials: blank line then non-indented text ends the bullet', () => {
  assert.equal(topEssentials('- a\n  cont\n\nstray paragraph\n- b'), '- a\n  cont\n- b');
});

test('real catalog core rules + codex fit the budget', async (t) => {
  const saved = process.env.STACKCREW_CATALOG_DIR;
  delete process.env.STACKCREW_CATALOG_DIR;
  let ctx;
  try {
    const real = await loadCatalog();
    const miniDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'catalog-mini');
    const mini = await loadCatalog(miniDir);
    const stackId = [...real.stacks.keys()][0];
    const catalog = stackId ? real : { ...mini, coreRules: real.coreRules, alwaysOn: real.alwaysOn };
    const profile = createProfile(
      { stack: stackId ?? 'demo-java', addons: [], tools: ['codex'], mode: 'greenfield', basePackage: 'com.acme' },
      catalog,
    );
    ctx = buildContext(catalog, profile, { cli: 'npx --yes stackcrew@0.0.0-test', version: '0.0.0-test' });
  } finally {
    if (saved === undefined) delete process.env.STACKCREW_CATALOG_DIR;
    else process.env.STACKCREW_CATALOG_DIR = saved;
  }
  const size = Buffer.byteLength(renderAgentsMdBlock(ctx).content, 'utf8');
  t.diagnostic(`real-catalog AGENTS block: ${size} bytes`);
  assert.ok(size <= 16000);
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
