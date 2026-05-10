import fs from 'fs/promises';
import path from 'path';
import { Logger } from '../utils/logger.js';
import { selectRepo } from '../utils/repoSelector.js';
import { ensureRepoCloned } from '../utils/git.js';
import { replaceTopics, parseGitHubUrl, repoExists } from '../github.js';
import { settings, getLocalRepoPath } from '../settings.js';

/**
 * Syncs a repository's package.json with its GitHub metadata and local file system.
 * 1. Limits keywords to max 20 and syncs them to GitHub topics.
 * 2. Syncs the "files" section in package.json with the actual root-level files and folders.
 */
export async function syncRepoCommand(): Promise<void> {
  Logger.log('\nSync Repo:');
  Logger.log('==========\n');

  const selectedRepo = await selectRepo();
  if (!selectedRepo) return;

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
    if (!cloned) return;

    const pkgPath = path.join(repoPath, 'package.json');
    let pkg;
    try {
      const pkgContent = await fs.readFile(pkgPath, 'utf-8');
      pkg = JSON.parse(pkgContent);
    } catch (err) {
      Logger.error(`Could not read package.json: ${(err as Error).message}`);
      return;
    }

    let changed = false;

    // 2. Sync Keywords
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

    // 3. Sync Files section
    Logger.log(
      '📁 Syncing package.json "files" section with root directory...'
    );
    const rootEntries = await fs.readdir(repoPath, { withFileTypes: true });

    // Filtering out .git and node_modules, and sorting: folders first, then files, both alphabetically
    const sortedRootItems = rootEntries
      .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
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
    const isIdentical =
      pkgFiles.length === sortedRootItems.length &&
      pkgFiles.every(
        (file: string, index: number) => file === sortedRootItems[index]
      );

    if (!isIdentical) {
      pkg.files = sortedRootItems;
      changed = true;
      Logger.info(`Updated "files" section in package.json`);
    } else {
      Logger.log('✅ "files" section is already synced and sorted.');
    }

    if (changed) {
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      Logger.success('Updated package.json');
      Logger.log(
        '\n⚠️ Successfully sync the project, you should manually commit and push the changes on the project'
      );
    } else {
      Logger.log('✨ No changes needed for package.json.');
    }

    Logger.success(`Sync completed for ${selectedRepo.name}!`);
  } catch (err) {
    Logger.error(`Sync failed: ${(err as Error).message}`);
  }
}
