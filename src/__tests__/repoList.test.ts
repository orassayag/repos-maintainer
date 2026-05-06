import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { readRepoList, addOrUpdateRepoInList } from '../utils/repoList.js';
import { getReposListPath } from '../settings.js';
import { Logger } from '../utils/logger.js';

vi.mock('fs/promises');
vi.mock('../settings.js');
vi.mock('../utils/logger.js');

describe('repoList', () => {
  const mockFilePath = '/path/to/repos.txt';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReposListPath).mockReturnValue(mockFilePath);
  });

  describe('readRepoList', () => {
    it('should return empty array if file does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));
      const result = await readRepoList();
      expect(result).toEqual([]);
    });

    it('should parse repo list and filter comments', async () => {
      const content = `
# This is a comment
repo1: https://github.com/user/repo1
  repo2: https://github.com/user/repo2  

# Another comment
repo3
`;
      vi.mocked(fs.readFile).mockResolvedValue(content);
      const result = await readRepoList();
      expect(result).toEqual([
        'repo1: https://github.com/user/repo1',
        'repo2: https://github.com/user/repo2',
        'repo3',
      ]);
    });
  });

  describe('addOrUpdateRepoInList', () => {
    it('should add a new repo to an empty list', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('');
      await addOrUpdateRepoInList('new-repo', 'https://github.com/user/new-repo');

      expect(fs.writeFile).toHaveBeenCalledWith(
        mockFilePath,
        'new-repo: https://github.com/user/new-repo\n',
        'utf-8'
      );
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('new-repo'));
    });

    it('should update an existing repo and keep it sorted', async () => {
      const existingContent = 'repo-b: url-b\nrepo-a: url-a';
      vi.mocked(fs.readFile).mockResolvedValue(existingContent);

      await addOrUpdateRepoInList('repo-c', 'url-c');

      const expectedContent = [
        'repo-a: url-a',
        'repo-b: url-b',
        'repo-c: url-c',
      ].join('\n') + '\n';

      expect(fs.writeFile).toHaveBeenCalledWith(mockFilePath, expectedContent, 'utf-8');
    });

    it('should handle updates for existing names (case-insensitive)', async () => {
      const existingContent = 'Repo-A: old-url';
      vi.mocked(fs.readFile).mockResolvedValue(existingContent);

      await addOrUpdateRepoInList('repo-a', 'new-url');

      expect(fs.writeFile).toHaveBeenCalledWith(
        mockFilePath,
        'repo-a: new-url\n',
        'utf-8'
      );
    });

    it('should handle entries without URLs', async () => {
      const existingContent = 'repo-legacy';
      vi.mocked(fs.readFile).mockResolvedValue(existingContent);

      await addOrUpdateRepoInList('repo-new', 'url-new');

      const expectedContent = 'repo-legacy\nrepo-new: url-new\n';
      expect(fs.writeFile).toHaveBeenCalledWith(mockFilePath, expectedContent, 'utf-8');
    });
  });
});
