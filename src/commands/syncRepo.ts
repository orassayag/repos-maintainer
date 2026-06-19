import fs from 'fs/promises';
import { existsSync } from 'fs';
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
import { fixReadme } from '../fixers/readmeFixer.js';
import { syncTemplateFiles } from '../utils/fileFixer.js';
import { TEMPLATE_FILES } from '../fixers/standardizer.js';
import { Scanner } from '../utils/scanner.js';
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
  Logger.setContext('SyncRepo');
  Logger.debug('Starting syncRepoCommand');
  Logger.log('\nSync Repo:');
  Logger.log('==========\n');

  const selectedRepo = await selectRepo();
  if (!selectedRepo) {
    Logger.debug('No repository selected, returning null');
    return null;
  }

  Logger.debug('Repository selected', selectedRepo);

  const repoPath = getLocalRepoPath(selectedRepo.name);
  const rootPkgPath = path.join(repoPath, 'package.json');
  let parsed = parseGitHubUrl(selectedRepo.url);

  // Fallback: If no valid URL, assume default owner and use the repo name
  if (!parsed) {
    parsed = { owner: settings.AUTHOR_GITHUB, repo: selectedRepo.name };
    Logger.debug('Fallback parsed owner/repo', parsed);
  }

  try {
    // 1. Ensure repo is cloned and up to date
    // If we have a URL, use it; otherwise, construct one
    const repoUrl =
      selectedRepo.url || `https://github.com/${parsed.owner}/${parsed.repo}`;

    Logger.debug(`Ensuring repo is cloned: ${repoUrl}`);

    // Verify the repo exists on GitHub if we want to sync topics
    const existsOnGitHub = await repoExists(parsed.owner, parsed.repo);
    if (!existsOnGitHub) {
      Logger.debug(
        `Repository ${parsed.owner}/${parsed.repo} not found on GitHub`
      );
      Logger.warn(
        `Repository ${parsed.owner}/${parsed.repo} not found on GitHub. GitHub sync will be skipped.`
      );
    }

    const cloned = await ensureRepoCloned(repoUrl, selectedRepo.name);
    if (!cloned) {
      Logger.error(`Failed to ensure repo is cloned: ${selectedRepo.name}`);
      return null;
    }

    Logger.debug('Repo is cloned and ready');

    const isTraining = selectedRepo.purpose === 'training';
    const isMulti = selectedRepo.structure === 'multi';

    // 0. Identify all package.json files
    let pkgPaths: string[] = [];
    if (!isTraining) {
      if (isMulti) {
        const scanner = new Scanner();
        pkgPaths = await scanner.findMultiPackageJsonPaths(repoPath);
        if (pkgPaths.length === 0) {
          Logger.warn('No package.json files found in multi-structure project');
        }
      } else if (existsSync(rootPkgPath)) {
        pkgPaths = [rootPkgPath];
      }
    }

    let firstPkg: any = null;
    let changed = false;

    // 2. Validate and fix descriptions
    Logger.log('🔍 Validating descriptions...');

    for (const pkgPath of pkgPaths) {
      const relativePkgPath = path.relative(repoPath, pkgPath);
      let pkg: any;
      try {
        const pkgContent = await fs.readFile(pkgPath, 'utf-8');
        pkg = JSON.parse(pkgContent);
      } catch (err) {
        Logger.error(
          `Could not read ${relativePkgPath}: ${(err as Error).message}`
        );
        continue;
      }

      if (!firstPkg) firstPkg = pkg;

      // A. package.json description
      const pkgDesc = pkg.description || '';
      const pkgDescValidation = validatePackageDescription(pkgDesc);
      if (pkgDescValidation !== true) {
        Logger.warn(`${relativePkgPath}: ${pkgDescValidation}`);
        const newPkgDesc = await input({
          message: `Enter description for ${relativePkgPath} (290-300 characters):`,
          validate: validatePackageDescription,
        });
        pkg.description = newPkgDesc;
        changed = true;
        await fs.writeFile(
          pkgPath,
          JSON.stringify(pkg, null, 2) + '\n',
          'utf-8'
        );
        Logger.success(`Updated ${relativePkgPath} description`);
      }

      // D. package.json keywords (moved here to be inside the loop)
      const keywords = pkg.keywords || [];
      const keywordsValidation = validateKeywords(keywords);
      if (keywordsValidation !== true) {
        Logger.warn(`${relativePkgPath} keywords: ${keywordsValidation}`);
        const newKeywordsStr = await input({
          message: `Enter keywords / topics for ${relativePkgPath} (comma separated, 8-20 unique items):`,
          validate: validateKeywordsInput,
        });
        pkg.keywords = parseKeywordsString(newKeywordsStr);
        changed = true;
        await fs.writeFile(
          pkgPath,
          JSON.stringify(pkg, null, 2) + '\n',
          'utf-8'
        );
        Logger.success(`Updated ${relativePkgPath} keywords`);
      }
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
          message: 'Enter description for README.md (500-600 characters):',
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

    // 3. Sync Keywords & Standardize package.json

    // A. Keyword Sync (GitHub) - Use the first package.json for sync
    if (
      !isTraining &&
      firstPkg &&
      firstPkg.keywords &&
      Array.isArray(firstPkg.keywords)
    ) {
      const keywords = firstPkg.keywords;
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
    const templateChanges = await syncTemplateFiles(
      repoPath,
      TEMPLATE_FILES,
      isTraining,
      selectedRepo.type === 'active',
      isMulti
    );
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

    // B.1 Sync sub-project template files (ESLint, Prettier, knip.json)
    if (isMulti && !isTraining) {
      Logger.log('📄 Syncing sub-project template files...');
      for (const pkgPath of pkgPaths) {
        const pkgDir = path.dirname(pkgPath);
        const relDir = path.relative(repoPath, pkgDir);
        const subTemplateChanges = await syncTemplateFiles(
          pkgDir,
          ['eslint.config.mjs', '.prettierrc', 'knip.json'],
          isTraining,
          selectedRepo.type === 'active',
          true
        );
        if (subTemplateChanges.length > 0) {
          changed = true;
          subTemplateChanges.forEach((change) => {
            Logger.success(`  - [${relDir}] ${change}`);
          });
        }
      }
    }

    // B.2 Sync ESLint packages if flat config exists
    if (!isTraining) {
      Logger.log('🔍 Checking for missing ESLint packages...');
      for (const pkgPath of pkgPaths) {
        const pkgDir = path.dirname(pkgPath);
        const hasFlatConfig = existsSync(
          path.join(pkgDir, 'eslint.config.mjs')
        );
        if (hasFlatConfig) {
          const pkgContent = await fs.readFile(pkgPath, 'utf-8');
          const pkg = JSON.parse(pkgContent);
          let pkgChanged = false;

          const required = {
            'eslint-config-prettier': '^10.1.8',
            'typescript-eslint': '^8.60.1',
          };

          for (const [name, version] of Object.entries(required)) {
            if (!pkg.devDependencies?.[name] && !pkg.dependencies?.[name]) {
              if (!pkg.devDependencies) pkg.devDependencies = {};
              pkg.devDependencies[name] = version;
              pkgChanged = true;
              Logger.success(
                `  - Added ${name}@${version} to ${path.relative(
                  repoPath,
                  pkgPath
                )}`
              );
            }
          }

          if (pkgChanged) {
            await fs.writeFile(
              pkgPath,
              JSON.stringify(pkg, null, 2) + '\n',
              'utf-8'
            );
            changed = true;
          }
        }
      }
    }

    // C. Sync Documentation (README.md only)
    Logger.log('📝 Syncing documentation sections...');
    const readmeChanged = await fixReadme(repoPath);
    if (readmeChanged) changed = true;

    // D. Final package.json fix and sort
    if (!isTraining) {
      for (const pkgPath of pkgPaths) {
        const relativePkgPath = path.relative(repoPath, pkgPath);
        const pkgDir = path.dirname(pkgPath);
        const pkgFixed = await fixPackageJson(
          pkgDir,
          selectedRepo.name,
          relativePkgPath,
          selectedRepo.type
        );
        if (pkgFixed) changed = true;

        // Sort each package.json
        Logger.log(`🧹 Sorting ${relativePkgPath}...`);
        try {
          // Run in the package directory and use relative path to avoid Windows absolute path issues
          execSync('npx --yes sort-package-json package.json', {
            cwd: pkgDir,
            stdio: 'ignore',
          });
          changed = true;
        } catch (err) {
          Logger.error(
            `Failed to sort ${relativePkgPath}: ${(err as Error).message}`
          );
        }
      }
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
