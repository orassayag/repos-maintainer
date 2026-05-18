import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { settings } from '../settings.js';
import { Logger } from '../utils/logger.js';
import { isTypeScriptProject } from '../utils/projectType.js';

/**
 * Fetches the latest version of a package from npm.
 * Falls back to an empty string if it fails.
 */
function getLatestVersion(pkgName: string): string {
  try {
    return (
      '^' +
      execSync(`npm show ${pkgName} version`, { encoding: 'utf-8' }).trim()
    );
  } catch {
    return '';
  }
}

/**
 * Injects a full package.json from template with dynamic values.
 * Used primarily for new repository setup.
 */
export async function injectPackageJson(
  repoPath: string,
  repoName: string,
  description: string,
  keywords: string[]
): Promise<boolean> {
  const pkgPath = path.join(repoPath, 'package.json');
  const templatePath = path.join(settings.TEMPLATES_DIR, 'package.json');

  try {
    const templateContent = await fs.readFile(templatePath, 'utf-8');

    // Replace #REPO-NAME# everywhere (including URL)
    let content = templateContent.replace(/#REPO-NAME#/g, repoName);

    const pkg = JSON.parse(content);

    // Explicitly set description from user input to avoid JSON escaping issues
    pkg.description = description;

    // Update keywords
    pkg.keywords = [...new Set([...(pkg.keywords || []), ...keywords])];

    // Fetch dynamic versions for dependencies and devDependencies
    Logger.log(`📦 Fetching latest versions for dependencies...`);

    if (pkg.dependencies) {
      for (const dep of Object.keys(pkg.dependencies)) {
        pkg.dependencies[dep] = getLatestVersion(dep);
      }
    }

    if (pkg.devDependencies) {
      for (const dep of Object.keys(pkg.devDependencies)) {
        pkg.devDependencies[dep] = getLatestVersion(dep);
      }
    }

    // Update author and contributors (using existing logic)
    pkg.author = `${settings.AUTHOR_NAME} <${settings.AUTHOR_EMAIL}>`;
    pkg.contributors = [
      {
        name: settings.AUTHOR_NAME,
        email: settings.AUTHOR_EMAIL,
        url: `https://github.com/${settings.AUTHOR_GITHUB}`,
      },
    ];

    if (settings.DRY_RUN) {
      Logger.log('🔍 [DRY RUN] Would inject package.json with dynamic values');
      return false;
    }

    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    Logger.success('Injected package.json with dynamic values');
    return true;
  } catch (err) {
    Logger.error(`Could not inject package.json: ${(err as Error).message}`);
    return false;
  }
}

const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.cache',
  '__tests__',
  'test',
  'tests',
  'spec',
]);

/**
 * Recursively collect all .js / .ts files, skipping noise directories and
 * test/spec files.
 */
async function collectSourceFiles(
  dir: string,
  root: string,
  results: string[] = []
): Promise<string[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        await collectSourceFiles(abs, root, results);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!['.js', '.ts'].includes(ext)) continue;
      if (/\.(test|spec)\.(js|ts)$/.test(entry.name)) continue;
      // Normalize to forward slashes for package.json consistency
      results.push(path.relative(root, abs).replace(/\\/g, '/'));
    }
  }
  return results;
}

/**
 * Rank a relative file path by how likely it is to be the main entry point.
 * Lower score = more likely.
 */
function rankFile(rel: string): number {
  const parts = rel.split(path.sep);
  const depth = parts.length - 1;
  const noExt = path.basename(rel, path.extname(rel)).toLowerCase();
  const dirSeg = parts.slice(0, -1).join('/').toLowerCase();

  let score = 0;

  // Prefer shallower files
  score += depth * 10;

  // Slight bonus for src/ (common convention)
  if (dirSeg === 'src') score -= 3;

  // Strong preference for canonical entry-point names
  const nameBonus: Record<string, number> = {
    index: -15,
    main: -12,
    app: -10,
    server: -8,
    start: -6,
  };
  if (nameBonus[noExt] !== undefined) score += nameBonus[noExt];

  // Prefer .js over .ts (compiled output is usually .js)
  if (path.extname(rel) === '.ts') score += 2;

  return score;
}

