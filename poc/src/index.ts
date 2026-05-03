#!/usr/bin/env node

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ─── Config ───────────────────────────────────────────────────────────────────

interface Config {
  reposRoot: string;
  projectPath?: string | null;
  include?: string[];
  exclude?: string[];
  depth?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasFile(dir: string, ...names: string[]): boolean {
  return names.some((n) => fs.existsSync(path.join(dir, n)));
}

function hasDep(pkg: Record<string, unknown>, name: string): boolean {
  return !!(
    (pkg.dependencies as Record<string, unknown>)?.[name] ||
    (pkg.devDependencies as Record<string, unknown>)?.[name]
  );
}

function readPkg(dir: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
  } catch {
    return {};
  }
}

function pkgVersion(pkg: Record<string, unknown>, name: string): string | null {
  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };
  const ver = deps?.[name];
  if (!ver) return null;
  return ver.replace(/^[^0-9]*/, '') || null;
}

function resolveRunner(dir: string, pkgName: string): string {
  const binName = pkgName.startsWith('@') ? pkgName.split('/')[1]! : pkgName;
  const localBin = path.join(dir, 'node_modules', '.bin', binName);
  if (fs.existsSync(localBin)) return `"${localBin}"`;
  const pkg = readPkg(dir);
  const ver = pkgVersion(pkg, pkgName);
  return ver ? `npx --yes ${pkgName}@${ver}` : `npx --yes ${pkgName}`;
}

let VERBOSE = false;

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

interface CmdResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  combined: string;
}

function runCmd(cmd: string, cwd: string): CmdResult {
  if (VERBOSE) console.log(`\n    ${DIM}$ ${cmd}${RESET}`);

  const result = spawnSync(cmd, {
    cwd,
    shell: true,
    encoding: 'utf-8',
    timeout: 120_000,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const combined = (stdout + stderr).trim();
  const ok = result.status === 0 && !result.error;

  if (VERBOSE) {
    for (const line of combined.split('\n').filter(Boolean)) {
      console.log(`    ${DIM}${line}${RESET}`);
    }
    if (result.error)
      console.log(`    ${RED}spawn error: ${result.error.message}${RESET}`);
    console.log(`    ${DIM}exit: ${result.status ?? 'null'}${RESET}`);
  }

  return { ok, stdout, stderr, combined };
}

// ─── Change detection (write mode) ───────────────────────────────────────────

function changedFiles(repoDir: string, fn: () => void): string[] {
  const isGit = fs.existsSync(path.join(repoDir, '.git'));

  if (isGit) {
    const snap = (): Set<string> =>
      new Set([
        ...execSync('git diff --name-only HEAD', {
          cwd: repoDir,
          encoding: 'utf-8',
        })
          .trim()
          .split('\n')
          .filter(Boolean),
        ...execSync('git ls-files --others --exclude-standard', {
          cwd: repoDir,
          encoding: 'utf-8',
        })
          .trim()
          .split('\n')
          .filter(Boolean),
      ]);
    const before = snap();
    fn();
    const after = snap();
    return [...after].filter((f) => !before.has(f));
  } else {
    const snapshot = mtimeSnapshot(repoDir);
    fn();
    return mtimeDiff(repoDir, snapshot);
  }
}

function mtimeSnapshot(dir: string): Map<string, number> {
  const map = new Map<string, number>();
  function walk(d: string) {
    if (d.includes('node_modules') || d.includes('.git')) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else map.set(full, fs.statSync(full).mtimeMs);
    }
  }
  walk(dir);
  return map;
}

function mtimeDiff(dir: string, before: Map<string, number>): string[] {
  const changed: string[] = [];
  function walk(d: string) {
    if (d.includes('node_modules') || d.includes('.git')) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      const rel = path.relative(dir, full);
      if (entry.isDirectory()) walk(full);
      else {
        const now = fs.statSync(full).mtimeMs;
        if (!before.has(full) || before.get(full) !== now) changed.push(rel);
      }
    }
  }
  walk(dir);
  return changed;
}

