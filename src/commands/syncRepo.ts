import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { Logger } from '../utils/logger.js';
import { selectRepo } from '../utils/repoSelector.js';
import { ensureRepoCloned } from '../utils/git.js';
import { replaceTopics, parseGitHubUrl, repoExists } from '../github.js';
import { settings, getLocalRepoPath } from '../settings.js';
import { fixPackageJson } from '../fixers/packageJsonFixer.js';
import { fixReadme, fixInstructions } from '../fixers/readmeFixer.js';
import { syncTemplateFiles } from '../utils/fileFixer.js';
import { TEMPLATE_FILES } from '../fixers/standardizer.js';

/**
 * Syncs a repository's package.json with its GitHub metadata and local file system.
 * 1. Limits keywords to max 20 and syncs them to GitHub topics.
 * 2. Standardizes package.json fields (funding, engines, author, main, type, files).
 */
export async function syncRepoCommand(): Promise<{
  name: string;
  url: string;
} | null> {
  Logger.log('\nSync Repo:');
  Logger.log('==========\n');

  const selectedRepo = await selectRepo();
  if (!selectedRepo) return null;

  const repoPath = getLocalRepoPath(selectedRepo.name);
  let parsed = parseGitHubUrl(selectedRepo.url);

  // Fallback: If no valid URL, assume default owner and use the repo name
  if (!parsed) {
    parsed = { owner: settings.AUTHOR_GITHUB, repo: selectedRepo.name };
  }

  try {
    // 1. Ensure repo is cloned and up to date
    // If we have a URL, use it; otherwise, construct one
    const repoUrl =
      selectedRepo.url || `https://github.com/${parsed.owner}/${parsed.repo}`;

    // Verify the repo exists on GitHub if we want to sync topics
    const existsOnGitHub = await repoExists(parsed.owner, parsed.repo);
    if (!existsOnGitHub) {
      Logger.warn(
        `Repository ${parsed.owner}/${parsed.repo} not found on GitHub. GitHub sync will be skipped.`
      );
    }

    const cloned = await ensureRepoCloned(repoUrl, selectedRepo.name);
    if (!cloned) return null;

    const pkgPath = path.join(repoPath, 'package.json');
    let pkg;
    try {
      const pkgContent = await fs.readFile(pkgPath, 'utf-8');
      pkg = JSON.parse(pkgContent);
    } catch (err) {
      Logger.error(`Could not read package.json: ${(err as Error).message}`);
      return null;
    }

    // 2. Sync Keywords & Standardize package.json
    let changed = false;

    // A. Keyword Sync (GitHub)
    if (pkg.keywords && Array.isArray(pkg.keywords)) {
      let keywords = pkg.keywords;
      if (keywords.length > 20) {
        Logger.info(`Reducing keywords from ${keywords.length} to 20...`);
        keywords = keywords.slice(0, 20);
        pkg.keywords = keywords;
        changed = true;
      }

      if (existsOnGitHub) {
        Logger.log('🌐 Syncing GitHub topics with package.json keywords...');
        try {
          await replaceTopics(parsed.owner, parsed.repo, keywords);
          Logger.success(`Synced ${keywords.length} topics to GitHub`);
        } catch (err) {
          Logger.error(
            `Failed to sync topics to GitHub: ${(err as Error).message}`
          );
        }
      }
    }

    // B. Sync Template Files (.gitignore, LICENSE, and other missing files)
    Logger.log('📄 Syncing template files...');
    const templateChanges = await syncTemplateFiles(repoPath, TEMPLATE_FILES);
    if (templateChanges.length > 0) {
      changed = true;
      templateChanges.forEach((change) => {
        if (change.startsWith('Unable to update')) {
          Logger.warn(`  - ${change}`);
        } else {
          Logger.success(`  - ${change}`);
        }
      });
    }

    // C. Sync Documentation (README.md, INSTRUCTIONS.md)
    Logger.log('📝 Syncing documentation sections...');
    const readmeChanged = await fixReadme(repoPath);
    if (readmeChanged) {
      changed = true;
      Logger.success('  - Updated README.md sections');
    }

    const instructionsChanged = await fixInstructions(repoPath);
    if (instructionsChanged) {
      changed = true;
      Logger.success('  - Updated INSTRUCTIONS.md section');
    }

    // D. Standardize package.json (funding, engines, contributors, author, main, type, files)
    if (changed) {
      // If keywords or templates changed, write them first so fixPackageJson sees the update
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    }

    const pkgFixed = await fixPackageJson(repoPath, selectedRepo.name);
    if (pkgFixed) {
      changed = true;
    }

    // D. Sort package.json
    Logger.log('🧹 Sorting package.json...');
    try {
      execSync('npx --yes sort-package-json', {
        cwd: repoPath,
        stdio: 'ignore',
      });
      // We assume it might have changed something if it ran successfully
      // or we could check if it actually changed, but the instruction just says "fix it by running"
      changed = true;
    } catch (err) {
      Logger.error(`Failed to sort package.json: ${(err as Error).message}`);
    }

    if (changed) {
      Logger.success('Updated project');
      Logger.log(
        '\n⚠️ Successfully sync the project, you should manually commit and push the changes on the project'
      );
    } else {
      Logger.log('✨ No changes needed for package.json.');
    }

    Logger.success(`Sync completed for ${selectedRepo.name}!`);
    return selectedRepo;
  } catch (err) {
    Logger.error(`Sync failed: ${(err as Error).message}`);
    return null;
  }
}
