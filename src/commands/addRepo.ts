import fs from 'fs/promises';
import path from 'path';
import { input, select } from '../utils/prompts.js';
import {
  parseGitHubUrl,
  repoExists,
  isRepoEmpty,
  updateRepoMetadata,
  replaceTopics,
  starRepo,
  watchRepo,
} from '../github.js';
import { Logger } from '../utils/logger.js';
import { ensureRepoCloned, commitAndPush, runGitClean } from '../utils/git.js';
import {
  ensureTemplateFile,
  getChangelogCommitMessage,
} from '../utils/fileFixer.js';
import { injectPackageJson } from '../fixers/packageJsonFixer.js';
import { runPnpmInstall } from '../utils/pnpm.js';
import { settings, getLocalRepoPath } from '../settings.js';
import { addOrUpdateRepoInList } from '../utils/repoList.js';
import { fixReadme } from '../fixers/readmeFixer.js';
import { fixRulesets } from '../fixers/rulesetsFixer.js';
import {
  validateGitHubDescription,
  validatePackageDescription,
  validateKeywordsInput,
  parseKeywordsString,
} from '../utils/description.js';

/**
 * Interactive "Add Repo" command.
 * Prompts for a GitHub URL, validates it, verifies the repo exists,
 * asks for descriptions and keywords, then runs full standardization.
 */