// ─── Check mode (dry-run) parsers ────────────────────────────────────────────
//
// Each formatter's check mode prints differently. We parse their output to
// extract the list of files that *would* be changed.
//
// Prettier --check output:
//   [warn] src/foo.ts
//   [warn] src/bar.ts
//   [warn] Code style issues found in 2 files. Forgot to run Prettier?
//
// ESLint (no --fix) output:
//   /abs/path/to/file.ts
//     1:5  error  ...
//   /abs/path/to/other.ts
//     3:1  warning  ...
//
// Biome format (no --write) output:
//   Compared 2 files in ... Formatted 1 file[s] in ...
//   src/foo.ts  ... (printed as changed)

function parsePrettierCheck(output: string, repoDir: string): string[] {
  // Lines like: [warn] src/foo.ts
  const files: string[] = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^\[warn\]\s+(.+)$/);
    if (m && m[1] && !m[1].includes('Code style issues')) {
      files.push(m[1].trim());
    }
  }
  return files;
}

function parseEslintOutput(output: string, repoDir: string): string[] {
  // ESLint prints absolute paths as file headers (lines that are not indented
  // and look like a path). We collect lines that resolve to an existing file.
  const files = new Set<string>();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(' ') || line.startsWith(' ')) continue;
    // absolute path (Unix or Windows)
    if (trimmed.match(/^([A-Za-z]:\\|\/)/)) {
      const rel = path.relative(repoDir, trimmed);
      if (!rel.startsWith('..') && fs.existsSync(trimmed)) {
        files.add(rel);
      }
    }
  }
  return [...files];
}

function parseBiomeOutput(output: string, repoDir: string): string[] {
  // Biome prints something like:
  //   src/foo.ts  migrate  ━━━ ...
  // or lists files it "fixed". We look for paths relative to cwd.
  const files = new Set<string>();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    // relative path lines starting with a letter/dot that look like file paths
    const m = trimmed.match(/^([\w./\\-]+\.(js|ts|jsx|tsx|json|css|scss))/);
    if (m) {
      const candidate = m[1];
      const full = path.resolve(repoDir, candidate);
      if (fs.existsSync(full)) files.add(candidate);
    }
  }
  return [...files];
}

// ─── Formatter definitions ────────────────────────────────────────────────────

interface FormatterRun {
  name: string;
  changed: string[];
}

interface Formatter {
  name: string;
  detect: (repoDir: string) => boolean;
  /** Actually format files and return which ones changed */
  run: (repoDir: string) => FormatterRun;
  /** Check only — return which files WOULD change, touch nothing */
  check: (repoDir: string) => FormatterRun;
}

