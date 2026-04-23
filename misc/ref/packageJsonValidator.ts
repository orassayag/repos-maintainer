/**
 * repos-maintainer — package.json Validator
 *
 * Usage (CLI):
 *   tsx packageJsonValidator.ts /path/to/your/repos
 *   tsx packageJsonValidator.ts /path/to/your/repos --json   # machine-readable output
 *
 * Exit codes (useful for CI):
 *   0 = clean   1 = critical issues   2 = important issues   3 = bad usage
 *
 * Usage (API):
 *   import { scanRepos, validatePackageJson, printReport } from './packageJsonValidator.js';
 *   const results = await scanRepos('/path/to/repos');
 *   printReport(results);
 *
 * Per-repo overrides:
 *   Create a `.repos-maintainer.json` file in any repo to ignore specific codes:
 *   { "ignoreCodes": ["KEYWORDS_MISSING", "AUTHOR_MISSING"] }
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import semver from "semver";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = "critical" | "important" | "warning" | "info";

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  field?: string;
}

export interface ValidationResult {
  repoPath: string;
  packageName: string | null;
  issues: ValidationIssue[];
  score: number;
  hasCritical: boolean;
  hasImportant: boolean;
}

export interface ValidatorConfig {
  ignoreCodes?: string[];
}

// Strict typed interface — no `any`
interface PackageJson {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  license?: string | { type?: string; url?: string };
  main?: unknown;
  exports?: unknown;
  type?: unknown;
  private?: unknown;
  author?: unknown;
  repository?: unknown;
  keywords?: unknown;
  engines?: { node?: unknown; [key: string]: unknown };
  packageManager?: unknown;
  files?: unknown;
  types?: unknown;
  typings?: unknown;
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SPDX_COMMON = new Set([
  "MIT", "ISC", "Apache-2.0", "GPL-2.0", "GPL-3.0", "LGPL-2.1", "LGPL-3.0",
  "BSD-2-Clause", "BSD-3-Clause", "MPL-2.0", "CDDL-1.0", "EPL-2.0",
  "AGPL-3.0", "Unlicense", "CC0-1.0", "WTFPL", "0BSD",
]);

const KNOWN_DEV_TOOLS = new Set([
  "typescript", "eslint", "prettier", "vitest", "jest", "tsx", "ts-node",
  "ts-jest", "esbuild", "rollup", "vite", "webpack", "babel", "@babel/core",
  "mocha", "chai", "sinon", "nyc", "c8", "husky", "lint-staged",
  "cross-env", "rimraf", "nodemon", "concurrently",
  "@eslint/js", "typescript-eslint",
  "@typescript-eslint/eslint-plugin", "@typescript-eslint/parser",
  "eslint-config-prettier", "eslint-plugin-prettier",
  "@vitest/coverage-istanbul", "@vitest/ui",
]);

const LOCK_FILE_TO_PM: Record<string, string> = {
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "package-lock.json": "npm",
  "bun.lockb": "bun",
};

// Files that should never be published to npm
const FILES_BLOCKLIST = new Set([
  ".vscode", ".idea",
  "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lockb",
  ".env", ".env.local", ".env.development", ".env.production",
  "node_modules", ".DS_Store",
]);

// Directories to never recurse into
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "coverage", ".turbo", ".cache", "out",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function issue(
  severity: Severity,
  code: string,
  message: string,
  field?: string,
): ValidationIssue {
  return { severity, code, message, field };
}

// Uses the `semver` library — handles edge cases regex never would
function isValidSemver(v: string): boolean {
  return semver.valid(v) !== null;
}

function isValidSemverRange(r: string): boolean {
  return semver.validRange(r) !== null;
}

function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// npm supports shorthand strings like "github:user/repo" or "user/repo"
function isValidRepositoryString(value: string): boolean {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("git://") ||
    value.startsWith("git+") ||
    /^[a-z0-9-]+:[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value) || // github:user/repo
    /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value)                // user/repo shorthand
  );
}

async function loadConfig(repoPath: string): Promise<ValidatorConfig> {
  const configPath = path.join(repoPath, ".repos-maintainer.json");
  try {
    const content = await fs.promises.readFile(configPath, "utf-8");
    return JSON.parse(content) as ValidatorConfig;
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Check functions — each returns ValidationIssue[]
// ─────────────────────────────────────────────────────────────────────────────

// 🔴 CRITICAL ─────────────────────────────────────────────────────────────────

function checkName(pkg: PackageJson): ValidationIssue[] {
  if (!pkg.name) {
    return [issue("critical", "NAME_MISSING", 'Missing "name" field.', "name")];
  }
  if (typeof pkg.name !== "string") {
    return [issue("critical", "NAME_INVALID_TYPE", '"name" must be a string.', "name")];
  }
  // Proper npm name regex — handles scoped packages (@scope/name)
  if (!/^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(pkg.name)) {
    return [
      issue("critical", "NAME_INVALID",
        `"name" value "${pkg.name}" is not a valid npm package name (must be lowercase, no spaces).`,
        "name",
      ),
    ];
  }
  return [];
}

function checkVersion(pkg: PackageJson): ValidationIssue[] {
  if (!pkg.version) {
    return [issue("critical", "VERSION_MISSING", 'Missing "version" field.', "version")];
  }
  if (typeof pkg.version !== "string") {
    return [issue("critical", "VERSION_INVALID_TYPE", '"version" must be a string.', "version")];
  }
  if (!isValidSemver(pkg.version)) {
    return [
      issue("critical", "VERSION_INVALID",
        `"version" value "${pkg.version}" is not valid semver (expected x.y.z).`,
        "version",
      ),
    ];
  }
  return [];
}

function checkDescription(pkg: PackageJson): ValidationIssue[] {
  if (!pkg.description || typeof pkg.description !== "string" || pkg.description.trim() === "") {
    return [issue("critical", "DESCRIPTION_MISSING", 'Missing or empty "description" field.', "description")];
  }
  return [];
}

function checkLicense(pkg: PackageJson): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!pkg.license) {
    issues.push(issue("critical", "LICENSE_MISSING", 'Missing "license" field.', "license"));
    return issues;
  }

  if (typeof pkg.license === "string") {
    // Standard modern form: "license": "MIT"
    if (!SPDX_COMMON.has(pkg.license) && pkg.license !== "UNLICENSED") {
      issues.push(
        issue("warning", "LICENSE_UNKNOWN_SPDX",
          `"license" value "${pkg.license}" is not a recognized common SPDX identifier.`,
          "license",
        ),
      );
    }
  } else if (typeof pkg.license === "object") {
    // Deprecated object form: "license": { "type": "MIT", "url": "..." }
    // Still valid per the old npm CommonJS spec — handled without a cast
    // since the interface now correctly types this branch.
    const licType = pkg.license.type;
    if (!licType || (!SPDX_COMMON.has(licType) && licType !== "UNLICENSED")) {
      issues.push(
        issue("warning", "LICENSE_UNKNOWN_SPDX",
          `"license.type" value "${licType ?? "(missing)"}" is not a recognized common SPDX identifier.`,
          "license.type",
        ),
      );
    }
  } else {
    issues.push(
      issue("critical", "LICENSE_INVALID_TYPE",
        '"license" must be a string (e.g. "MIT") or an object { type, url? }.',
        "license",
      ),
    );
  }

  return issues;
}

function checkEntryPoint(pkg: PackageJson): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!pkg.main && !pkg.exports) {
    issues.push(issue("critical", "ENTRYPOINT_MISSING", 'Missing both "main" and "exports". At least one entry point is required.'));
  }
  if (typeof pkg.main === "string" && pkg.main.endsWith(".ts")) {
    issues.push(
      issue("critical", "MAIN_POINTS_TO_TS",
        `"main" points to a TypeScript source file ("${pkg.main}"). It should point to compiled output (e.g. "dist/index.js").`,
        "main",
      ),
    );
  }
  return issues;
}

// 🟠 IMPORTANT ────────────────────────────────────────────────────────────────

function checkType(pkg: PackageJson): ValidationIssue[] {
  if (pkg.type === undefined) {
    return [
      issue("important", "TYPE_MISSING",
        'Missing "type" field. Declare "module" or "commonjs" explicitly to avoid ambiguity.',
        "type",
      ),
    ];
  }
  if (pkg.type !== "module" && pkg.type !== "commonjs") {
    return [
      issue("important", "TYPE_INVALID",
        `"type" must be "module" or "commonjs", got "${pkg.type}".`,
        "type",
      ),
    ];
  }
  return [];
}

function checkPrivate(pkg: PackageJson): ValidationIssue[] {
  if (pkg.private === undefined) {
    return [
      issue("important", "PRIVATE_MISSING",
        '"private" field is not declared. Set to true for apps/internal tools, false for published packages.',
        "private",
      ),
    ];
  }
  return [];
}

function checkAuthor(pkg: PackageJson): ValidationIssue[] {
  if (!pkg.author) {
    return [issue("important", "AUTHOR_MISSING", 'Missing "author" field.', "author")];
  }
  return [];
}

function checkRepository(pkg: PackageJson): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!pkg.repository) {
    issues.push(issue("important", "REPOSITORY_MISSING", 'Missing "repository" field.', "repository"));
    return issues;
  }
  if (typeof pkg.repository === "string") {
    // Accept npm shorthand formats (github:user/repo, user/repo) and full URLs
    if (!isValidRepositoryString(pkg.repository)) {
      issues.push(
        issue("warning", "REPOSITORY_INVALID_STRING",
          `"repository" string "${pkg.repository}" is not a recognized URL or npm shorthand format.`,
          "repository",
        ),
      );
    }
    return issues;
  }
  if (typeof pkg.repository === "object" && pkg.repository !== null) {
    const repo = pkg.repository as Record<string, unknown>;
    if (!repo.type) {
      issues.push(issue("warning", "REPOSITORY_NO_TYPE", '"repository.type" is missing (e.g. "git").', "repository.type"));
    }
    if (!repo.url) {
      issues.push(issue("warning", "REPOSITORY_NO_URL", '"repository.url" is missing.', "repository.url"));
    }
  }
  return issues;
}

function checkEngines(pkg: PackageJson): ValidationIssue[] {
  if (!pkg.engines?.node) {
    return [
      issue("important", "ENGINES_NODE_MISSING",
        'Missing "engines.node". Declare minimum Node.js version (e.g. ">=20.0.0").',
        "engines.node",
      ),
    ];
  }
  if (typeof pkg.engines.node === "string" && !isValidSemverRange(pkg.engines.node)) {
    return [
      issue("important", "ENGINES_NODE_INVALID",
        `"engines.node" value "${pkg.engines.node}" is not a valid semver range.`,
        "engines.node",
      ),
    ];
  }
  return [];
}

function checkPackageManager(pkg: PackageJson, repoPath: string): ValidationIssue[] {
  if (pkg.packageManager) return [];
  for (const [lockFile, pm] of Object.entries(LOCK_FILE_TO_PM)) {
    if (fileExists(path.join(repoPath, lockFile))) {
      return [
        issue("important", "PACKAGE_MANAGER_MISSING",
          `Lock file "${lockFile}" detected but "packageManager" field is missing. Add e.g. "packageManager": "${pm}@x.x.x".`,
          "packageManager",
        ),
      ];
    }
  }
  return [];
}

function checkDependencyMisplacement(pkg: PackageJson): ValidationIssue[] {
  return Object.keys(pkg.dependencies ?? {})
    .filter((dep) => KNOWN_DEV_TOOLS.has(dep))
    .map((dep) =>
      issue("important", "DEV_TOOL_IN_DEPS",
        `"${dep}" is a dev tool but is listed in "dependencies". Move it to "devDependencies".`,
        `dependencies.${dep}`,
      ),
    );
}

function checkPeerDependencies(pkg: PackageJson): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const peerDeps = pkg.peerDependencies ?? {};
  const deps = new Set(Object.keys(pkg.dependencies ?? {}));
  const peerMeta = pkg.peerDependenciesMeta ?? {};

  for (const dep of Object.keys(peerDeps)) {
    // A peerDep listed in dependencies forces a specific version on consumers,
    // potentially causing duplicates. The exception is optional peers, which
    // are sometimes self-installed as a fallback — flag those as info only.
    if (deps.has(dep)) {
      const isOptional = peerMeta[dep]?.optional === true;
      issues.push(
        issue(
          isOptional ? "info" : "important",
          "PEER_DEP_IN_DEPS",
          `"${dep}" is declared as a peerDependency but also appears in "dependencies". `
          + (isOptional
            ? "Since it is marked optional this may be intentional, but verify it won't cause version conflicts for consumers."
            : "This forces a specific version on consumers and may cause duplicate installs."),
          `dependencies.${dep}`,
        ),
      );
    }
  }

  return issues;
}

// 🟡 WARNING ──────────────────────────────────────────────────────────────────

function checkKeywords(pkg: PackageJson): ValidationIssue[] {
  if (!pkg.keywords) {
    return [issue("warning", "KEYWORDS_MISSING", 'Missing "keywords" array.', "keywords")];
  }
  if (!Array.isArray(pkg.keywords) || pkg.keywords.length === 0) {
    return [issue("warning", "KEYWORDS_EMPTY", '"keywords" array is empty.', "keywords")];
  }
  return [];
}

function checkScripts(pkg: PackageJson, repoPath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const scripts = pkg.scripts ?? {};
  if (!scripts.test) {
    issues.push(issue("warning", "SCRIPT_TEST_MISSING", 'No "scripts.test" defined.', "scripts.test"));
  }
  if (!scripts.lint) {
    issues.push(issue("warning", "SCRIPT_LINT_MISSING", 'No "scripts.lint" defined.', "scripts.lint"));
  }
  if (fileExists(path.join(repoPath, "tsconfig.json")) && !scripts.build) {
    issues.push(issue("warning", "SCRIPT_BUILD_MISSING", '"tsconfig.json" found but no "scripts.build" defined.', "scripts.build"));
  }
  return issues;
}

function checkFiles(pkg: PackageJson): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (pkg.private === false && !pkg.files) {
    issues.push(
      issue("warning", "FILES_MISSING",
        '"private" is false (publishable package) but "files" field is missing. Define what gets published.',
        "files",
      ),
    );
  }
  if (Array.isArray(pkg.files)) {
    for (const entry of pkg.files) {
      if (typeof entry === "string" && FILES_BLOCKLIST.has(entry)) {
        issues.push(
          issue("warning", "FILES_INCLUDES_BLOCKED",
            `"files" includes "${entry}" which should not be published.`,
            "files",
          ),
        );
      }
    }
  }
  return issues;
}

function checkExportsAndTypes(pkg: PackageJson, repoPath: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const isPublic = pkg.private === false;
  const hasBuildScript = !!pkg.scripts?.build;
  const isTypeScript = fileExists(path.join(repoPath, "tsconfig.json"));

  if (pkg.type === "module" && isPublic && !pkg.exports) {
    issues.push(
      issue("warning", "EXPORTS_MISSING",
        'ESM package ("type": "module") that is public should define an "exports" field instead of relying on "main" alone.',
        "exports",
      ),
    );
  }

  // If exports is defined, validate its structure
  if (pkg.exports !== undefined && pkg.exports !== null && typeof pkg.exports === "object") {
    const exp = pkg.exports as Record<string, unknown>;
    const keys = Object.keys(exp);

    // An exports map with named sub-paths but no root "." entry means
    // direct package imports (`import "pkg"`) will fail for consumers.
    const hasSubPaths = keys.some((k) => k.startsWith(".") && k !== ".");
    const hasConditionsOnly = keys.some((k) => !k.startsWith("."));
    const hasRootEntry = "." in exp || hasConditionsOnly; // bare conditions = root shorthand

    if (hasSubPaths && !hasRootEntry) {
      issues.push(
        issue("important", "EXPORTS_ROOT_MISSING",
          '"exports" defines sub-path entries but is missing a root (".") entry. Direct package imports will fail for consumers.',
          "exports",
        ),
      );
    }

    // "types" condition should come before "import"/"require" so TypeScript
    // finds it first under moduleResolution: bundler / nodenext.
    const rootExport = (exp["."] ?? pkg.exports) as Record<string, unknown> | null;
    if (rootExport && typeof rootExport === "object") {
      const conditionKeys = Object.keys(rootExport);
      const typesIdx   = conditionKeys.indexOf("types");
      const importIdx  = conditionKeys.indexOf("import");
      const requireIdx = conditionKeys.indexOf("require");
      const hasTypesAfterRuntime =
        typesIdx !== -1 &&
        ((importIdx !== -1 && typesIdx > importIdx) ||
         (requireIdx !== -1 && typesIdx > requireIdx));

      if (hasTypesAfterRuntime) {
        issues.push(
          issue("warning", "EXPORTS_TYPES_ORDER",
            '"types" condition in "exports" should be listed before "import"/"require" so TypeScript resolves it correctly under moduleResolution: bundler/nodenext.',
            "exports.types",
          ),
        );
      }
    }
  }

  if (isPublic && isTypeScript && hasBuildScript && !pkg.types && !pkg.typings) {
    issues.push(
      issue("warning", "TYPES_MISSING",
        'Public TypeScript package with a build script is missing a "types" or "typings" field pointing to compiled declarations.',
        "types",
      ),
    );
  }
  return issues;
}

function checkDuplicateDependencies(pkg: PackageJson): ValidationIssue[] {
  const deps = new Set(Object.keys(pkg.dependencies ?? {}));
  return Object.keys(pkg.devDependencies ?? {})
    .filter((dep) => deps.has(dep))
    .map((dep) =>
      issue("warning", "DUPLICATE_DEPENDENCY",
        `"${dep}" appears in both "dependencies" and "devDependencies".`,
        `devDependencies.${dep}`,
      ),
    );
}

// 🔵 INFO ─────────────────────────────────────────────────────────────────────

function checkVersionPinningConsistency(pkg: PackageJson): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [section, deps] of [
    ["dependencies", pkg.dependencies ?? {}],
    ["devDependencies", pkg.devDependencies ?? {}],
  ] as [string, Record<string, string>][]) {
    const entries = Object.entries(deps);
    if (entries.length < 2) continue;
    const pinned = entries.filter(([, v]) => /^\d/.test(v)).map(([k]) => k);
    const hasRanged = entries.some(([, v]) => /^[^0-9]/.test(v));
    if (pinned.length > 0 && hasRanged) {
      issues.push(
        issue("info", "PINNING_INCONSISTENCY",
          `"${section}" mixes hard-pinned and range versions. Pinned: ${pinned.join(", ")}.`,
          section,
        ),
      );
    }
  }
  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring — capped per severity so a flood of one type can't zero the score
// ─────────────────────────────────────────────────────────────────────────────

function calculateScore(issues: ValidationIssue[]): number {
  const PENALTY: Record<Severity, number> = { critical: 25, important: 10, warning: 5, info: 1 };
  const CAPS: Record<Severity, number>    = { critical: 50, important: 30, warning: 15, info: 5 };

  const totals: Record<Severity, number> = { critical: 0, important: 0, warning: 0, info: 0 };
  for (const i of issues) totals[i.severity] += PENALTY[i.severity];

  const penalty = (Object.keys(totals) as Severity[])
    .reduce((sum, s) => sum + Math.min(totals[s], CAPS[s]), 0);

  return Math.max(0, 100 - penalty);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main validator — async throughout, per-repo config support
// ─────────────────────────────────────────────────────────────────────────────

export async function validatePackageJson(repoPath: string): Promise<ValidationResult> {
  const pkgPath = path.join(repoPath, "package.json");

  try {
    await fs.promises.access(pkgPath);
  } catch {
    return {
      repoPath, packageName: null,
      issues: [issue("critical", "FILE_NOT_FOUND", `No package.json found at: ${pkgPath}`)],
      score: 0, hasCritical: true, hasImportant: false,
    };
  }

  let pkg: PackageJson;
  try {
    const content = await fs.promises.readFile(pkgPath, "utf-8");
    pkg = JSON.parse(content) as PackageJson;
  } catch {
    return {
      repoPath, packageName: null,
      issues: [issue("critical", "PARSE_ERROR", "package.json contains invalid JSON.")],
      score: 0, hasCritical: true, hasImportant: false,
    };
  }

  const config = await loadConfig(repoPath);

  const allIssues: ValidationIssue[] = [
    // 🔴 Critical
    ...checkName(pkg),
    ...checkVersion(pkg),
    ...checkDescription(pkg),
    ...checkLicense(pkg),
    ...checkEntryPoint(pkg),
    // 🟠 Important
    ...checkType(pkg),
    ...checkPrivate(pkg),
    ...checkAuthor(pkg),
    ...checkRepository(pkg),
    ...checkEngines(pkg),
    ...checkPackageManager(pkg, repoPath),
    ...checkDependencyMisplacement(pkg),
    ...checkPeerDependencies(pkg),
    // 🟡 Warning
    ...checkKeywords(pkg),
    ...checkScripts(pkg, repoPath),
    ...checkFiles(pkg),
    ...checkExportsAndTypes(pkg, repoPath),
    ...checkDuplicateDependencies(pkg),
    // 🔵 Info
    ...checkVersionPinningConsistency(pkg),
  ].filter((i) => !config.ignoreCodes?.includes(i.code));

  const score = calculateScore(allIssues);

  return {
    repoPath,
    packageName: typeof pkg.name === "string" ? pkg.name : null,
    issues: allIssues,
    score,
    hasCritical: allIssues.some((i) => i.severity === "critical"),
    hasImportant: allIssues.some((i) => i.severity === "important"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recursive repo scanner — skips node_modules, dist, .git, etc.
// ─────────────────────────────────────────────────────────────────────────────

async function findPackageJsonDirs(dir: string): Promise<string[]> {
  const results: string[] = [];

  // Always check the current directory itself.
  // Handles both the single-repo case (pointing directly at a repo root)
  // and monorepo roots (root package.json + workspace packages/).
  try {
    await fs.promises.access(path.join(dir, "package.json"));
    results.push(dir);
  } catch {
    // No package.json at this level — keep going
  }

  // Recurse into every non-skipped subdirectory in parallel.
  // We always recurse regardless of whether we found a package.json here,
  // which is what makes monorepos (root + packages/*) work correctly.
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  const subPromises: Promise<string[]>[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    subPromises.push(findPackageJsonDirs(path.join(dir, entry.name)));
  }

  const nestedResults = await Promise.all(subPromises);
  for (const nested of nestedResults) results.push(...nested);

  return results;
}

export async function scanRepos(rootDir: string): Promise<ValidationResult[]> {
  const repos = await findPackageJsonDirs(rootDir);
  return Promise.all(repos.map(validatePackageJson));
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI reporter
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_ICON: Record<Severity, string> = {
  critical:  "🔴",
  important: "🟠",
  warning:   "🟡",
  info:      "🔵",
};

export function printReport(results: ValidationResult[]): void {
  const total      = results.length;
  const withIssues = results.filter((r) => r.issues.length > 0).length;
  const clean      = total - withIssues;
  const avgScore   = total > 0
    ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / total)
    : 0;

  console.log("\n══════════════════════════════════════════════════════");
  console.log("  📦  repos-maintainer — package.json Audit Report   ");
  console.log("══════════════════════════════════════════════════════\n");
  console.log(`  Repos scanned  : ${total}`);
  console.log(`  ✅ Clean        : ${clean}`);
  console.log(`  ⚠️  With issues  : ${withIssues}`);
  console.log(`  📊 Avg score    : ${avgScore}/100\n`);

  // Sort: critical first, then by score ascending (worst first)
  const sorted = [...results].sort((a, b) => {
    if (a.hasCritical !== b.hasCritical) return a.hasCritical ? -1 : 1;
    if (a.hasImportant !== b.hasImportant) return a.hasImportant ? -1 : 1;
    return a.score - b.score;
  });

  for (const result of sorted) {
    const label      = result.packageName ?? path.basename(result.repoPath);
    const statusIcon = result.hasCritical   ? "🔴"
                     : result.hasImportant  ? "🟠"
                     : result.issues.length ? "🟡"
                     : "✅";

    console.log("──────────────────────────────────────────────────────");
    console.log(`  ${statusIcon}  ${label}  (score: ${result.score}/100)`);
    console.log(`       ${result.repoPath}`);

    if (result.issues.length === 0) {
      console.log("       No issues found.\n");
      continue;
    }

    for (const i of result.issues) {
      const field = i.field ? ` [${i.field}]` : "";
      console.log(`\n       ${SEVERITY_ICON[i.severity]} ${i.code}${field}`);
      console.log(`          ${i.message}`);
    }
    console.log();
  }

  console.log("══════════════════════════════════════════════════════\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// ESM-safe entry point  (fixes the require.main CJS bug from v2)
//
// Flags:
//   --json          Print results as a JSON array instead of the human report.
//                   Useful for CI pipelines and downstream tooling.
//
// Exit codes:
//   0  All repos clean (no critical or important issues)
//   1  One or more repos have critical issues
//   2  No critical issues, but one or more repos have important issues
//   3  Bad usage (missing args, path not found)
// ─────────────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  // Wrapped in an async IIFE — top-level await is only valid at the true
  // module top level, not inside a conditional block. The IIFE also gives
  // us a single .catch() for any unhandled fatal error.
  (async () => {
    const args = process.argv.slice(2);
    const jsonMode = args.includes("--json");
    const dir = args.find((a) => !a.startsWith("--"));

    if (!dir) {
      console.error("Usage: tsx packageJsonValidator.ts <path/to/repos> [--json]");
      process.exit(3);
    }

    const rootDir = path.resolve(dir);
    if (!fs.existsSync(rootDir)) {
      console.error(`Directory not found: ${rootDir}`);
      process.exit(3);
    }

    const results = await scanRepos(rootDir);

    if (jsonMode) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      printReport(results);
    }

    const hasCritical  = results.some((r) => r.hasCritical);
    const hasImportant = results.some((r) => r.hasImportant);

    if (hasCritical)       process.exit(1);
    else if (hasImportant) process.exit(2);
    else                   process.exit(0);
  })().catch((err: unknown) => {
    console.error("❌ Fatal error:", err);
    process.exit(3);
  });
}
