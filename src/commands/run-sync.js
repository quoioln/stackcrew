import { loadCatalog } from '../catalog/load.js';
import { validateCatalog } from '../catalog/validate.js';
import { readProfile, validateProfile, PROFILE_FILE } from '../profile.js';
import { buildContext, loadCustomRules } from '../render/context.js';
import { renderProject } from '../render/index.js';
import { applyOps } from '../fs/apply.js';
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

  // WIRE-BRANCH (Task 15 replaces this block with ArchUnit wiring).
  if (wire) {
    io.stderr.write('--wire: not implemented yet\n');
    return 1;
  }

  const version = await readPackageVersion();
  const customRules = await loadCustomRules(projectDir);
  const ctx = buildContext(catalog, profile, { customRules, cli: `npx --yes stackcrew@${version}`, version });
  const { ops, warnings } = renderProject(ctx);
  const report = await applyOps(projectDir, ops, { force, dryRun });

  io.stdout.write(
    `stackcrew sync: ${report.written.length} written, ${report.unchanged.length} unchanged, `
      + `${report.deleted.length} deleted, ${report.blocks.length} block(s) updated\n`,
  );
  for (const w of warnings) io.stdout.write(`warning: ${w}\n`);
  if (report.skippedModified.length > 0) {
    for (const p of report.skippedModified) io.stdout.write(`skipped (edited by hand): ${p}\n`);
    io.stdout.write('re-run with --force (your edits will be lost) or move them to .stackcrew/custom/\n');
  }
  if (ctx.stack.language === 'java' && profile.java?.wired !== true) {
    io.stdout.write('hint: run `stackcrew sync --wire` to add ArchUnit (test scope) and generate StackcrewArchitectureTest\n');
  }
  return report.skippedModified.length > 0 ? 1 : 0;
}
