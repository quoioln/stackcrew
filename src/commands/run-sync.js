import { loadCatalog } from '../catalog/load.js';
import { validateCatalog } from '../catalog/validate.js';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readProfile, writeProfile, validateProfile, PROFILE_FILE } from '../profile.js';
import { detectProject } from '../detect.js';
import { planJavaWiring, ARCHUNIT_VERSION } from '../wire/java.js';
import { planNodeWiring, FLAT_CONFIG_FILES, LEGACY_CONFIG_FILES } from '../wire/node.js';
import { readUtf8File } from '../fs/read-utf8.js';
import { buildContext, loadCustomRules } from '../render/context.js';
import { renderProject } from '../render/index.js';
import { applyOps } from '../fs/apply.js';
import { MD_MARKERS } from '../fs/marked-block.js';
import { readPackageVersion } from '../paths.js';

/** Render the profile and apply it to the project. Returns the process exit code. */
export async function runSync(projectDir, { force = false, wire = false, dryRun = false } = {}, io) {
  const catalog = await loadCatalog();
  const catalogErrors = validateCatalog(catalog);
  if (catalogErrors.length > 0) {
    for (const e of catalogErrors) io.stderr.write(`catalog error: ${e}\n`);
    return 1;
  }

  const profile = await readProfile(projectDir);
  if (!profile) {
    io.stderr.write('stackcrew: no stackcrew.json found; run `stackcrew init` first\n');
    return 1;
  }
  const profileErrors = validateProfile(profile, catalog);
  if (profileErrors.length > 0) {
    for (const e of profileErrors) io.stderr.write(`${PROFILE_FILE}: ${e}\n`);
    return 1;
  }

  let renderProfile = profile;
  let wiring = null;
  if (wire) {
    wiring = await planWire(projectDir, catalog, profile, io);
    if (typeof wiring === 'number') return wiring;
    if (wiring.ok) {
      renderProfile = wiring.profile;
    } else {
      io.stdout.write(wiring.failHeader);
      for (const n of wiring.notes) io.stdout.write(`${n}\n`);
    }
  }

  const version = await readPackageVersion();
  const customRules = await loadCustomRules(projectDir);
  const ctx = buildContext(catalog, renderProfile, { customRules, cli: `npx --yes stackcrew@${version}`, version });
  const { ops, warnings } = renderProject(ctx);
  warnings.push(...(await claudeShadowsAgentsWarning(projectDir, renderProfile)));

  if (wiring?.ok) {
    // Validate render + apply (paths, markers, budgets) in memory first, so a failure
    // leaves the build files and the profile untouched.
    if (!dryRun) await applyOps(projectDir, ops, { force, dryRun: true });
    if (!dryRun) {
      for (const e of wiring.changed) await writeFile(path.join(projectDir, e.path), e.content, 'utf8');
      await writeProfile(projectDir, renderProfile);
    }
    for (const e of wiring.changed) io.stdout.write(`${dryRun ? 'would wire' : 'wired'}: ${e.path}\n`);
    for (const n of wiring.notes) io.stdout.write(`note: ${n}\n`);
  }
  const report = await applyOps(projectDir, ops, { force, dryRun });

  const blocksChanged = report.blocks.length - (report.blocksUnchanged?.length ?? 0);
  io.stdout.write(
    `stackcrew sync: ${report.written.length} written, ${report.unchanged.length} unchanged, `
      + `${report.deleted.length} deleted, ${blocksChanged} block(s) updated\n`,
  );
  for (const w of warnings) io.stdout.write(`warning: ${w}\n`);
  if (report.skippedModified.length > 0) {
    for (const p of report.skippedModified) io.stdout.write(`skipped (edited by hand): ${p}\n`);
    io.stdout.write('re-run with --force (your edits will be lost) or move them to .stackcrew/custom/\n');
  }
  if (ctx.stack.language === 'java' && renderProfile.java?.wired !== true) {
    io.stdout.write('hint: run `stackcrew sync --wire` to add ArchUnit (test scope) and generate StackcrewArchitectureTest\n');
  }
  if (ctx.stack.language === 'typescript' && renderProfile.node?.wired !== true) {
    io.stdout.write('hint: run `stackcrew sync --wire` to add the stackcrew rules to your ESLint config\n');
  }
  if (wiring?.ok && ctx.stack.language === 'java') {
    io.stdout.write(
      'note: .stackcrew/lint/checkstyle.xml is generated but not wired; '
        + 'add maven-checkstyle-plugin (or the Gradle checkstyle plugin) pointing at it.\n',
    );
  }
  return report.skippedModified.length > 0 || (wiring && !wiring.ok) ? 1 : 0;
}