const FORMATTERS: Formatter[] = [
  // ── Prettier ────────────────────────────────────────────────────────────
  {
    name: 'Prettier',
    detect(dir) {
      const pkg = readPkg(dir);
      return (
        hasFile(
          dir,
          '.prettierrc',
          '.prettierrc.js',
          '.prettierrc.ts',
          '.prettierrc.json',
          '.prettierrc.yaml',
          '.prettierrc.yml',
          'prettier.config.js',
          'prettier.config.ts',
          'prettier.config.mjs',
        ) || hasDep(pkg, 'prettier')
      );
    },
    run(dir) {
      const bin = resolveRunner(dir, 'prettier');
      const changed = changedFiles(dir, () => {
        runCmd(`${bin} --write . --log-level warn`, dir);
      });
      return { name: 'Prettier', changed };
    },
    check(dir) {
      const bin = resolveRunner(dir, 'prettier');
      // --check exits 1 when files need formatting, which is expected
      const r = runCmd(`${bin} --check . --log-level warn`, dir);
      const changed = parsePrettierCheck(r.combined, dir);
      return { name: 'Prettier', changed };
    },
  },

  // ── ESLint ──────────────────────────────────────────────────────────────
  {
    name: 'ESLint',
    detect(dir) {
      const pkg = readPkg(dir);
      return (
        hasFile(
          dir,
          '.eslintrc',
          '.eslintrc.js',
          '.eslintrc.cjs',
          '.eslintrc.ts',
          '.eslintrc.json',
          '.eslintrc.yaml',
          '.eslintrc.yml',
          'eslint.config.js',
          'eslint.config.ts',
          'eslint.config.mjs',
        ) || hasDep(pkg, 'eslint')
      );
    },
    run(dir) {
      const bin = resolveRunner(dir, 'eslint');
      const changed = changedFiles(dir, () => {
        runCmd(`${bin} --fix . --ext .js,.jsx,.ts,.tsx,.mjs,.cjs`, dir);
      });
      return { name: 'ESLint', changed };
    },
    check(dir) {
      const bin = resolveRunner(dir, 'eslint');
      // Run WITHOUT --fix to see what would be auto-fixed.
      // We use --fix-dry-run which outputs a JSON of what would change.
      const r = runCmd(
        `${bin} --fix-dry-run --format json . --ext .js,.jsx,.ts,.tsx,.mjs,.cjs`,
        dir,
      );
      try {
        // eslint --fix-dry-run --format json outputs a JSON array
        const jsonStr = r.stdout.trim();
        const results = JSON.parse(jsonStr) as Array<{
          filePath: string;
          output?: string;
        }>;
        const changed = results
          .filter((f) => f.output !== undefined) // output present = file would change
          .map((f) => path.relative(dir, f.filePath));
        return { name: 'ESLint', changed };
      } catch {
        // fallback: parse plain text output for files with fixable issues
        const changed = parseEslintOutput(r.combined, dir);
        return { name: 'ESLint', changed };
      }
    },
  },

  // ── Biome ───────────────────────────────────────────────────────────────
  {
    name: 'Biome',
    detect(dir) {
      return hasFile(dir, 'biome.json', 'biome.jsonc');
    },
    run(dir) {
      const bin = resolveRunner(dir, '@biomejs/biome');
      const changed = changedFiles(dir, () => {
        runCmd(`${bin} format --write .`, dir);
      });
      return { name: 'Biome', changed };
    },
    check(dir) {
      const bin = resolveRunner(dir, '@biomejs/biome');
      const r = runCmd(`${bin} format .`, dir); // no --write = check only
      const changed = parseBiomeOutput(r.combined, dir);
      return { name: 'Biome', changed };
    },
  },

  // ── Stylelint ───────────────────────────────────────────────────────────
  {
    name: 'Stylelint',
    detect(dir) {
      const pkg = readPkg(dir);
      return (
        hasFile(
          dir,
          '.stylelintrc',
          '.stylelintrc.js',
          '.stylelintrc.json',
          '.stylelintrc.yaml',
          '.stylelintrc.yml',
          'stylelint.config.js',
        ) || hasDep(pkg, 'stylelint')
      );
    },
    run(dir) {
      const bin = resolveRunner(dir, 'stylelint');
      const changed = changedFiles(dir, () => {
        runCmd(`${bin} "**/*.{css,scss,less}" --fix`, dir);
      });
      return { name: 'Stylelint', changed };
    },
    check(dir) {
      // Stylelint without --fix just reports — we count files with fixable warnings
      const bin = resolveRunner(dir, 'stylelint');
      const r = runCmd(`${bin} "**/*.{css,scss,less}" --formatter json`, dir);
      try {
        const results = JSON.parse(r.stdout) as Array<{
          source: string;
          warnings: Array<{ fixable?: boolean }>;
        }>;
        const changed = results
          .filter((f) => f.warnings.some((w) => w.fixable))
          .map((f) => path.relative(dir, f.source));
        return { name: 'Stylelint', changed };
      } catch {
        return { name: 'Stylelint', changed: [] };
      }
    },
  },

  // ── rustfmt ─────────────────────────────────────────────────────────────
  {
    name: 'rustfmt',
    detect(dir) {
      return hasFile(dir, 'Cargo.toml');
    },
    run(dir) {
      const changed = changedFiles(dir, () => {
        runCmd('cargo fmt', dir);
      });
      return { name: 'rustfmt', changed };
    },
    check(dir) {
      // cargo fmt --check exits 1 and prints files that would change
      const r = runCmd('cargo fmt --check', dir);
      const changed: string[] = [];
      for (const line of r.stderr.split('\n')) {
        const m = line.match(/^Diff in (.+) at line/);
        if (m) changed.push(path.relative(dir, m[1]!));
      }
      return { name: 'rustfmt', changed: [...new Set(changed)] };
    },
  },

  // ── gofmt ───────────────────────────────────────────────────────────────
  {
    name: 'gofmt',
    detect(dir) {
      return hasFile(dir, 'go.mod');
    },
    run(dir) {
      const changed = changedFiles(dir, () => {
        runCmd('gofmt -w .', dir);
      });
      return { name: 'gofmt', changed };
    },
    check(dir) {
      // gofmt -l lists files that differ from gofmt's style
      const r = runCmd('gofmt -l .', dir);
      const changed = r.stdout.trim().split('\n').filter(Boolean);
      return { name: 'gofmt', changed };
    },
  },

  // ── Black ───────────────────────────────────────────────────────────────
  {
    name: 'Black',
    detect(dir) {
      if (!hasFile(dir, 'pyproject.toml')) return false;
      try {
        return fs
          .readFileSync(path.join(dir, 'pyproject.toml'), 'utf-8')
          .includes('[tool.black]');
      } catch {
        return false;
      }
    },
    run(dir) {
      const changed = changedFiles(dir, () => {
        runCmd('black .', dir);
      });
      return { name: 'Black', changed };
    },
    check(dir) {
      // black --check prints "would reformat <file>" for each file
      const r = runCmd('black --check .', dir);
      const changed: string[] = [];
      for (const line of r.combined.split('\n')) {
        const m = line.match(/^would reformat (.+)$/);
        if (m) changed.push(path.relative(dir, m[1]!.trim()));
      }
      return { name: 'Black', changed };
    },
  },
];

