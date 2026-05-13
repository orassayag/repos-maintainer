import { describe, it, expect, vi, beforeEach } from 'vitest';
import { standardizeRepo } from '../fixers/standardizer.js';
import { ensureRepoCloned, commitAndPush, runGitClean } from '../utils/git.js';
import {
  ensureTemplateFile,
  getChangelogCommitMessage,
} from '../utils/fileFixer.js';
import { parseGitHubUrl, starRepo, watchRepo } from '../github.js';
import { addOrUpdateRepoInList } from '../utils/repoList.js';
import { fixPackageJson } from '../fixers/packageJsonFixer.js';
import { fixReadme } from '../fixers/readmeFixer.js';
import { fixMetadata } from '../fixers/metadataFixer.js';
import { fixRulesets } from '../fixers/rulesetsFixer.js';
import { isTypeScriptProject } from '../utils/projectType.js';
import { settings } from '../settings.js';

vi.mock('../utils/git.js');
vi.mock('../utils/fileFixer.js');
vi.mock('../github.js');
vi.mock('../utils/repoList.js');
vi.mock('../fixers/packageJsonFixer.js');
vi.mock('../fixers/readmeFixer.js');
vi.mock('../fixers/metadataFixer.js');
vi.mock('../fixers/rulesetsFixer.js');
vi.mock('../utils/logger.js');
vi.mock('../utils/projectType.js');
vi.mock('fs/promises');
vi.mock('../settings.js', () => ({
  settings: {
    PROJECTS_ROOT: '/mock/projects',
    DRY_RUN: false,
    GIT_CLEAN_ENABLED: false,
  },
}));

describe('standardizer', () => {
  const mockRepoUrl = 'https://github.com/user/test-repo';

  beforeEach(() => {
    vi.clearAllMocks();
    settings.GIT_CLEAN_ENABLED = false;
    vi.mocked(isTypeScriptProject).mockResolvedValue(true);
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'test-repo',
    });
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
    vi.mocked(runGitClean).mockResolvedValue(undefined);
    vi.mocked(getChangelogCommitMessage).mockResolvedValue('standardize');
  });

  it('should run all standardization steps successfully', async () => {
    const result = await standardizeRepo(mockRepoUrl);

    expect(result.success).toBe(true);
    expect(result.repoName).toBe('test-repo');
    expect(result.changes).toContain(
      'package.json: Standardized (author, engines, type, etc.)'
    );
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

  it('should handle no changes in standardization steps', async () => {
    vi.mocked(fixPackageJson).mockResolvedValue(false);
    vi.mocked(fixReadme).mockResolvedValue(false);
    vi.mocked(ensureTemplateFile).mockResolvedValue(false);
    vi.mocked(fixMetadata).mockResolvedValue([]);
    vi.mocked(fixRulesets).mockResolvedValue(false);
    vi.mocked(commitAndPush).mockResolvedValue(false);

    const result = await standardizeRepo(mockRepoUrl);

    expect(result.success).toBe(true);
    expect(result.changes).not.toContain(
      'package.json: Standardized (author, engines, type, etc.)'
    );
    expect(result.changes).not.toContain(
      'README.md: Added Author/License section'
    );
    expect(result.changes).not.toContain('Rulesets: Applied/updated');
    expect(result.changes).not.toContain('Git: Committed & pushed');
  });

  it('should handle dry run', async () => {
    vi.mocked(commitAndPush).mockResolvedValue(false);
    // @ts-ignore
    const originalDryRun = await import('../settings.js').then(
      (m) => m.settings.DRY_RUN
    );
    // @ts-ignore
    await import('../settings.js').then((m) => (m.settings.DRY_RUN = true));

    const result = await standardizeRepo(mockRepoUrl);

    expect(result.changes).not.toContain('GitHub: Starred & watched');
    expect(starRepo).not.toHaveBeenCalled();
    expect(watchRepo).not.toHaveBeenCalled();

    // Reset
    // @ts-ignore
    await import('../settings.js').then(
      (m) => (m.settings.DRY_RUN = originalDryRun)
    );
  });

  it('should run git clean if enabled', async () => {
    // @ts-ignore
    const originalClean = await import('../settings.js').then(
      (m) => m.settings.GIT_CLEAN_ENABLED
    );
    // @ts-ignore
    await import('../settings.js').then(
      (m) => (m.settings.GIT_CLEAN_ENABLED = true)
    );

    const result = await standardizeRepo(mockRepoUrl);

    expect(result.changes).toContain('Git: Cleaned (gc + reflog)');
    const { runGitClean } = await import('../utils/git.js');
    expect(runGitClean).toHaveBeenCalled();

    // Reset
    // @ts-ignore
    await import('../settings.js').then(
      (m) => (m.settings.GIT_CLEAN_ENABLED = originalClean)
    );
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

  it('should cover all catch blocks in standardizeRepo', async () => {
    const { runGitClean } = await import('../utils/git.js');
    const fsPromises = await import('fs/promises');

    vi.mocked(ensureRepoCloned).mockRejectedValue(new Error('Step 1 Fail'));
    vi.mocked(addOrUpdateRepoInList).mockRejectedValue(
      new Error('Step 2 Fail')
    );
    vi.mocked(fixPackageJson).mockRejectedValue(new Error('Step 3 Fail'));
    vi.mocked(fixReadme).mockRejectedValue(new Error('Step 4 Fail'));
    vi.mocked(ensureTemplateFile).mockRejectedValue(new Error('Step 5 Fail'));
    vi.mocked(fsPromises.mkdir).mockRejectedValue(new Error('Step 5.1 Fail'));
    vi.mocked(fixMetadata).mockRejectedValue(new Error('Step 6 Fail'));
    vi.mocked(fixRulesets).mockRejectedValue(new Error('Step 7 Fail'));
    vi.mocked(starRepo).mockRejectedValue(new Error('Step 8 Fail'));
    vi.mocked(runGitClean).mockRejectedValue(new Error('Step 9 Fail'));
    vi.mocked(commitAndPush).mockRejectedValue(new Error('Step 10 Fail'));

    // Enable git clean for coverage
    // @ts-ignore
    await import('../settings.js').then(
      (m) => (m.settings.GIT_CLEAN_ENABLED = true)
    );

    const result = await standardizeRepo(mockRepoUrl);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Git: Step 1 Fail');
    expect(result.errors).toContain('Repo list: Step 2 Fail');
    expect(result.errors).toContain('package.json: Step 3 Fail');
    expect(result.errors).toContain('README.md: Step 4 Fail');
    expect(result.errors).toContain('LICENSE: Step 5 Fail'); // One of TEMPLATE_FILES
    expect(result.errors).toContain('Folders/index.ts: Step 5.1 Fail');
    expect(result.errors).toContain('Metadata: Step 6 Fail');
    expect(result.errors).toContain('Rulesets: Step 7 Fail');
    expect(result.errors).toContain('Git clean: Step 9 Fail');
    expect(result.errors).toContain('Git commit: Step 10 Fail');
  });

  it('should cover src/index.ts creation catch block', async () => {
    const fsPromises = await import('fs/promises');
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('not found'));
    vi.mocked(fsPromises.writeFile).mockRejectedValue(new Error('write fail'));

    const result = await standardizeRepo(mockRepoUrl);
    expect(result.errors).toContain('Folders/index.ts: write fail');
  });
});
