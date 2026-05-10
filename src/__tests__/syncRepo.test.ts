import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncRepoCommand } from '../commands/syncRepo.js';
import fs from 'fs/promises';
import { Logger } from '../utils/logger.js';
import { selectRepo } from '../utils/repoSelector.js';
import { ensureRepoCloned } from '../utils/git.js';
import { replaceTopics, parseGitHubUrl, repoExists } from '../github.js';
import { getLocalRepoPath } from '../settings.js';

vi.mock('fs/promises');
vi.mock('../utils/logger.js');
vi.mock('../utils/repoSelector.js');
vi.mock('../utils/git.js');
vi.mock('../github.js');
vi.mock('../settings.js');

describe('syncRepoCommand', () => {
  const mockRepo = {
    name: 'test-repo',
    url: 'https://github.com/user/test-repo',
  };
  const mockRepoPath = '/mock/path/test-repo';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(selectRepo).mockResolvedValue(mockRepo);
    vi.mocked(getLocalRepoPath).mockReturnValue(mockRepoPath);
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'user',
      repo: 'test-repo',
    });
    vi.mocked(repoExists).mockResolvedValue(true);
    vi.mocked(ensureRepoCloned).mockResolvedValue(true);
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

  it('should reduce keywords if more than 20 and sync to GitHub', async () => {
    const manyKeywords = Array.from({ length: 25 }, (_, i) => `kw${i}`);
    const pkg = {
      name: 'test-repo',
      keywords: manyKeywords,
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkg));
    vi.mocked(fs.readdir).mockResolvedValue([]);

    await syncRepoCommand();

    expect(Logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Reducing keywords from 25 to 20')
    );
    expect(replaceTopics).toHaveBeenCalledWith(
      'user',
      'test-repo',
      manyKeywords.slice(0, 20)
    );
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it('should update "files" section in package.json if not synced', async () => {
    const pkg = {
      name: 'test-repo',
      files: ['src'],
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkg));
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'src', isDirectory: (): boolean => true },
      { name: 'README.md', isDirectory: (): boolean => false },
      { name: '.git', isDirectory: (): boolean => true },
      { name: 'node_modules', isDirectory: (): boolean => true },
    ] as any);

    await syncRepoCommand();

    const writtenPkg = JSON.parse(
      vi.mocked(fs.writeFile).mock.calls[0][1] as string
    );
    expect(writtenPkg.files).toEqual(['src', 'README.md']);
    expect(Logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Updated "files" section in package.json')
    );
  });

  it('should not update package.json if already synced', async () => {
    const pkg = {
      name: 'test-repo',
      keywords: ['a', 'b'],
      files: ['src', 'README.md'],
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkg));
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'src', isDirectory: (): boolean => true },
      { name: 'README.md', isDirectory: (): boolean => false },
    ] as any);

    await syncRepoCommand();

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(Logger.log).toHaveBeenCalledWith(
      expect.stringContaining('No changes needed for package.json')
    );
  });

  it('should handle errors during sync', async () => {
    vi.mocked(ensureRepoCloned).mockRejectedValue(new Error('Clone failed'));

    await syncRepoCommand();

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Sync failed: Clone failed')
    );
  });

  it('should handle fallback for parsed GitHub URL if null', async () => {
    vi.mocked(parseGitHubUrl).mockReturnValue(null);
    const { settings } = await import('../settings.js');
    settings.AUTHOR_GITHUB = 'default-owner';

    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ name: 'test-repo' })
    );
    vi.mocked(fs.readdir).mockResolvedValue([]);

    await syncRepoCommand();

    expect(repoExists).toHaveBeenCalledWith('default-owner', 'test-repo');
  });

  it('should handle failure when syncing topics to GitHub', async () => {
    const pkg = {
      name: 'test-repo',
      keywords: ['kw1'],
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkg));
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(replaceTopics).mockRejectedValue(new Error('GitHub Error'));

    await syncRepoCommand();

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to sync topics to GitHub: GitHub Error')
    );
  });

  it('should sort files correctly: directories first, then files alphabetically', async () => {
    const pkg = {
      name: 'test-repo',
      files: [],
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkg));
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'b.txt', isDirectory: (): boolean => false },
      { name: 'a_dir', isDirectory: (): boolean => true },
      { name: 'a.txt', isDirectory: (): boolean => false },
      { name: 'b_dir', isDirectory: (): boolean => true },
    ] as any);

    await syncRepoCommand();

    const writtenPkg = JSON.parse(
      vi.mocked(fs.writeFile).mock.calls[0][1] as string
    );
    // Directories (a_dir, b_dir) then files (a.txt, b.txt)
    expect(writtenPkg.files).toEqual(['a_dir', 'b_dir', 'a.txt', 'b.txt']);
  });
});
