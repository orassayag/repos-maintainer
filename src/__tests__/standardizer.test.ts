import { describe, it, expect, vi, beforeEach } from 'vitest';
import { standardizeRepo } from '../fixers/standardizer.js';
import { ensureRepoCloned, commitAndPush } from '../utils/git.js';
import { ensureTemplateFile, getChangelogCommitMessage } from '../utils/fileFixer.js';
import { parseGitHubUrl, starRepo, watchRepo } from '../github.js';
import { addOrUpdateRepoInList } from '../utils/repoList.js';
import { fixPackageJson } from '../fixers/packageJsonFixer.js';
import { fixReadme } from '../fixers/readmeFixer.js';
import { fixMetadata } from '../fixers/metadataFixer.js';
import { fixRulesets } from '../fixers/rulesetsFixer.js';

vi.mock('../utils/git.js');
vi.mock('../utils/fileFixer.js');
vi.mock('../github.js');
vi.mock('../utils/repoList.js');
vi.mock('../fixers/packageJsonFixer.js');
vi.mock('../fixers/readmeFixer.js');
vi.mock('../fixers/metadataFixer.js');
vi.mock('../fixers/rulesetsFixer.js');
vi.mock('../utils/logger.js');
vi.mock('../settings.js', () => ({
  settings: {
    PROJECTS_ROOT: '/mock/projects',
    DRY_RUN: false,
  },
}));

describe('standardizer', () => {
  const mockRepoUrl = 'https://github.com/user/test-repo';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseGitHubUrl).mockReturnValue({ owner: 'user', repo: 'test-repo' });
    vi.mocked(ensureRepoCloned).mockResolvedValue(true);
    vi.mocked(addOrUpdateRepoInList).mockResolvedValue(undefined);
    vi.mocked(fixPackageJson).mockResolvedValue(true);
    vi.mocked(fixReadme).mockResolvedValue(true);
    vi.mocked(ensureTemplateFile).mockResolvedValue(true);
    vi.mocked(fixMetadata).mockResolvedValue(['description updated']);
    vi.mocked(fixRulesets).mockResolvedValue(true);
    vi.mocked(starRepo).mockResolvedValue(undefined);
    vi.mocked(watchRepo).mockResolvedValue(undefined);
    vi.mocked(commitAndPush).mockResolvedValue(true);
    vi.mocked(getChangelogCommitMessage).mockResolvedValue('standardize');
  });

  it('should run all standardization steps successfully', async () => {
    const result = await standardizeRepo(mockRepoUrl);

    expect(result.success).toBe(true);
    expect(result.repoName).toBe('test-repo');
    expect(result.changes).toContain('package.json: Fixed author/contributors');
    expect(result.changes).toContain('Metadata: description updated');
    expect(result.changes).toContain('Git: Committed & pushed');
    expect(result.errors).toHaveLength(0);

    expect(ensureRepoCloned).toHaveBeenCalled();
    expect(addOrUpdateRepoInList).toHaveBeenCalled();
    expect(fixPackageJson).toHaveBeenCalled();
    expect(fixReadme).toHaveBeenCalled();
    expect(fixMetadata).toHaveBeenCalled();
    expect(fixRulesets).toHaveBeenCalled();
    expect(starRepo).toHaveBeenCalled();
    expect(watchRepo).toHaveBeenCalled();
    expect(commitAndPush).toHaveBeenCalled();
  });

  it('should handle invalid URL', async () => {
    vi.mocked(parseGitHubUrl).mockReturnValue(null);
    const result = await standardizeRepo('invalid');
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Invalid GitHub URL');
  });

  it('should return success: false if there are errors', async () => {
    vi.mocked(ensureRepoCloned).mockRejectedValue(new Error('clone fail'));
    vi.mocked(fixPackageJson).mockRejectedValue(new Error('pkg fail'));

    const result = await standardizeRepo(mockRepoUrl);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Git: clone fail');
    expect(result.errors).toContain('package.json: pkg fail');
    expect(result.changes).toContain('Repo list: Updated'); 
  });
});
