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
export async function fixPackageJson(repoPath: string): Promise<boolean> {
  const pkgPath = path.join(repoPath, 'package.json');

  try {
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);

    let changed = false;

    // Ensure author field
    const expectedAuthor = `${settings.AUTHOR_NAME} <${settings.AUTHOR_EMAIL}>`;
    if (!pkg.author || pkg.author !== expectedAuthor) {
      pkg.author = expectedAuthor;
      changed = true;
    }

    // Ensure contributors array
    const expectedContributor = {
      name: settings.AUTHOR_NAME,
      email: settings.AUTHOR_EMAIL,
      url: `https://github.com/${settings.AUTHOR_GITHUB}`,
    };

    if (!pkg.contributors || !Array.isArray(pkg.contributors)) {
      pkg.contributors = [expectedContributor];
      changed = true;
    } else {
      const hasContributor = pkg.contributors.some(
        (c: Record<string, string>) => c.email === settings.AUTHOR_EMAIL
      );
      if (!hasContributor) {
        pkg.contributors.push(expectedContributor);
        changed = true;
      }
    }

    if (changed) {
      if (settings.DRY_RUN) {
        Logger.info('[DRY RUN] Would fix package.json author/contributors');
        return false;
      }
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      Logger.success('Fixed package.json: author/contributors');
      return true;
    }

    return false;
  } catch (err) {
    Logger.warn(`Could not fix package.json: ${(err as Error).message}`);
    return false;
  }
}
