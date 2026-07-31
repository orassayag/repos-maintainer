import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs/promises';
import {
  readRepoList,
  addOrUpdateRepoInList,
  syncAllRepos,
} from '../utils/repoList.js';
import { getReposListPath, getLocalRepoPath } from '../settings.js';
import { pullLatestForRepo } from '../utils/git.js';
import { Logger } from '../utils/logger.js';

vi.mock('fs/promises');
vi.mock('../settings.js');
vi.mock('../utils/git.js');
vi.mock('../github.js');
vi.mock('../utils/logger.js');

describe('repoList', () => {
  const mockFilePath = '/path/to/repos.json';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReposListPath).mockReturnValue(mockFilePath);
    vi.mocked(getLocalRepoPath).mockImplementation(
      (name: string) => `/projects/${name}`
    );
  });

  describe('readRepoList', () => {
    it('should return empty array if JSON is invalid', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('invalid json');
      const result = await readRepoList();
      expect(result).toEqual([]);
    });
    it('should return empty array if file does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));
      const result = await readRepoList();
      expect(result).toEqual([]);
    });

    it('should parse repo list', async () => {
      const repos = [
        { name: 'repo1', url: 'https://github.com/user/repo1', type: 'active' },
        { name: 'repo2', url: 'https://github.com/user/repo2', type: 'active' },
      ];
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(repos));
      const result = await readRepoList();
      expect(result).toEqual(repos);
    });
  });

  describe('addOrUpdateRepoInList', () => {
    it('should add a new repo to an empty list', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('[]');
      await addOrUpdateRepoInList(
        'new-repo',
        'https://github.com/user/new-repo'
      );

      const expectedContent = JSON.stringify(
        [
          {
            name: 'new-repo',
            url: 'https://github.com/user/new-repo',
            type: 'active',
            purpose: 'personal',
            structure: 'single',
          },
        ],
        null,
        2
      );

      expect(fs.writeFile).toHaveBeenCalledWith(
        mockFilePath,
        expectedContent,
        'utf-8'
      );
      expect(Logger.success).toHaveBeenCalledWith(
        expect.stringContaining('new-repo')
      );
    });

    it('should update an existing repo and keep it sorted', async () => {
      const existingRepos = [
        { name: 'repo-b', url: 'url-b', type: 'active' },
        { name: 'repo-a', url: 'url-a', type: 'active' },
      ];
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingRepos));

      await addOrUpdateRepoInList('repo-c', 'url-c');

      const expectedRepos = [
        { name: 'repo-a', url: 'url-a', type: 'active' },
        { name: 'repo-b', url: 'url-b', type: 'active' },
        {
          name: 'repo-c',
          url: 'url-c',
          type: 'active',
          purpose: 'personal',
          structure: 'single',
        },
      ];

      expect(fs.writeFile).toHaveBeenCalledWith(
        mockFilePath,
        JSON.stringify(expectedRepos, null, 2),
        'utf-8'
      );
    });

    it('should handle updates for existing names (case-insensitive)', async () => {
      const existingRepos = [
        { name: 'Repo-A', url: 'old-url', type: 'active' },
      ];
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingRepos));

      await addOrUpdateRepoInList('repo-a', 'new-url');

      const expectedRepos = [
        { name: 'Repo-A', url: 'new-url', type: 'active' },
      ];

      expect(fs.writeFile).toHaveBeenCalledWith(
        mockFilePath,
        JSON.stringify(expectedRepos, null, 2),
        'utf-8'
      );
    });
  });

  describe('syncAllRepos', () => {
    const listRepos = (names: string[]): void => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(names.map((name) => ({ name, url: `url-${name}` })))
      );
    };

    it('should aggregate per-repo pull outcomes into a summary', async () => {
      listRepos(['pulled', 'fresh', 'dirty']);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(pullLatestForRepo).mockImplementation(async (_p, name) => {
        if (name === 'pulled') return { pulled: true };
        if (name === 'fresh')
          return { pulled: false, skippedReason: 'up-to-date' };
        return { pulled: false, skippedReason: 'dirty' };
      });

      const summary = await syncAllRepos();

      expect(summary.pulled).toBe(1);
      expect(summary.upToDate).toBe(1);
      expect(summary.skippedDirty).toBe(1);
      expect(summary.errors).toBe(0);
      expect(summary.results).toHaveLength(3);
    });

    it('should record an error when a repo is not cloned locally', async () => {
      listRepos(['missing']);
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const summary = await syncAllRepos();

      expect(summary.errors).toBe(1);
      expect(pullLatestForRepo).not.toHaveBeenCalled();
      expect(summary.results[0].error).toContain('not cloned');
    });

    it('should record an error when the pull throws', async () => {
      listRepos(['boom']);
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(pullLatestForRepo).mockRejectedValue(new Error('rebase fail'));

      const summary = await syncAllRepos();

      expect(summary.errors).toBe(1);
      expect(summary.results[0].error).toBe('rebase fail');
      expect(Logger.error).toHaveBeenCalled();
    });
  });
});
