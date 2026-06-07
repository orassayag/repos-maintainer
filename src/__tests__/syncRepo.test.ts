import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncRepoCommand } from '../commands/syncRepo.js';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { Logger } from '../utils/logger.js';
import { selectRepo } from '../utils/repoSelector.js';
import { ensureRepoCloned } from '../utils/git.js';
import {
  replaceTopics,
  parseGitHubUrl,
  repoExists,
  getRepoMetadata,
} from '../github.js';
import { getLocalRepoPath } from '../settings.js';
import { fixPackageJson } from '../fixers/packageJsonFixer.js';
import { syncTemplateFiles } from '../utils/fileFixer.js';
import { input } from '../utils/prompts.js';

vi.mock('fs/promises');
vi.mock('fs');
vi.mock('../utils/logger.js');
vi.mock('../utils/repoSelector.js');
vi.mock('../utils/git.js');
vi.mock('../github.js');
vi.mock('../settings.js');
vi.mock('../fixers/packageJsonFixer.js');
vi.mock('../utils/fileFixer.js');
vi.mock('../utils/prompts.js');

describe('syncRepoCommand', () => {
  const mockRepo = {
    name: 'test-repo',
    url: 'https://github.com/user/test-repo',
  };
  const mockRepoPath = '/mock/path/test-repo';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(selectRepo).mockResolvedValue(mockRepo);
    vi.mocked(getLocalRepoPath).mockReturnValue(mockRepoPath);
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'test-repo',
    });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(ensureRepoCloned).mockResolvedValue(true);
    vi.mocked(fixPackageJson).mockResolvedValue(false);
    vi.mocked(syncTemplateFiles).mockResolvedValue([]);
    vi.mocked(input).mockResolvedValue(
      'valid description that is at least 290 characters long and does not exceed 300 characters for the package.json description test. This is just a long string to satisfy the length requirement of the validation logic which is between 290 and 300 characters for package.json.'
    );
    vi.mocked(fs.readFile).mockImplementation((path: any) => {
      const p = path.toString();
      if (p.endsWith('package.json')) {
        return Promise.resolve(
          JSON.stringify({
            name: 'test-repo',
            description:
              'valid description that is at least 290 characters long and does not exceed 300 characters for the package.json description test. This is just a long string to satisfy the length requirement of the validation logic which is between 290 and 300 characters for package.json.',
          })
        );
      }
      if (p.endsWith('README.md')) {
        return Promise.resolve(
          "# Test Repo\n\nThis is a long description that is at least 500 characters long and does not exceed 600 characters for the README.md description test. This is just a long string to satisfy the length requirement of the validation logic which is between 500 and 600 characters for README.md. We need to make sure this string is sufficiently long to pass the validation check. Adding more text here to ensure we reach the 500 character mark. This should be enough now, let's keep going a bit more just to be absolutely sure."
        );
      }
      return Promise.resolve('');
    });
    vi.mocked(getRepoMetadata).mockResolvedValue({
      description:
        'valid description that is at least 340 characters long and does not exceed 350 characters for the GitHub description test. This is just a long string to satisfy the length requirement of the validation logic which is between 340 and 350 characters for GitHub. And some more text to reach the limit correctly.',
      topics: [],
      homepage: 'https://linkedin.com/in/orassayag',
    } as any);
  });

  it('should return early if no repo is selected', async () => {
    vi.mocked(selectRepo).mockResolvedValue(null);
    await syncRepoCommand();
    expect(Logger.log).toHaveBeenCalledWith('\nSync Repo:');
    expect(ensureRepoCloned).not.toHaveBeenCalled();
  });

  it('should handle repo not found on GitHub and skip topic sync even if keywords exist', async () => {
    vi.mocked(repoExists).mockResolvedValue(false);
    const pkg = { name: 'test-repo', keywords: ['kw1'] };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkg));
    vi.mocked(fs.readdir).mockResolvedValue([]);

    await syncRepoCommand();

    expect(Logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not found on GitHub')
    );
    expect(replaceTopics).not.toHaveBeenCalled();
    expect(Logger.log).not.toHaveBeenCalledWith(
      expect.stringContaining('Syncing GitHub topics')
    );
  });

  it('should return early if repo cloning fails', async () => {
    vi.mocked(ensureRepoCloned).mockResolvedValue(false);
    await syncRepoCommand();
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('should use fallback URL if selectedRepo.url is missing', async () => {
    const repoWithoutUrl = { name: 'test-repo', url: '' };
    vi.mocked(selectRepo).mockResolvedValue(repoWithoutUrl);
    vi.mocked(parseGitHubUrl).mockReturnValue(null);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ name: 'test-repo' })
    );
    vi.mocked(fs.readdir).mockResolvedValue([]);

    await syncRepoCommand();

    expect(ensureRepoCloned).toHaveBeenCalledWith(
      expect.stringContaining('https://github.com/'),
      'test-repo'
    );
  });

  it('should handle package.json read error', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('Read error'));

    await syncRepoCommand();

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Could not read package.json: Read error')
    );
  });

  it('should prompt to fix keywords if count is invalid and sync to GitHub', async () => {
    const manyKeywords = Array.from({ length: 25 }, (_, i) => `kw${i}`);
    const validKeywords = Array.from({ length: 10 }, (_, i) => `newkw${i}`);
    const pkg = {
      name: 'test-repo',
      keywords: manyKeywords,
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkg));
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(input).mockResolvedValue(validKeywords.join(','));

    await syncRepoCommand();

    expect(Logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('package.json keywords:')
    );
    expect(replaceTopics).toHaveBeenCalledWith(
      'user',
      'test-repo',
      validKeywords
    );
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('should call fixPackageJson during sync', async () => {
    const pkg = { name: 'test-repo' };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkg));

    await syncRepoCommand();

    expect(fixPackageJson).toHaveBeenCalledWith(
      expect.stringContaining('test-repo'),
      'test-repo',
      'package.json',
      undefined
    );
  });

  it('should call syncTemplateFiles during sync and pass isActive status', async () => {
    const pkg = { name: 'test-repo' };
    const activeRepo = { ...mockRepo, type: 'active' };
    vi.mocked(selectRepo).mockResolvedValue(activeRepo);
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkg));
    vi.mocked(syncTemplateFiles).mockResolvedValue(['Created missing LICENSE']);

    await syncRepoCommand();

    expect(syncTemplateFiles).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      false,
      true
    );
    expect(Logger.success).toHaveBeenCalledWith(
      expect.stringContaining('Created missing LICENSE')
    );
  });

  it('should call syncTemplateFiles during sync and pass isActive=false for legacy projects', async () => {
    const pkg = { name: 'test-repo' };
    const legacyRepo = { ...mockRepo, type: 'legacy' };
    vi.mocked(selectRepo).mockResolvedValue(legacyRepo);
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkg));

    await syncRepoCommand();

    expect(syncTemplateFiles).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      false,
      false
    );
  });

  it('should handle errors during sync', async () => {
    vi.mocked(ensureRepoCloned).mockRejectedValue(new Error('Clone failed'));

    await syncRepoCommand();

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Sync failed: Clone failed')
    );
  });

  it('should skip sorting if package.json does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await syncRepoCommand();

    expect(Logger.log).not.toHaveBeenCalledWith(
      expect.stringContaining('Sorting package.json...')
    );
  });
});