// ─── Repo discovery ───────────────────────────────────────────────────────────

function findRepos(cfg: Config): string[] {
  if (cfg.projectPath) {
    const full = path.resolve(cfg.projectPath);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      return [full];
    }
    console.error(
      `${RED}Project path does not exist or is not a directory: ${cfg.projectPath}${RESET}`,
    );
    return [];
  }

  const root = path.resolve(cfg.reposRoot);
  const depth = cfg.depth ?? 1;
  const seen = new Set<string>();
  const repos: string[] = [];

  function walk(dir: string, currentDepth: number) {
    if (currentDepth > depth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const full = path.resolve(path.join(dir, entry.name));
      if (seen.has(full)) continue;

      const name = entry.name;
      if (cfg.exclude?.includes(name)) continue;
      if (cfg.include && !cfg.include.includes(name)) continue;

      const isRepo =
        fs.existsSync(path.join(full, '.git')) ||
        fs.existsSync(path.join(full, 'package.json')) ||
        fs.existsSync(path.join(full, 'Cargo.toml')) ||
        fs.existsSync(path.join(full, 'go.mod')) ||
        fs.existsSync(path.join(full, 'pyproject.toml'));

      if (isRepo) {
        seen.add(full);
        repos.push(full);
      } else walk(full, currentDepth + 1);
    }
  }

  walk(root, 1);
  return repos;
}

// ─── Reporting ────────────────────────────────────────────────────────────────

interface RepoResult {
  repo: string;
  formatters: FormatterRun[];
  error?: string;
}

