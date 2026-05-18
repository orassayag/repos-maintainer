import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { Logger } from '../utils/logger.js';
import { selectRepo } from '../utils/repoSelector.js';
import { ensureRepoCloned } from '../utils/git.js';
import {
  replaceTopics,
  parseGitHubUrl,
  repoExists,
  getRepoMetadata,
  updateRepoMetadata,
} from '../github.js';
import { settings, getLocalRepoPath } from '../settings.js';
import { fixPackageJson } from '../fixers/packageJsonFixer.js';
import { fixReadme, fixInstructions } from '../fixers/readmeFixer.js';
import { syncTemplateFiles } from '../utils/fileFixer.js';
import { TEMPLATE_FILES } from '../fixers/standardizer.js';
import { input } from '../utils/prompts.js';
import {
  extractReadmeDescription,
  updateReadmeDescription,
  validateGitHubDescription,
  validatePackageDescription,
  validateReadmeDescription,
  validateKeywords,
  validateKeywordsInput,
  parseKeywordsString,
} from '../utils/description.js';

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
    let pkg: any;
    try {
      const pkgContent = await fs.readFile(pkgPath, 'utf-8');
      pkg = JSON.parse(pkgContent);
    } catch (err) {
      Logger.error(`Could not read package.json: ${(err as Error).message}`);
      return null;
    }

    // 2. Validate and fix descriptions
    Logger.log('🔍 Validating descriptions...');
    let changed = false;

    // A. package.json description
    const pkgDesc = pkg.description || '';
    const pkgDescValidation = validatePackageDescription(pkgDesc);
    if (pkgDescValidation !== true) {
      Logger.warn(`package.json: ${pkgDescValidation}`);
      const newPkgDesc = await input({
        message: 'Enter description for package.json (290-300 characters):',
        validate: validatePackageDescription,
      });
      pkg.description = newPkgDesc;
      changed = true;
    }

    // B. README.md description
    const readmePath = path.join(repoPath, 'README.md');
    try {
      const readmeContent = await fs.readFile(readmePath, 'utf-8');
      const readmeDesc = extractReadmeDescription(readmeContent);
      const readmeDescValidation = validateReadmeDescription(readmeDesc);
      if (readmeDescValidation !== true) {
        Logger.warn(`README.md: ${readmeDescValidation}`);
        const newReadmeDesc = await input({
          message: 'Enter description for README.md (300-600 characters):',
          validate: validateReadmeDescription,
        });
        const updatedReadmeContent = updateReadmeDescription(
          readmeContent,
          newReadmeDesc,
          selectedRepo.name
        );
        await fs.writeFile(readmePath, updatedReadmeContent, 'utf-8');
        changed = true;
        Logger.success('Updated README.md description');
      }
    } catch (err) {
      Logger.warn(
        `Could not validate README.md description: ${(err as Error).message}`
      );
    }

    // C. GitHub description
    if (existsOnGitHub) {
      try {
        const githubMetadata = await getRepoMetadata(parsed.owner, parsed.repo);
        if (githubMetadata) {
          const githubDesc = githubMetadata.description || '';
          const githubDescValidation = validateGitHubDescription(githubDesc);
          if (githubDescValidation !== true) {
            Logger.warn(`GitHub: ${githubDescValidation}`);
            const newGithubDesc = await input({
              message:
                'Enter description for GitHub project (340-350 characters):',
              validate: validateGitHubDescription,
            });
            await updateRepoMetadata(parsed.owner, parsed.repo, {
              description: newGithubDesc,
            });
            Logger.success('Updated GitHub repository description');
          }
        }
      } catch (err) {
        Logger.warn(
          `Could not validate GitHub description: ${(err as Error).message}`
        );
      }
    }

    // D. package.json keywords
    const keywords = pkg.keywords || [];
    const keywordsValidation = validateKeywords(keywords);
    if (keywordsValidation !== true) {
      Logger.warn(`package.json keywords: ${keywordsValidation}`);
      const newKeywordsStr = await input({
        message:
          'Enter keywords / topics (comma separated, 8-20 unique items):',
        validate: validateKeywordsInput,
      });
      pkg.keywords = parseKeywordsString(newKeywordsStr);
      changed = true;
    }

    // 3. Sync Keywords & Standardize package.json

    // A. Keyword Sync (GitHub)
    if (pkg.keywords && Array.isArray(pkg.keywords)) {
      const keywords = pkg.keywords;
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
