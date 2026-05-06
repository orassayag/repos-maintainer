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
import { ensureRepoCloned, commitAndPush, runGitClean } from '../utils/git.js';
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

    expect(Logger.log).toHaveBeenCalledWith(
      expect.stringContaining('successfully')
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
});
