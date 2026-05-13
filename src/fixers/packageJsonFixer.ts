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
    // Search for src/index.ts, src/index.js, or root index/main
    const mainCandidates = [
      { path: 'src/index.ts', main: 'dist/index.js' },
      { path: 'src/index.js', main: 'dist/index.js' },
      { path: 'src/main.ts', main: 'dist/main.js' },
      { path: 'src/main.js', main: 'dist/main.js' },
      { path: 'index.ts', main: 'dist/index.js' },
      { path: 'index.js', main: 'index.js' },
      { path: 'main.js', main: 'main.js' },
    ];

    let currentMainValid = false;
    if (pkg.main) {
      try {
        const mainPath = path.join(repoPath, pkg.main);
        await fs.access(mainPath);
        currentMainValid = true;
      } catch {
        // If it doesn't exist, maybe it's a dist file that hasn't been built yet.
        // Check if it's a standard dist path and the src equivalent exists.
        if (pkg.main.startsWith('dist/')) {
          const srcPath = path.join(
            repoPath,
            pkg.main.replace('dist/', 'src/').replace('.js', '.ts')
          );
          try {
            await fs.access(srcPath);
            currentMainValid = true;
          } catch {
            // Try .js as well for src
            try {
              await fs.access(srcPath.replace('.ts', '.js'));
              currentMainValid = true;
            } catch {}
          }
        }
      }
    }

    if (!currentMainValid) {
      for (const candidate of mainCandidates) {
        try {
          await fs.access(path.join(repoPath, candidate.path));
          if (pkg.main !== candidate.main) {
            pkg.main = candidate.main;
            changed = true;
            Logger.info(`Updated "main" to ${candidate.main}`);
          }
          currentMainValid = true;
          break;
        } catch {}
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