export async function addRepoCommand(): Promise<{
  name: string;
  url: string;
} | null> {
  Logger.setContext('AddRepo');
  Logger.debug('Starting addRepoCommand');
  Logger.log('\nAdd Repo:');
  Logger.log('=========\n');

  // 1. URL Validation
  let repoUrl = '';
  let parsed: { owner: string; repo: string } | null = null;

  while (true) {
    repoUrl = (
      await input({
        message: 'Enter the GitHub repository URL:',
        validate: (value: string): string | boolean => {
          if (!value.trim()) return 'URL is required';
          return true;
        },
      })
    ).trim();

    Logger.debug(`User entered URL: ${repoUrl}`);

    // Remove .git suffix if present
    if (repoUrl.toLowerCase().endsWith('.git')) {
      repoUrl = repoUrl.slice(0, -4);
      Logger.debug(`Stripped .git suffix: ${repoUrl}`);
    }

    parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      Logger.error('Invalid GitHub URL format.', { repoUrl });
      Logger.log(
        'Please enter a valid GitHub repository URL (e.g., https://github.com/owner/repo).\n'
      );
      continue;
    }

    Logger.debug('Parsed GitHub URL', parsed);

    // Verify the repo exists on GitHub
    Logger.log(
      `🔍 Checking if ${parsed.owner}/${parsed.repo} exists on GitHub...`
    );
    const exists = await repoExists(parsed.owner, parsed.repo);
    if (!exists) {
      Logger.error(`Repository not found: ${parsed.owner}/${parsed.repo}`, {
        owner: parsed.owner,
        repo: parsed.repo,
      });
      Logger.log("Please enter the repo's URL once it's created.\n");
      continue;
    }

    // New Validation: Check if the repository is empty
    Logger.debug('Checking if repository is empty...');
    const isEmpty = await isRepoEmpty(parsed.owner, parsed.repo);
    if (!isEmpty) {
      Logger.error(`Repository ${parsed.owner}/${parsed.repo} is not empty!`, {
        owner: parsed.owner,
        repo: parsed.repo,
      });
      Logger.log('The "Add Repo" flow requires a fresh, empty repository.');
      Logger.log('Returning to main menu...\n');
      return null; // Back to main menu
    }

    Logger.debug('Repository validation passed');
    break;
  }

  // 2. Descriptions
  const packageDesc = await input({
    message: 'Enter description for package.json (290-300 characters):',
    validate: validatePackageDescription,
  });

  const githubDesc = await input({
    message: 'Enter description for GitHub project (340-350 characters):',
    validate: validateGitHubDescription,
  });

  // 3. Keywords / Topics
  const keywordsStr = await input({
    message: 'Enter keywords / topics (comma separated, 8-20 unique items):',
    validate: validateKeywordsInput,
  });
  const keywords = parseKeywordsString(keywordsStr);

  // 4. Purpose and Structure
  const purpose = await select<'personal' | 'training'>({
    message: 'Select the purpose type:',
    choices: [
      {
        name: 'personal - One standard project with the standard structure. It will be validated normally.',
        value: 'personal',
      },
      {
        name: 'training - Multiple projects with separate folders; package.json validations will be skipped.',
        value: 'training',
      },
    ],
  });

  const structure = await select<'single' | 'multi'>({
    message: 'Select the structure type:',
    choices: [
      {
        name: 'single - One standard project with the standard structure. It will be validated normally.',
        value: 'single',
      },
      {
        name: 'multi - Multiple projects with separate folders; each package.json file in each folder will be validated, usually for full-stack projects that have a backend, client, and/or additional services.',
        value: 'multi',
      },
    ],
  });

  Logger.log('\n🚀 Starting repository standardization and setup...\n');

  const repoName = parsed.repo;
  const repoPath = getLocalRepoPath(repoName);

  try {
    // 1. Clone/Pull Repo
    const cloned = await ensureRepoCloned(repoUrl, repoName);
    if (!cloned) {
      Logger.error(`Failed to clone/pull repository: ${repoName}`);
      return null;
    }

    // 2. Update Repo List
    await addOrUpdateRepoInList(repoName, repoUrl, purpose, structure);

    // 3. Template Injection
    Logger.log('📄 Injecting standard templates...');
    const templates = [
      'LICENSE',
      'SECURITY.md',
      'CODE_OF_CONDUCT.md',
      'CONTRIBUTING.md',
      'CHANGELOG.md',
      '.gitignore',
      'README.md',
      'INSTRUCTIONS.md',
      '.prettierrc',
      'eslint.config.mjs',
      'tsconfig.json',
      'tsconfig.node.json',
      'vitest.config.ts',
      'src/index.ts',
      '.github/rulesets/main-protection.json',
      '.vscode/settings.json',
    ];

    for (const template of templates) {
      await ensureTemplateFile(repoPath, template, true);
    }

    // Create empty misc folder
    try {
      await fs.mkdir(path.join(repoPath, 'misc'), { recursive: true });
    } catch (err) {
      Logger.warn(`Failed to create misc folder: ${(err as Error).message}`);
    }

    Logger.success('Created all the template files and folders');

    // 4. package.json Injection
    const pkgInjected = await injectPackageJson(
      repoPath,
      repoName,
      packageDesc,
      keywords
    );
    if (!pkgInjected) {
      Logger.error('Failed to inject package.json');
      return null;
    }

    // 5. pnpm install
    const pnpmSuccess = await runPnpmInstall(repoPath);
    if (!pnpmSuccess) {
      Logger.error('pnpm install failed');
      return null;
    }

    // 6. fix README
    await fixReadme(repoPath);

    // 7. Update GitHub Metadata
    Logger.log('🌐 Updating GitHub repository metadata...');
    await updateRepoMetadata(parsed.owner, parsed.repo, {
      description: githubDesc,
      homepage: settings.DEFAULT_HOMEPAGE,
    });
    await replaceTopics(parsed.owner, parsed.repo, keywords);

    // 8. fix Rulesets
    await fixRulesets(parsed.owner, parsed.repo);

    // 9. Star & Watch
    try {
      await starRepo(parsed.owner, parsed.repo);
      await watchRepo(parsed.owner, parsed.repo);
    } catch (err) {
      Logger.warn(`Failed to star/watch repo: ${(err as Error).message}`);
    }

    // 10. Final Commit & Push
    const commitMsg = (await getChangelogCommitMessage(repoPath)) ?? undefined;
    const pushed = await commitAndPush(repoPath, commitMsg);

    // 11. Git clean (if enabled)
    if (settings.GIT_CLEAN_ENABLED) {
      try {
        await runGitClean(repoPath);
      } catch (err) {
        Logger.warn(`Git clean failed: ${(err as Error).message}`);
      }
    }

    if (pushed) {
      Logger.success(`Successfully added and standardized ${repoName}!`);
      Logger.log(
        `⚠️ Please replace the README.md file and the INSTRUCTIONS.md with real files (Ask your AI to generate ones according to the current structure).`
      );
      return { name: repoName, url: repoUrl };
    } else {
      Logger.warn(
        '\n⚠️  Standardization complete, but could not push changes.'
      );
      return null;
    }
  } catch (err) {
    Logger.error(`An unexpected error occurred: ${(err as Error).message}`);
    return null;
  }
}
