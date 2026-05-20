import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addRepoCommand } from '../commands/addRepo.js';
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
import { ensureRepoCloned, commitAndPush } from '../utils/git.js';
import {
  ensureTemplateFile,
  getChangelogCommitMessage,
} from '../utils/fileFixer.js';
import { injectPackageJson } from '../fixers/packageJsonFixer.js';
import { runPnpmInstall } from '../utils/pnpm.js';
import { addOrUpdateRepoInList } from '../utils/repoList.js';
import { fixReadme } from '../fixers/readmeFixer.js';
import { fixRulesets } from '../fixers/rulesetsFixer.js';
import { Logger } from '../utils/logger.js';

vi.mock('../utils/prompts.js');
vi.mock('../github.js');
vi.mock('../utils/git.js');
vi.mock('../utils/fileFixer.js');
vi.mock('../fixers/packageJsonFixer.js');
vi.mock('../utils/pnpm.js');
vi.mock('../utils/repoList.js');
vi.mock('../fixers/readmeFixer.js');
vi.mock('../fixers/rulesetsFixer.js');
vi.mock('../utils/logger.js');
vi.mock('../settings.js', () => ({
  settings: {
    DEFAULT_HOMEPAGE: 'home',
    DRY_RUN: false,
    GIT_CLEAN_ENABLED: false,
  },
  getLocalRepoPath: vi.fn(() => '/mock/path'),
}));

