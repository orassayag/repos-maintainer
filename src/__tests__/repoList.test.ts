import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { readRepoList, addOrUpdateRepoInList } from '../utils/repoList.js';
import { getReposListPath } from '../settings.js';
import { Logger } from '../utils/logger.js';

vi.mock('fs/promises');
vi.mock('../settings.js');
vi.mock('../utils/logger.js');

describe('repoList', () => {
  const mockFilePath = '/path/to/repos.json';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReposListPath).mockReturnValue(mockFilePath);
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
});