const BUILD_FILES = [
  ['pom.xml', 'pomXml'],
  ['build.gradle', 'buildGradle'],
  ['build.gradle.kts', 'buildGradleKts'],
];

/** Plan --wire without writing. Returns an exit code (number) on failure. */
async function planWire(projectDir, catalog, profile, io) {
  const language = catalog.stacks.get(profile.stack)?.language;
  if (language === 'typescript') return planNodeWire(projectDir, profile);
  if (language !== 'java') {
    io.stderr.write('--wire: only supported for Java and TypeScript stacks\n');
    return 1;
  }
  return planJavaWire(projectDir, catalog, profile, io);
}

async function planNodeWire(projectDir, profile) {
  const originals = { 'package.json': await readUtf8File(projectDir, 'package.json') };
  const configs = {};
  for (const rel of [...FLAT_CONFIG_FILES, ...LEGACY_CONFIG_FILES]) {
    const text = await readUtf8File(projectDir, rel);
    if (text === undefined) continue;
    originals[rel] = text;
    configs[rel] = text;
  }
  const plan = planNodeWiring({ packageJson: originals['package.json'], configs });
  return {
    changed: plan.edits.filter((e) => e.content !== originals[e.path]),
    notes: plan.notes,
    ok: plan.wired.length > 0,
    failHeader: 'wire: ESLint could not be wired automatically; add this to your ESLint config and re-run `stackcrew sync --wire`:\n',
    profile: { ...profile, node: { wired: true } },
  };
}

async function planJavaWire(projectDir, catalog, profile, io) {
  let basePackage = profile.java?.basePackage || '';
  if (!basePackage) basePackage = (await detectProject(projectDir, catalog)).basePackage || '';
  if (!basePackage) {
    io.stderr.write('stackcrew: set java.basePackage in stackcrew.json\n');
    return 1;
  }
  const originals = {};
  for (const [rel] of BUILD_FILES) originals[rel] = await readUtf8File(projectDir, rel);
  const input = {};
  for (const [rel, key] of BUILD_FILES) if (originals[rel] !== undefined) input[key] = originals[rel];
  const plan = planJavaWiring(input);
  const notes = [...plan.notes];
  if (Object.keys(input).length === 0) {
    notes.push(
      'no pom.xml or build.gradle(.kts) found; add one of:\n'
        + `Maven:  <dependency><groupId>com.tngtech.archunit</groupId><artifactId>archunit-junit5</artifactId><version>${ARCHUNIT_VERSION}</version><scope>test</scope></dependency>\n`
        + `Gradle: testImplementation 'com.tngtech.archunit:archunit-junit5:${ARCHUNIT_VERSION}'`,
    );
  }
  return {
    changed: plan.edits.filter((e) => e.content !== originals[e.path]),
    notes,
    ok: plan.wired.length > 0,
    failHeader: 'wire: no build file could be wired; add this test dependency and re-run `stackcrew sync --wire`:\n',
    profile: { ...profile, java: { ...profile.java, basePackage, wired: true } },
  };
}

export const CLAUDE_SHADOWS_AGENTS_WARNING =
  'claude-md-shadows-agents-md: creating CLAUDE.md makes recent Claude Code versions stop reading your existing AGENTS.md; '
  + 'add "@AGENTS.md" to CLAUDE.md yourself if you want both (stackcrew does not, to avoid loading its own rules twice).';

const exists = (abs) => access(abs).then(() => true, () => false);

/**
 * Claude Code reads AGENTS.md only when no CLAUDE.md / .claude/CLAUDE.md / CLAUDE.local.md exists.
 * Warn (before this run writes anything) when claude is selected, none of those exist, and AGENTS.md
 * carries content outside the stackcrew block. Filesystem-dependent, so it lives here, not in the renderer.
 */
async function claudeShadowsAgentsWarning(projectDir, profile) {
  if (!profile.tools.includes('claude')) return [];
  for (const rel of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) {
    if (await exists(path.join(projectDir, ...rel.split('/')))) return [];
  }
  let text;
  try {
    text = await readFile(path.join(projectDir, 'AGENTS.md'), 'utf8');
  } catch {
    return [];
  }
  const b = text.indexOf(MD_MARKERS.begin);
  const e = b === -1 ? -1 : text.indexOf(MD_MARKERS.end, b);
  const outside = e === -1 ? text : text.slice(0, b) + text.slice(e + MD_MARKERS.end.length);
  return outside.trim() === '' ? [] : [CLAUDE_SHADOWS_AGENTS_WARNING];
}
