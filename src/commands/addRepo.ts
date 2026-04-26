import { input } from '../utils/prompts.js';
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

/**
 * Interactive "Add Repo" command.
 * Prompts for a GitHub URL, validates it, verifies the repo exists,
 * asks for descriptions and keywords, then runs full standardization.
 */
export async function addRepoCommand(): Promise<void> {
  Logger.log('\nAdd Repo:');
  Logger.log('=========\n');

  // 1. URL Validation
  let repoUrl = '';
  let parsed: { owner: string; repo: string } | null = null;

  while (true) {
    repoUrl = await input({
      message: 'Enter the GitHub repository URL:',
      validate: (value: string): string | boolean => {
        if (!value.trim()) return 'URL is required';
        return true;
      },
    });

    parsed = parseGitHubUrl(repoUrl.trim());
    if (!parsed) {
      Logger.error('Invalid GitHub URL format.');
      Logger.log(
        'Please enter a valid GitHub repository URL (e.g., https://github.com/owner/repo).\n'
      );
      continue;
    }

    // Verify the repo exists on GitHub
    Logger.log(
      `🔍 Checking if ${parsed.owner}/${parsed.repo} exists on GitHub...`
    );
    const exists = await repoExists(parsed.owner, parsed.repo);
    if (!exists) {
      Logger.error(`Repository not found: ${parsed.owner}/${parsed.repo}`);
      Logger.log("Please enter the repo's URL once it's created.\n");
      continue;
    }

    // New Validation: Check if the repository is empty
    const isEmpty = await isRepoEmpty(parsed.owner, parsed.repo);
    if (!isEmpty) {
      Logger.error(`Repository ${parsed.owner}/${parsed.repo} is not empty!`);
      Logger.log('The "Add Repo" flow requires a fresh, empty repository.');
      Logger.log('Returning to main menu...\n');
      return; // Back to main menu
    }

    break;
  }

  // 2. Descriptions
  const packageDesc = await input({
    message: 'Enter description for package.json (120-300 characters):',
    validate: (val) => {
      const len = val.trim().length;
      if (len < 120 || len > 300)
        return `Length must be between 120 and 300 chars (current: ${len})`;
      return true;
    },
  });

  const githubDesc = await input({
    message: 'Enter description for GitHub project (340-350 characters):',
    validate: (val) => {
      const len = val.trim().length;
      if (len < 340 || len > 350)
        return `Length must be between 340 and 350 chars (current: ${len})`;
      return true;
    },
  });

  // 3. Keywords / Topics
  let keywords: string[] = [];
  await input({
    message: 'Enter keywords / topics (comma separated, 8-20 unique items):',
    validate: (val) => {
      const items = val
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const uniqueItems = [...new Set(items)];
      if (uniqueItems.length < 8 || uniqueItems.length > 20) {
        return `Must have between 8 and 20 unique keywords (current: ${uniqueItems.length})`;
      }
      keywords = uniqueItems; // Store for later use
      return true;
    },
  });

  Logger.log('\n🚀 Starting repository standardization and setup...\n');

  const repoName = parsed.repo;
  const repoPath = getLocalRepoPath(repoName);

  // 1. Clone/Pull Repo
  const cloned = await ensureRepoCloned(repoUrl, repoName);
  if (!cloned) {
    Logger.error(`Failed to clone/pull repository: ${repoName}`);
    return;
  }

  // 2. Update Repo List
  await addOrUpdateRepoInList(repoName, repoUrl);

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
  ];

  for (const template of templates) {
    await ensureTemplateFile(repoPath, template, true);
  }
  Logger.success('Created all the template files');

  // 4. package.json Injection
  const pkgInjected = await injectPackageJson(
    repoPath,
    repoName,
    packageDesc,
    keywords
  );
  if (!pkgInjected) {
    Logger.error('Failed to inject package.json');
    return;
  }

  // 5. pnpm install
  const pnpmSuccess = await runPnpmInstall(repoPath);
  if (!pnpmSuccess) {
    Logger.error('pnpm install failed');
    return;
  }

  // 6. Fix README.md (Author/License section)
  await fixReadme(repoPath);

  // 7. GitHub Metadata Updates
  Logger.log('🌐 Updating GitHub repository metadata...');
  if (!settings.DRY_RUN) {
    try {
      await updateRepoMetadata(parsed.owner, parsed.repo, {
        description: githubDesc,
        homepage: settings.DEFAULT_HOMEPAGE,
      });
      await replaceTopics(parsed.owner, parsed.repo, keywords);
      Logger.success('GitHub metadata updated');
    } catch (err) {
      Logger.error(
        `Failed to update GitHub metadata: ${(err as Error).message}`
      );
    }
  }

  // 8. Fix Rulesets
  await fixRulesets(parsed.owner, parsed.repo);

  // 9. Star & Watch
  if (!settings.DRY_RUN) {
    try {
      await starRepo(parsed.owner, parsed.repo);
      await watchRepo(parsed.owner, parsed.repo);
      Logger.log('⭐ Starred and watched repository');
    } catch {
      // Ignore failures for star/watch
    }
  }

  // 10. Git Clean
  if (settings.GIT_CLEAN_ENABLED) {
    await runGitClean(repoPath);
  }

  // 11. Git Commit & Push
  Logger.log('📤 Committing and pushing changes...');

  const commitMessage =
    (await getChangelogCommitMessage(repoPath)) ||
    'chore(maintainer): standardize repository structure';

  const pushed = await commitAndPush(repoPath, commitMessage);
  if (pushed) {
    Logger.log(
      `\n✨ Repo '${repoName}' created and standardized successfully!\n`
    );
    Logger.log(
      `⚠️ Please replace the README.md file and the INSTRUCTIONS.md with real files (Ask your AI to generate ones according to the current structure).`
    );
  } else {
    Logger.warn('\n⚠️  Standardization complete, but could not push changes.');
  }
}