function printReport(results: RepoResult[], isDryRun: boolean) {
  const totalRepos = results.length;
  const reposWithChanges = results.filter((r) =>
    r.formatters.some((f) => f.changed.length > 0),
  ).length;
  const totalFiles = results.reduce(
    (sum, r) => sum + r.formatters.reduce((s, f) => s + f.changed.length, 0),
    0,
  );

  const verb = isDryRun ? 'would be reformatted' : 'reformatted';

  console.log();
  console.log(
    `${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`,
  );
  console.log(
    `${BOLD}  Repo Formatter Report${isDryRun ? '  (DRY RUN)' : ''}${RESET}`,
  );
  console.log(
    `${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`,
  );
  console.log();

  for (const result of results) {
    const repoName = path.basename(result.repo);
    const allChanged = result.formatters.flatMap((f) => f.changed);

    if (result.error) {
      console.log(`${RED}✖ ${BOLD}${repoName}${RESET}`);
      console.log(`  ${RED}${result.error}${RESET}`);
      console.log();
      continue;
    }

    if (allChanged.length === 0) {
      console.log(
        `${GREEN}✔ ${BOLD}${repoName}${RESET}  ${DIM}(no changes)${RESET}`,
      );
    } else {
      const label = isDryRun ? `${YELLOW}? ` : `${YELLOW}✎ `;
      console.log(
        `${label}${BOLD}${repoName}${RESET}  ${DIM}${result.repo}${RESET}`,
      );
      for (const fmt of result.formatters) {
        if (fmt.changed.length === 0) continue;
        console.log(
          `  ${CYAN}${fmt.name}${RESET} ${verb} ${BOLD}${fmt.changed.length}${RESET} file${fmt.changed.length !== 1 ? 's' : ''}:`,
        );
        for (const f of fmt.changed) console.log(`    ${DIM}→${RESET} ${f}`);
      }
    }
    console.log();
  }

  console.log(
    `${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`,
  );
  if (isDryRun) {
    console.log(
      `  ${BOLD}${totalRepos}${RESET} repos scanned  │  ` +
        `${BOLD}${reposWithChanges}${RESET} would have changes  │  ` +
        `${BOLD}${totalFiles}${RESET} file${totalFiles !== 1 ? 's' : ''} would be reformatted`,
    );
  } else {
    console.log(
      `  ${BOLD}${totalRepos}${RESET} repos scanned  │  ` +
        `${BOLD}${reposWithChanges}${RESET} had changes  │  ` +
        `${BOLD}${totalFiles}${RESET} file${totalFiles !== 1 ? 's' : ''} reformatted`,
    );
  }
  console.log(
    `${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`,
  );
  console.log();
}

