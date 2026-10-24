import readline from 'node:readline/promises';
import { parseCommandArgs, splitList } from './args.js';
import { runSync } from './run-sync.js';
import { loadCatalog } from '../catalog/load.js';
import { detectProject } from '../detect.js';
import { readProfile, writeProfile, createProfile, validateProfile, PROFILE_FILE, TOOLS } from '../profile.js';

const USAGE = 'stackcrew init [--stack <id>] [--addons a,b] [--tools t,...] [--wire] [--force] [--no-guard]';

function resolveStack(catalog, input) {
  const wanted = input.toLowerCase();
  for (const s of catalog.stacks.values()) {
    if (s.id.toLowerCase() === wanted || s.aliases.some((a) => a.toLowerCase() === wanted)) return s;
  }
  return null;
}

/** Numbered stack picker, TTY only. Returns a stack id, or null on invalid input. */
async function promptForStack(catalog, io) {
  const ids = [...catalog.stacks.keys()].sort();
  ids.forEach((id, i) => io.stdout.write(`  ${i + 1}) ${id}  ${catalog.stacks.get(id).name}\n`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Select a stack number: ');
    return ids[Number.parseInt(answer, 10) - 1] ?? null;
  } finally {
    rl.close();
  }
}

export async function initCommand(args, io) {
  const { values } = parseCommandArgs(args, {
    stack: { type: 'string' },
    addons: { type: 'string' },
    tools: { type: 'string' },
    wire: { type: 'boolean' },
    force: { type: 'boolean' },
    'no-guard': { type: 'boolean' },
  }, USAGE);

  const existing = await readProfile(io.cwd);
  if (existing && !values.force) {
    io.stderr.write(`stackcrew: already initialized (${PROFILE_FILE} exists); use \`stackcrew sync\`\n`);
    return 1;
  }

  const catalog = await loadCatalog();
  const available = [...catalog.stacks.keys()].sort();
  const detected = await detectProject(io.cwd, catalog);

  let stack;
  if (values.stack !== undefined) {
    stack = resolveStack(catalog, values.stack);
    if (!stack) {
      io.stderr.write(`stackcrew: unknown stack "${values.stack}". Available: ${available.join(', ')}\n`);
      return 1;
    }
  } else if (detected.stack) {
    stack = catalog.stacks.get(detected.stack);
  } else if (io.isTTY) {
    const id = await promptForStack(catalog, io);
    if (!id) {
      io.stderr.write('stackcrew: no stack selected\n');
      return 1;
    }
    stack = catalog.stacks.get(id);
  } else {
    io.stderr.write(`stackcrew: no stack detected; pass --stack <id>. Available: ${available.join(', ')}\n`);
    return 1;
  }

  const addons = values.addons !== undefined ? splitList(values.addons) : detected.addons;
  const tools = values.tools !== undefined ? splitList(values.tools) : TOOLS;
  const profile = createProfile({
    stack: stack.id,
    addons,
    tools,
    mode: detected.mode,
    guard: !values['no-guard'],
    basePackage: stack.language === 'java' ? detected.basePackage : null,
  }, catalog);

  if (existing) {
    if (existing.decisions) profile.decisions = existing.decisions;
    if (existing.context) profile.context = existing.context;
    if (profile.java && existing.java) {
      if (typeof existing.java.basePackage === 'string') profile.java.basePackage = existing.java.basePackage;
      if (existing.java.wired === true) profile.java.wired = true;
    }
    io.stdout.write('overwriting existing stackcrew.json (kept: decisions, context, java settings)\n');
  }

  const errors = validateProfile(profile, catalog);
  if (errors.length > 0) {
    for (const e of errors) io.stderr.write(`stackcrew: ${e}\n`);
    return 1;
  }
  await writeProfile(io.cwd, profile);

  const code = await runSync(io.cwd, { force: false, wire: values.wire, dryRun: false }, io);
  if (code === 0) {
    if (tools.includes('claude')) io.stdout.write('next: with the stackcrew Claude Code plugin installed, run /stackcrew:init for the architecture interview (without the plugin, Claude Code has no interview skill; see README)\n');
    if (tools.some((t) => t !== 'claude')) io.stdout.write('next: ask your agent to use the skill stackcrew-init\n');
  }
  return code;
}
