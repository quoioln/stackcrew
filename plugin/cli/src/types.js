// Shared JSDoc typedefs for stackcrew. No runtime exports.

/** Errors: class StackcrewError extends Error { constructor(code, message) } — src/errors.js
 *  codes: 'FRONTMATTER' | 'TEMPLATE' | 'CATALOG' | 'PROFILE' | 'MARKER' | 'BUDGET' | 'RENDER' | 'GIT' */

/** @typedef {{ files: string[], contains: string[], excludeContains: string[], packageDeps: string[] }} DetectSpec */
/** @typedef {{ id: string, title: string, categories: string[], languages: string[],
 *   essentials: string, body: string, source: string, globs?: string[], alwaysOn?: boolean }} RuleDoc
 *   // categories/languages empty = applies to all; globs/alwaysOn only on custom rules */
/** @typedef {{ relPath: string, content: string }} SkillFile */
/** @typedef {{ name: string, description: string, kind: 'task'|'testing'|'advisor'|'command'|'rules',
 *   paths: string[], requiresAddons: string[], body: string, files: SkillFile[], source: string }} SkillDoc */
/** @typedef {{ id: string, globs: string[], excludeGlobs: string[], regex: string, flags: string, message: string }} GuardRule */
/** @typedef {{ id: string, name: string, category: 'backend'|'frontend'|'fullstack', language: string,
 *   minVersion: string, globs: string[], aliases: string[], priority: number, detect: DetectSpec,
 *   rules: RuleDoc, testing: RuleDoc, skills: SkillDoc[], guard: GuardRule[],
 *   lintFiles: SkillFile[], wireFiles: SkillFile[] }} Stack */
/** @typedef {{ id: string, name: string, languages: string[], detect: DetectSpec, rules: RuleDoc }} Addon */
/** @typedef {{ id: string, rule: RuleDoc, guard: GuardRule[] }} Language */
/** @typedef {{ id: 'tech-lead'|'developer'|'tester', model: 'opus'|'sonnet'|'haiku',
 *   skillKinds: ('task'|'testing'|'advisor')[], description: string, body: string }} RoleDoc */
/** @typedef {{ name: string, description: string, body: string }} PluginCommandDoc */
/** @typedef {{ dir: string, alwaysOn: string, coreRules: RuleDoc[], languages: Map<string, Language>,
 *   stacks: Map<string, Stack>, addons: Map<string, Addon>, sharedSkills: SkillDoc[],
 *   roles: RoleDoc[], pluginCommands: PluginCommandDoc[] }} Catalog */
/** @typedef {{ id: string, area: string, decision: string, rationale: string, rejected: string[] }} Decision */
/** @typedef {{ version: 1, stack: string, addons: string[], tools: ('claude'|'cursor'|'codex'|'antigravity')[],
 *   mode: 'greenfield'|'brownfield', guard: boolean, context: Record<string,string>,
 *   decisions: Decision[], java?: { basePackage: string, wired: boolean } }} Profile */
/** @typedef {{ dir: string, format: 'claude'|'generic' }} SkillDir */
/** @typedef {{ taskDirs: SkillDir[], commandDirs: SkillDir[], warnings: string[] }} SkillDirPlan */
/** @typedef {{ name: string, description: string, model: string, body: string, skills: string[] }} RenderedRole */
/** @typedef {{ catalog: Catalog, profile: Profile, stack: Stack, language: Language, addons: Addon[],
 *   rules: RuleDoc[], alwaysOn: string, skills: SkillDoc[], commandSkills: SkillDoc[], roles: RenderedRole[],
 *   skillDirs: SkillDirPlan, vars: { stackId: string, stackName: string, cli: string, version: string, basePackage: string } }} RenderContext */
/** @typedef {{ path: string, kind: 'owned'|'block', content: string }} FileOp   // path: POSIX, project-relative */
/** @typedef {{ ops: FileOp[], warnings: string[] }} RenderResult */
/** @typedef {{ written: string[], unchanged: string[], deleted: string[], skippedModified: string[],
 *   blocks: string[], manifestStatus: 'ok'|'missing'|'corrupt' }} ApplyReport */
/** @typedef {{ version: 1, files: Record<string, string> }} Manifest   // path → sha256 of LF content */
/** @typedef {{ file: string, line: number, ruleId: string, message: string, text: string }} Violation */
/** @typedef {{ file: string, lines: { line: number, text: string }[] }} DiffFile */

export {};