function writeJsonReport(results: RepoResult[], outPath: string) {
  const report = {
    date: new Date().toISOString(),
    repos: results.map((r) => ({
      repo: r.repo,
      name: path.basename(r.repo),
      error: r.error,
      formatters: r.formatters,
      totalChanged: r.formatters.reduce((s, f) => s + f.changed.length, 0),
    })),
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`${DIM}JSON report saved to ${outPath}${RESET}\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };

  const configPath =
    get('--config') ?? path.join(process.cwd(), 'formatter.config.json');
  const jsonOut = get('--json');
  const rootOverride = get('--root');
  const projectOverride = get('--project');
  const dryRun = args.includes('--dry-run');
  VERBOSE = args.includes('--verbose') || args.includes('-v');

  let cfg: Config;
  if (fs.existsSync(configPath)) {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Config;
  } else if (rootOverride || projectOverride) {
    cfg = { reposRoot: rootOverride ?? process.cwd() };
  } else {
    console.error(
      `${RED}No config file found at ${configPath}.\nCreate formatter.config.json or pass --root <dir> or --project <dir>${RESET}\n`,
    );
    printUsage();
    process.exit(1);
  }
  if (rootOverride) cfg.reposRoot = rootOverride;
  if (projectOverride) cfg.projectPath = projectOverride;

  if (cfg.projectPath) {
    console.log(
      `\n${BOLD}Repo Formatter${RESET}  ${DIM}targeting project ${cfg.projectPath}${RESET}`,
    );
  } else {
    console.log(
      `\n${BOLD}Repo Formatter${RESET}  ${DIM}scanning ${cfg.reposRoot}${RESET}`,
    );
  }
  if (dryRun)
    console.log(
      `  ${YELLOW}[DRY RUN — showing what would change, no files touched]${RESET}`,
    );
  if (VERBOSE) console.log(`  ${YELLOW}[VERBOSE]${RESET}`);
  console.log();

  const repos = findRepos(cfg);
  if (repos.length === 0) {
    console.log(`${YELLOW}No repos found in ${cfg.reposRoot}${RESET}`);
    process.exit(0);
  }
  console.log(`${DIM}Found ${repos.length} repo(s)${RESET}\n`);

  const results: RepoResult[] = [];

  for (const repo of repos) {
    const repoName = path.basename(repo);
    const applicable = FORMATTERS.filter((f) => f.detect(repo));

    if (applicable.length === 0) {
      if (VERBOSE)
        console.log(`  ${DIM}${repoName} — no formatters detected${RESET}`);
      results.push({ repo, formatters: [] });
      continue;
    }

    process.stdout.write(
      `  ${BOLD}${repoName}${RESET}  ${DIM}[${applicable.map((f) => f.name).join(', ')}]${RESET} … `,
    );

    const fmtResults: FormatterRun[] = [];
    let errorMsg: string | undefined;

    const isGit = fs.existsSync(path.join(repo, '.git'));

    for (const fmt of applicable) {
      try {
        // In dry-run for git repos, we now use run() and then restore later.
        // This gives us the most accurate list of changed files.
        // For non-git repos, we still use check() to avoid permanent changes.
        const result =
          dryRun && isGit
            ? fmt.run(repo)
            : dryRun
              ? fmt.check(repo)
              : fmt.run(repo);
        fmtResults.push(result);
      } catch (err) {
        errorMsg = String(err);
        break;
      }
    }

    if (dryRun && isGit && !errorMsg) {
      if (VERBOSE)
        console.log(
          `  ${DIM}Restoring original state (git restore & clean)...${RESET}`,
        );
      runCmd('git restore .', repo);
      runCmd('git clean -fd', repo);
    }

    const totalChanged = fmtResults.reduce((s, f) => s + f.changed.length, 0);
    if (errorMsg) {
      process.stdout.write(`${RED}ERROR${RESET}\n`);
      if (VERBOSE) console.log(`  ${RED}${errorMsg}${RESET}`);
    } else if (totalChanged > 0) {
      const label = dryRun ? 'would change' : 'changed';
      process.stdout.write(
        `${YELLOW}${totalChanged} file(s) ${label}${RESET}\n`,
      );
    } else {
      process.stdout.write(`${GREEN}clean${RESET}\n`);
    }

    results.push({ repo, formatters: fmtResults, error: errorMsg });
  }

  printReport(results, dryRun);
  if (jsonOut) writeJsonReport(results, jsonOut);
}

function printUsage() {
  console.log(`
Usage:
  npx tsx src/index.ts [options]

Options:
  --root <dir>      Root directory containing your repos
  --project <dir>   Run only for this specific project path (overrides --root)
  --config <path>   Path to config file  (default: ./formatter.config.json)
  --json <path>     Write a JSON report to this file
  --dry-run         Show which files WOULD be changed, without touching anything
  --verbose / -v    Print every command and its full output (for debugging)
  --help / -h       Show this help

formatter.config.json:
  {
    "reposRoot": "/path/to/your/repos",
    "exclude": ["archived-repo"],
    "depth": 1
  }
`);
}

main().catch((err) => {
  console.error(`${RED}Fatal: ${err}${RESET}`);
  process.exit(1);
});
