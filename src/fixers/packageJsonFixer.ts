import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { settings } from '../settings.js';
import { Logger } from '../utils/logger.js';

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
export function rankFile(rel: string): number {
  const parts = rel.split('/');
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
  repoName: string,
  relativePath: string = 'package.json',
  repoType: string = 'active'
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
      Logger.info(`Updated "funding" in ${relativePath}`);
    }

    // 2. engines
    if (repoType === 'active') {
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
        Logger.info(`Updated "engines" in ${relativePath}`);
      }
    }

    // 3. author
    const expectedAuthor = {
      name: 'Or Assayag',
      email: 'orassayag@gmail.com',
      url: 'https://github.com/orassayag',
    };

    if (
      !pkg.author ||
      typeof pkg.author !== 'object' ||
      pkg.author.name !== expectedAuthor.name ||
      pkg.author.email !== expectedAuthor.email ||
      pkg.author.url !== expectedAuthor.url
    ) {
      pkg.author = expectedAuthor;
      changed = true;
      Logger.info(`Updated "author" in ${relativePath}`);
    }

    // 4. contributors
    const expectedContributor = {
      name: 'Or Assayag',
      email: 'orassayag@gmail.com',
      url: 'https://github.com/orassayag',
    };
    const hasContributor = pkg.contributors?.some(
      (c: { name: string; email: string; url: string }) =>
        c.name === expectedContributor.name &&
        c.email === expectedContributor.email &&
        c.url === expectedContributor.url
    );
    if (!hasContributor) {
      pkg.contributors = [expectedContributor];
      changed = true;
      Logger.info(`Updated "contributors" in ${relativePath}`);
    }

    // 5. main
    let currentMainValid = false;
    if (pkg.main && pkg.main.trim() !== '') {
      const normalizedMain = pkg.main.replace(/\\/g, '/');
      try {
        await fs.access(path.join(repoPath, normalizedMain));
        currentMainValid = true;
      } catch {
        currentMainValid = false;
      }
    }

    if (!currentMainValid) {
      let resolved: string | null = null;
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

      if (!resolved) {
        // Try root level of src first
        const srcDir = path.join(repoPath, 'src');
        try {
          const entries = await fs.readdir(srcDir, { withFileTypes: true });
          const candidates = entries
            .filter(
              (e) =>
                e.isFile() &&
                ['.js', '.ts'].includes(path.extname(e.name)) &&
                !/\.(test|spec)\.(js|ts)$/.test(e.name)
            )
            .map((e) => `src/${e.name}`);

          if (candidates.length > 0) {
            candidates.sort((a, b) => rankFile(a) - rankFile(b));
            resolved = candidates[0];
          }
        } catch {
          // src directory might not exist
        }
      }

      if (!resolved) {
        const allFiles = await collectSourceFiles(repoPath, repoPath);
        if (allFiles.length > 0) {
          allFiles.sort((a, b) => rankFile(a) - rankFile(b));
          resolved = allFiles[0];
        }
      }

      if (!resolved) resolved = '';

      if (pkg.main !== resolved) {
        pkg.main = resolved;
        changed = true;
        Logger.info(`Updated "main" to "${resolved}" in ${relativePath}`);
      }
    }

    // 6. type
    if (repoType === 'active' && pkg.type !== 'module') {
      pkg.type = 'module';
      changed = true;
      Logger.info(`Updated "type" to "module" in ${relativePath}`);
    } else if (repoType === 'legacy' && !pkg.type) {
      pkg.type = 'commonjs';
      changed = true;
      Logger.info(`Added missing "type" as "commonjs" in ${relativePath}`);
    }

    // 7. files
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
      Logger.info(`Updated "files" section in ${relativePath}`);
    }

    // 8. repository, homepage, bugs
    const expectedRepoUrl = `git://github.com/orassayag/${repoName}.git`;
    if (
      !pkg.repository ||
      pkg.repository.type !== 'git' ||
      pkg.repository.url !== expectedRepoUrl
    ) {
      pkg.repository = { type: 'git', url: expectedRepoUrl };
      changed = true;
      Logger.info(`Updated "repository" in ${relativePath}`);
    }

    const expectedHomepage = `https://github.com/orassayag/${repoName}#readme`;
    if (pkg.homepage !== expectedHomepage) {
      pkg.homepage = expectedHomepage;
      changed = true;
      Logger.info(`Updated "homepage" in ${relativePath}`);
    }

    const expectedBugsUrl = `https://github.com/orassayag/${repoName}/issues`;
    if (!pkg.bugs || pkg.bugs.url !== expectedBugsUrl) {
      pkg.bugs = { url: expectedBugsUrl };
      changed = true;
      Logger.info(`Updated "bugs" in ${relativePath}`);
    }

    // 9. scripts
    if (!pkg.scripts) {
      pkg.scripts = {};
      changed = true;
      Logger.info(`Created missing "scripts" as empty in ${relativePath}`);
    }
    // If it exists, we don't touch it as per user requirement.

    // 10. dependencies and devDependencies
    if (repoType === 'active') {
      if (!pkg.dependencies && templatePkg.dependencies) {
        pkg.dependencies = JSON.parse(JSON.stringify(templatePkg.dependencies));
        // Fetch dynamic versions
        for (const dep of Object.keys(pkg.dependencies)) {
          pkg.dependencies[dep] = getLatestVersion(dep);
        }
        changed = true;
        Logger.info(`Added missing "dependencies" in ${relativePath}`);
      } else if (pkg.dependencies) {
        const depKeys = Object.keys(pkg.dependencies);
        const sortedDepKeys = [...depKeys].sort();
        if (JSON.stringify(depKeys) !== JSON.stringify(sortedDepKeys)) {
          const sortedDeps: Record<string, string> = {};
          sortedDepKeys.forEach((k) => {
            sortedDeps[k] = pkg.dependencies[k];
          });
          pkg.dependencies = sortedDeps;
          changed = true;
          Logger.info(`Sorted "dependencies" in ${relativePath}`);
        }
      }

      if (!pkg.devDependencies && templatePkg.devDependencies) {
        pkg.devDependencies = JSON.parse(
          JSON.stringify(templatePkg.devDependencies)
        );
        // Fetch dynamic versions
        for (const dep of Object.keys(pkg.devDependencies)) {
          pkg.devDependencies[dep] = getLatestVersion(dep);
        }
        changed = true;
        Logger.info(`Added missing "devDependencies" in ${relativePath}`);
      } else if (pkg.devDependencies) {
        const devDepKeys = Object.keys(pkg.devDependencies);
        const sortedDevDepKeys = [...devDepKeys].sort();
        if (JSON.stringify(devDepKeys) !== JSON.stringify(sortedDevDepKeys)) {
          const sortedDevDeps: Record<string, string> = {};
          sortedDevDepKeys.forEach((k) => {
            sortedDevDeps[k] = pkg.devDependencies[k];
          });
          pkg.devDependencies = sortedDevDeps;
          changed = true;
          Logger.info(`Sorted "devDependencies" in ${relativePath}`);
        }
      }
    } else if (repoType === 'legacy') {
      if (!pkg.dependencies) {
        pkg.dependencies = {};
        changed = true;
        Logger.info(`Added missing "dependencies" in ${relativePath}`);
      }
      if (!pkg.devDependencies) {
        pkg.devDependencies = {};
        changed = true;
        Logger.info(`Added missing "devDependencies" in ${relativePath}`);
      }
    }

    // 11. Overall key sorting
    const keys = Object.keys(pkg);
    const sortedPkg: any = {};
    const importantKeys = [
      'name',
      'version',
      'description',
      'type',
      'private',
      'repository',
      'keywords',
      'main',
      'scripts',
      'author',
      'contributors',
      'files',
      'license',
      'bugs',
      'funding',
      'homepage',
      'engines',
      'dependencies',
      'devDependencies',
    ];

    const finalKeys = [
      ...importantKeys.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !importantKeys.includes(k)).sort(),
    ];

    if (JSON.stringify(keys) !== JSON.stringify(finalKeys)) {
      finalKeys.forEach((k) => {
        sortedPkg[k] = pkg[k];
      });
      changed = true;
      Logger.info(`Sorted keys in ${relativePath}`);
    }

    if (changed) {
      if (settings.DRY_RUN) {
        Logger.log(`🔍 [DRY RUN] Would update ${relativePath}`);
        return false;
      }
      await fs.writeFile(
        pkgPath,
        JSON.stringify(
          Object.keys(sortedPkg).length > 0 ? sortedPkg : pkg,
          null,
          2
        ) + '\n',
        'utf-8'
      );
    }

    return changed;
  } catch (err) {
    Logger.warn(`Could not fix ${relativePath}: ${(err as Error).message}`);
    return false;
  }
}