/**
 * Ensures package.json has the correct author and contributors fields.
 * Idempotent — won't duplicate if already correct.
 * Returns true if changes were made.
 */
export async function fixPackageJson(
  repoPath: string,
  repoName: string
): Promise<boolean> {
  const pkgPath = path.join(repoPath, 'package.json');
  const templatePath = path.join(settings.TEMPLATES_DIR, 'package.json');

  try {
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    const templateContent = await fs.readFile(templatePath, 'utf-8');
    const templatePkg = JSON.parse(templateContent);

    let changed = false;

    // 1. funding
    if (
      !pkg.funding ||
      JSON.stringify(pkg.funding) !== JSON.stringify(templatePkg.funding)
    ) {
      pkg.funding = templatePkg.funding;
      changed = true;
      Logger.info('Updated "funding" in package.json');
    }

    // 2. engines
    const expectedEngines = {
      node: '>=20.0.0',
      pnpm: '>=8.0.0',
    };
    if (
      !pkg.engines ||
      JSON.stringify(pkg.engines) !== JSON.stringify(expectedEngines)
    ) {
      pkg.engines = expectedEngines;
      changed = true;
      Logger.info('Updated "engines" in package.json');
    }

    // 3. contributors
    if (
      !pkg.contributors ||
      JSON.stringify(pkg.contributors) !==
        JSON.stringify(templatePkg.contributors)
    ) {
      pkg.contributors = templatePkg.contributors;
      changed = true;
      Logger.info('Updated "contributors" in package.json');
    }

    // 4. author
    if (
      !pkg.author ||
      JSON.stringify(pkg.author) !== JSON.stringify(templatePkg.author)
    ) {
      pkg.author = templatePkg.author;
      changed = true;
      Logger.info('Updated "author" in package.json');
    }

    // 5. main
    let currentMainValid = false;
    if (pkg.main && pkg.main.trim() !== '') {
      // Normalize existing main to forward slashes for consistent comparison/access
      const normalizedMain = pkg.main.replace(/\\/g, '/');

      try {
        // Strict check: if the file doesn't exist, it's invalid.
        await fs.access(path.join(repoPath, normalizedMain));
        currentMainValid = true;
      } catch {
        currentMainValid = false;
      }
    }

    if (!currentMainValid) {
      let resolved: string | null = null;

      // Step 1: index.js / index.ts (root, then src/)
      const indexCandidates = [
        'index.js',
        'index.ts',
        'src/index.js',
        'src/index.ts',
      ];
      for (const cand of indexCandidates) {
        try {
          await fs.access(path.join(repoPath, cand));
          resolved = cand;
          break;
        } catch {}
      }

      // Step 2: main.js / main.ts (root, then src/)
      if (!resolved) {
        const mainCandidates = [
          'main.js',
          'main.ts',
          'src/main.js',
          'src/main.ts',
        ];
        for (const cand of mainCandidates) {
          try {
            await fs.access(path.join(repoPath, cand));
            resolved = cand;
            break;
          } catch {}
        }
      }

      // Step 3: smart scan
      if (!resolved) {
        const allFiles = await collectSourceFiles(repoPath, repoPath);
        if (allFiles.length > 0) {
          allFiles.sort((a, b) => rankFile(a) - rankFile(b));
          resolved = allFiles[0];
        }
      }

      // Step 4: give up
      if (!resolved) {
        resolved = '';
      }

      // The user expects the "main" to point to the real root file (e.g., src/main.ts)
      // and NOT map to dist/ folder.
      const finalMain = resolved;

      if (pkg.main !== finalMain) {
        pkg.main = finalMain;
        changed = true;
        Logger.info(`Updated "main" to ${finalMain}`);
      }
    }

    // 6. type
    if (!pkg.type || pkg.type !== templatePkg.type) {
      pkg.type = templatePkg.type;
      changed = true;
      Logger.info('Updated "type" in package.json');
    }

    // 8. repository
    if (templatePkg.repository) {
      const expectedRepository = JSON.parse(
        JSON.stringify(templatePkg.repository).replace(/#REPO-NAME#/g, repoName)
      );
      if (
        !pkg.repository ||
        JSON.stringify(pkg.repository) !== JSON.stringify(expectedRepository)
      ) {
        pkg.repository = expectedRepository;
        changed = true;
        Logger.info('Updated "repository" in package.json');
      }
    }

    // 9. bugs
    if (templatePkg.bugs) {
      const expectedBugs = JSON.parse(
        JSON.stringify(templatePkg.bugs).replace(/#REPO-NAME#/g, repoName)
      );
      if (
        !pkg.bugs ||
        JSON.stringify(pkg.bugs) !== JSON.stringify(expectedBugs)
      ) {
        pkg.bugs = expectedBugs;
        changed = true;
        Logger.info('Updated "bugs" in package.json');
      }
    }

    // 10. homepage
    if (templatePkg.homepage) {
      const expectedHomepage = templatePkg.homepage.replace(
        /#REPO-NAME#/g,
        repoName
      );
      if (!pkg.homepage || pkg.homepage !== expectedHomepage) {
        pkg.homepage = expectedHomepage;
        changed = true;
        Logger.info('Updated "homepage" in package.json');
      }
    }

    // 11. devDependencies
    if (!pkg.devDependencies && templatePkg.devDependencies) {
      Logger.info(
        'Missing "devDependencies" section. Populating from template...'
      );

      const isTS = await isTypeScriptProject(repoPath);
      const templateDevDeps = JSON.parse(
        JSON.stringify(templatePkg.devDependencies)
      );

      if (!isTS) {
        // Filter out TypeScript-specific dependencies for JS projects
        const tsDeps = [
          'typescript',
          'typescript-eslint',
          'tsx',
          '@types/node',
          '@typescript-eslint/eslint-plugin',
          '@typescript-eslint/parser',
          'vitest',
          '@vitest/coverage-istanbul',
          '@vitest/ui',
        ];
        for (const dep of tsDeps) {
          delete templateDevDeps[dep];
        }
        Logger.info(
          'Project detected as JavaScript. Skipping TypeScript-specific devDependencies.'
        );
      }

      pkg.devDependencies = templateDevDeps;

      // Fetch dynamic versions for devDependencies
      Logger.log(`📦 Fetching latest versions for devDependencies...`);
      for (const dep of Object.keys(pkg.devDependencies)) {
        pkg.devDependencies[dep] = getLatestVersion(dep);
      }

      changed = true;
      Logger.info('Updated "devDependencies" in package.json');
    }

    // 7. files (Sync "files" section with root directory)
    const rootEntries = await fs.readdir(repoPath, { withFileTypes: true });
    const sortedRootItems = rootEntries
      .filter(
        (e) =>
          e.name !== '.git' &&
          e.name !== 'node_modules' &&
          e.name !== 'coverage'
      )
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      })
      .map((e) => e.name);

    const pkgFiles = pkg.files || [];
    const isFilesIdentical =
      pkgFiles.length === sortedRootItems.length &&
      pkgFiles.every(
        (file: string, index: number) => file === sortedRootItems[index]
      );

    if (!isFilesIdentical) {
      pkg.files = sortedRootItems;
      changed = true;
      Logger.info('Updated "files" section in package.json');
    }

    if (changed) {
      if (settings.DRY_RUN) {
        Logger.info(`[DRY RUN] Would fix package.json for ${repoName}`);
        return false;
      }
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      Logger.success(`Fixed package.json for ${repoName}`);
      return true;
    }

    return false;
  } catch (err) {
    Logger.warn(
      `Could not fix package.json for ${repoName}: ${(err as Error).message}`
    );
    return false;
  }
}
