import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { StackcrewError } from '../errors.js';
import { stringifyFrontmatter } from '../util/frontmatter.js';
import { fillTemplate } from '../util/template.js';
import { toLf } from '../util/hash.js';

const DESCRIPTION = 'Coding rules, per-stack skills and dev/test roles for AI agents, with a write-time guard hook (stackcrew).';
const CLI = 'node "${CLAUDE_PLUGIN_ROOT}/cli/bin/stackcrew.js"';
const COPY_DIRS = ['bin', 'src', 'catalog'];

const json = (obj) => JSON.stringify(obj, null, 2) + '\n';
const isMissing = (e) => e && (e.code === 'ENOENT' || e.code === 'ENOTDIR');

/** outRoot must be this package's root (package.json name "stackcrew") or an empty / new directory. */
async function assertSafeOutRoot(outRoot) {
  let entries;
  try {
    entries = await readdir(outRoot);
  } catch (e) {
    if (isMissing(e)) return;
    throw e;
  }
  if (entries.length === 0) return;
  let name;
  try {
    name = JSON.parse(await readFile(path.join(outRoot, 'package.json'), 'utf8')).name;
  } catch {
    name = undefined;
  }
  if (name !== 'stackcrew') {
    throw new StackcrewError(
      'RENDER',
      `Refusing to build the plugin into ${outRoot}: not the stackcrew package root (no package.json with name "stackcrew"). Run this command from a stackcrew checkout.`,
    );
  }
}

/** Files under `root` recursively as POSIX relative paths, sorted; skips *.test.js. */
async function listFiles(root) {
  const out = [];
  async function walk(sub) {
    const entries = await readdir(path.join(root, sub), { withFileTypes: true });
    for (const e of entries) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(rel);
      else if (e.isFile() && !e.name.endsWith('.test.js')) out.push(rel);
    }
  }
  await walk('');
  return out.sort();
}

function commandSkill(name, description, body, vars) {
  const fm = stringifyFrontmatter([
    ['name', name],
    ['description', description],
    ['disable-model-invocation', true],
  ]);
  return fm + fillTemplate(body, vars);
}

/**
 * Build the Claude Code plugin + marketplace files under `outRoot`.
 * Deletes `<outRoot>/plugin/` first; never touches anything else except
 * `<outRoot>/.claude-plugin/marketplace.json`.
 * @returns {Promise<string[]>} relative POSIX paths written
 */
export async function buildPlugin({ pkgRoot, outRoot, version, catalog }) {
  await assertSafeOutRoot(outRoot);
  const written = [];
  const put = async (rel, content) => {
    const file = path.join(outRoot, ...rel.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, toLf(content), 'utf8');
    written.push(rel);
  };

  await rm(path.join(outRoot, 'plugin'), { recursive: true, force: true });

  await put(
    '.claude-plugin/marketplace.json',
    json({
      name: 'stackcrew',
      owner: { name: 'stackcrew' },
      plugins: [{ name: 'stackcrew', source: './plugin', description: DESCRIPTION, version }],
    }),
  );
  await put(
    'plugin/.claude-plugin/plugin.json',
    json({
      name: 'stackcrew',
      description: DESCRIPTION,
      version,
      license: 'MIT',
      keywords: ['rules', 'skills', 'design-patterns', 'spring-boot', 'guard'],
    }),
  );
  await put(
    'plugin/hooks/hooks.json',
    json({
      description: 'stackcrew guard: block forbidden constructs in newly written lines',
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit|Write|MultiEdit',
            hooks: [
              { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/cli/src/guard/hook.js'], timeout: 10 },
            ],
          },
        ],
      },
    }),
  );

  const vars = { cli: CLI, version };
  const init = catalog.sharedSkills.find((s) => s.kind === 'command' && s.name === 'stackcrew-init');
  if (init) {
    await put('plugin/skills/init/SKILL.md', commandSkill('init', init.description, init.body, vars));
    for (const f of init.files) await put(`plugin/skills/init/${f.relPath}`, fillTemplate(f.content, vars));
  }
  for (const cmd of catalog.pluginCommands) {
    await put(`plugin/skills/${cmd.name}/SKILL.md`, commandSkill(cmd.name, cmd.description, cmd.body, vars));
  }

  for (const dir of COPY_DIRS) {
    let files;
    try {
      files = await listFiles(path.join(pkgRoot, dir));
    } catch (e) {
      if (isMissing(e)) continue;
      throw e;
    }
    for (const rel of files) {
      await put(`plugin/cli/${dir}/${rel}`, await readFile(path.join(pkgRoot, dir, ...rel.split('/')), 'utf8'));
    }
  }
  await put(
    'plugin/cli/package.json',
    json({ name: 'stackcrew', version, type: 'module', bin: { stackcrew: 'bin/stackcrew.js' } }),
  );
  return written;
}