describe('addRepoCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully add a repo', async () => {
    // Step 1: URL input
    vi.mocked(input).mockResolvedValueOnce('https://github.com/user/new-repo');
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'new-repo',
    });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(isRepoEmpty).mockResolvedValue(true);

    // Step 2: Descriptions
    vi.mocked(input).mockResolvedValueOnce('A'.repeat(295)); // packageDesc
    vi.mocked(input).mockResolvedValueOnce('B'.repeat(345)); // githubDesc

    // Step 3: Keywords
    vi.mocked(input).mockResolvedValueOnce('k1,k2,k3,k4,k5,k6,k7,k8');

    // Mocks for standardization steps
    vi.mocked(ensureRepoCloned).mockResolvedValue(true);
    vi.mocked(addOrUpdateRepoInList).mockResolvedValue(undefined);
    vi.mocked(ensureTemplateFile).mockResolvedValue(true);
    vi.mocked(injectPackageJson).mockResolvedValue(true);
    vi.mocked(runPnpmInstall).mockResolvedValue(true);
    vi.mocked(fixReadme).mockResolvedValue(true);
    vi.mocked(updateRepoMetadata).mockResolvedValue(undefined);
    vi.mocked(replaceTopics).mockResolvedValue(undefined);
    vi.mocked(fixRulesets).mockResolvedValue(true);
    vi.mocked(starRepo).mockResolvedValue(undefined);
    vi.mocked(watchRepo).mockResolvedValue(undefined);
    vi.mocked(getChangelogCommitMessage).mockResolvedValue('standardize');
    vi.mocked(commitAndPush).mockResolvedValue(true);

    await addRepoCommand();

    expect(Logger.success).toHaveBeenCalledWith(
      expect.stringContaining('Successfully')
    );
    expect(commitAndPush).toHaveBeenCalled();
  });

  it('should return if repo is not empty', async () => {
    vi.mocked(input).mockResolvedValueOnce('https://github.com/user/old-repo');
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'old-repo',
    });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(isRepoEmpty).mockResolvedValue(false);

    await addRepoCommand();

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('not empty')
    );
    expect(ensureRepoCloned).not.toHaveBeenCalled();
  });

  it('should handle invalid URL and retry', async () => {
    vi.mocked(input)
      .mockResolvedValueOnce('invalid-url')
      .mockResolvedValueOnce('https://github.com/user/new-repo');
    vi.mocked(parseGitHubUrl)
      .mockReturnValueOnce(null)
      .mockReturnValue({ owner: 'user', repo: 'new-repo' });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(isRepoEmpty).mockResolvedValue(true);
    vi.mocked(input).mockResolvedValue('A'.repeat(300)); // desc
    vi.mocked(input).mockResolvedValue('B'.repeat(350)); // desc
    vi.mocked(input).mockResolvedValue('k1,k2,k3,k4,k5,k6,k7,k8');

    await addRepoCommand();

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid GitHub URL')
    );
  });

  it('should handle non-existent repo and retry', async () => {
    vi.mocked(input)
      .mockResolvedValueOnce('https://github.com/user/no-repo')
      .mockResolvedValueOnce('https://github.com/user/new-repo');
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'new-repo',
    });
    vi.mocked(repoExists).mockResolvedValueOnce(false).mockResolvedValue(true);
    vi.mocked(isRepoEmpty).mockResolvedValue(true);
    vi.mocked(input).mockResolvedValue('A'.repeat(300)); // desc
    vi.mocked(input).mockResolvedValue('B'.repeat(350)); // desc
    vi.mocked(input).mockResolvedValue('k1,k2,k3,k4,k5,k6,k7,k8');

    await addRepoCommand();

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Repository not found')
    );
  });

  it('should handle standardization errors', async () => {
    vi.mocked(input).mockResolvedValue('https://github.com/user/new-repo');
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'new-repo',
    });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(isRepoEmpty).mockResolvedValue(true);
    vi.mocked(input).mockResolvedValue('A'.repeat(300)); // desc
    vi.mocked(input).mockResolvedValue('B'.repeat(350)); // desc
    vi.mocked(input).mockResolvedValue('k1,k2,k3,k4,k5,k6,k7,k8');

    vi.mocked(ensureRepoCloned).mockRejectedValue(new Error('clone fail'));

    await addRepoCommand();

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('clone fail')
    );
  });

  it('should handle .git suffix in URL', async () => {
    vi.mocked(input).mockResolvedValueOnce(
      'https://github.com/user/new-repo.git'
    );
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'new-repo',
    });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(isRepoEmpty).mockResolvedValue(true);
    vi.mocked(input).mockResolvedValue('A'.repeat(295)); // packageDesc
    vi.mocked(input).mockResolvedValue('B'.repeat(345)); // githubDesc
    vi.mocked(input).mockResolvedValue('k1,k2,k3,k4,k5,k6,k7,k8');

    vi.mocked(ensureRepoCloned).mockResolvedValue(true);
    vi.mocked(injectPackageJson).mockResolvedValue(true);
    vi.mocked(runPnpmInstall).mockResolvedValue(true);
    vi.mocked(commitAndPush).mockResolvedValue(true);

    await addRepoCommand();

    expect(parseGitHubUrl).toHaveBeenCalledWith(
      'https://github.com/user/new-repo'
    );
  });

  it('should handle git clean failure', async () => {
    vi.mocked(input).mockResolvedValueOnce('https://github.com/user/new-repo');
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'new-repo',
    });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(isRepoEmpty).mockResolvedValue(true);
    vi.mocked(input).mockResolvedValue('A'.repeat(295)); // packageDesc
    vi.mocked(input).mockResolvedValue('B'.repeat(345)); // githubDesc
    vi.mocked(input).mockResolvedValue('k1,k2,k3,k4,k5,k6,k7,k8');

    vi.mocked(ensureRepoCloned).mockResolvedValue(true);
    vi.mocked(injectPackageJson).mockResolvedValue(true);
    vi.mocked(runPnpmInstall).mockResolvedValue(true);
    vi.mocked(commitAndPush).mockResolvedValue(true);

    const { settings } = await import('../settings.js');
    settings.GIT_CLEAN_ENABLED = true;
    const { runGitClean } = await import('../utils/git.js');
    vi.mocked(runGitClean).mockRejectedValue(new Error('clean fail'));

    await addRepoCommand();

    expect(Logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Git clean failed')
    );
    settings.GIT_CLEAN_ENABLED = false;
  });

  it('should handle pnpm install failure', async () => {
    vi.mocked(input).mockResolvedValueOnce('https://github.com/user/new-repo');
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'new-repo',
    });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(isRepoEmpty).mockResolvedValue(true);
    vi.mocked(input).mockResolvedValue('A'.repeat(295)); // packageDesc
    vi.mocked(input).mockResolvedValue('B'.repeat(345)); // githubDesc
    vi.mocked(input).mockResolvedValue('k1,k2,k3,k4,k5,k6,k7,k8');

    vi.mocked(ensureRepoCloned).mockResolvedValue(true);
    vi.mocked(injectPackageJson).mockResolvedValue(true);
    vi.mocked(runPnpmInstall).mockResolvedValue(false);

    await addRepoCommand();

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('pnpm install failed')
    );
  });

  it('should validate inputs correctly', async () => {
    vi.mocked(input).mockResolvedValueOnce('https://github.com/user/new-repo');
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'new-repo',
    });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(isRepoEmpty).mockResolvedValue(true);
    vi.mocked(input).mockResolvedValueOnce('A'.repeat(295)); // packageDesc
    vi.mocked(input).mockResolvedValueOnce('B'.repeat(345)); // githubDesc
    vi.mocked(input).mockResolvedValueOnce('k1,k2,k3,k4,k5,k6,k7,k8');

    // Mocks for standardization steps to allow it to finish
    vi.mocked(ensureRepoCloned).mockResolvedValue(true);
    vi.mocked(injectPackageJson).mockResolvedValue(true);
    vi.mocked(runPnpmInstall).mockResolvedValue(true);
    vi.mocked(commitAndPush).mockResolvedValue(true);

    await addRepoCommand();

    // Capture validation functions
    const inputCalls = vi.mocked(input).mock.calls;

    // 1. URL validation
    const urlValidate = inputCalls[0][0].validate;
    if (urlValidate) {
      expect(urlValidate('')).toBe('URL is required');
      expect(urlValidate('  ')).toBe('URL is required');
      expect(urlValidate('https://github.com')).toBe(true);
    }

    // 2. package.json description validation
    const pkgDescValidate = inputCalls[1][0].validate;
    if (pkgDescValidate) {
      expect(pkgDescValidate('too short')).toContain(
        'Description length is 9 (expected 290-300 chars)'
      );
      expect(pkgDescValidate('A'.repeat(301))).toContain(
        'Description length is 301 (expected 290-300 chars)'
      );
      expect(pkgDescValidate('A'.repeat(295))).toBe(true);
    }

    // 3. GitHub description validation
    const githubDescValidate = inputCalls[2][0].validate;
    if (githubDescValidate) {
      expect(githubDescValidate('too short')).toContain(
        'Description length is 9 (expected 340-350 chars)'
      );
      expect(githubDescValidate('A'.repeat(351))).toContain(
        'Description length is 351 (expected 340-350 chars)'
      );
      expect(githubDescValidate('A'.repeat(345))).toBe(true);
    }

    // 4. Keywords validation
    const keywordsValidate = inputCalls[3][0].validate;
    if (keywordsValidate) {
      expect(keywordsValidate('k1,k2')).toContain('between 8 and 20');
      expect(
        keywordsValidate(
          'k1,k2,k3,k4,k5,k6,k7,k8,k9,k10,k11,k12,k13,k14,k15,k16,k17,k18,k19,k20,k21'
        )
      ).toContain('between 8 and 20');

      // Valid case
      expect(
        keywordsValidate(
          'node-js,automation,npm,pnpm,package-updater,dependency-checker,outdated-packages,git-integration'
        )
      ).toBe(true);

      // Invalid cases
      expect(
        keywordsValidate(
          'Node.js,automation,npm,pnpm,package-updater,dependency-checker,outdated-packages,git-integration'
        )
      ).toContain('contains uppercase letters');
      expect(
        keywordsValidate(
          'node.js,automation,npm,pnpm,package-updater,dependency-checker,outdated-packages,git-integration'
        )
      ).toContain('contains invalid characters');
      expect(
        keywordsValidate(
          'node-js,automation,npm,pnpm,package-updater,dependency-checker,outdated-packages,git integration'
        )
      ).toContain('contains spaces');
      expect(
        keywordsValidate(
          '-node-js,automation,npm,pnpm,package-updater,dependency-checker,outdated-packages,git-integration'
        )
      ).toContain('must start with a letter or number');
      expect(
        keywordsValidate(
          'a'.repeat(51) +
            ',automation,npm,pnpm,package-updater,dependency-checker,outdated-packages,git-integration'
        )
      ).toContain('is too long');
    }
  });

  it('should handle package.json injection failure', async () => {
    vi.mocked(input).mockResolvedValueOnce('https://github.com/user/new-repo');
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'new-repo',
    });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(isRepoEmpty).mockResolvedValue(true);
    vi.mocked(input).mockResolvedValue('A'.repeat(295)); // packageDesc
    vi.mocked(input).mockResolvedValue('B'.repeat(345)); // githubDesc
    vi.mocked(input).mockResolvedValue('k1,k2,k3,k4,k5,k6,k7,k8');

    vi.mocked(ensureRepoCloned).mockResolvedValue(true);
    vi.mocked(injectPackageJson).mockResolvedValue(false);

    await addRepoCommand();

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to inject package.json')
    );
  });

  it('should handle star/watch failure', async () => {
    vi.mocked(input).mockResolvedValueOnce('https://github.com/user/new-repo');
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'new-repo',
    });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(isRepoEmpty).mockResolvedValue(true);
    vi.mocked(input).mockResolvedValue('A'.repeat(295)); // packageDesc
    vi.mocked(input).mockResolvedValue('B'.repeat(345)); // githubDesc
    vi.mocked(input).mockResolvedValue('k1,k2,k3,k4,k5,k6,k7,k8');

    vi.mocked(ensureRepoCloned).mockResolvedValue(true);
    vi.mocked(injectPackageJson).mockResolvedValue(true);
    vi.mocked(runPnpmInstall).mockResolvedValue(true);
    vi.mocked(starRepo).mockRejectedValue(new Error('star fail'));
    vi.mocked(commitAndPush).mockResolvedValue(true);

    await addRepoCommand();

    expect(Logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to star/watch repo')
    );
  });

  it('should handle commit and push failure', async () => {
    vi.mocked(input).mockResolvedValueOnce('https://github.com/user/new-repo');
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'new-repo',
    });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(isRepoEmpty).mockResolvedValue(true);
    vi.mocked(input).mockResolvedValue('A'.repeat(295)); // packageDesc
    vi.mocked(input).mockResolvedValue('B'.repeat(345)); // githubDesc
    vi.mocked(input).mockResolvedValue('k1,k2,k3,k4,k5,k6,k7,k8');

    vi.mocked(ensureRepoCloned).mockResolvedValue(true);
    vi.mocked(injectPackageJson).mockResolvedValue(true);
    vi.mocked(runPnpmInstall).mockResolvedValue(true);
    vi.mocked(commitAndPush).mockResolvedValue(false);

    await addRepoCommand();

    expect(Logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not push changes')
    );
  });
});
