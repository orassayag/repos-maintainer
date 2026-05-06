import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureRepoCloned, commitAndPush, runGitClean } from '../utils/git.js';
import { simpleGit } from 'simple-git';
import fs from 'fs/promises';
import { getLocalRepoPath } from '../settings.js';
import { Logger } from '../utils/logger.js';

vi.mock('simple-git');
vi.mock('fs/promises');
vi.mock('../settings.js');
vi.mock('../utils/logger.js');

describe('git', () => {
  const mockRepoPath = '/mock/path/repo';
  const mockGit: any = {
    getRemotes: vi.fn(),
    pull: vi.fn(),
    clone: vi.fn(),
    status: vi.fn(),
    add: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
    raw: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(simpleGit).mockReturnValue(mockGit);
    vi.mocked(getLocalRepoPath).mockReturnValue(mockRepoPath);
  });

  describe('ensureRepoCloned', () => {
    it('should clone if folder does not exist', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('not found'));
      
      const result = await ensureRepoCloned('http://repo.git', 'repo');
      
      expect(result).toBe(true);
      expect(mockGit.clone).toHaveBeenCalledWith('http://repo.git', mockRepoPath);
      expect(Logger.success).toHaveBeenCalledWith(expect.stringContaining('Cloned repo'));
    });

    it('should pull if folder exists and remote matches', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      mockGit.getRemotes.mockResolvedValue([{ name: 'origin', refs: { fetch: 'http://repo.git' } }]);
      mockGit.pull.mockResolvedValue({});

      const result = await ensureRepoCloned('http://repo.git', 'repo');

      expect(result).toBe(true);
      expect(mockGit.pull).toHaveBeenCalledWith('origin', 'main', { '--rebase': null });
    });

    it('should return false if no origin remote', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      mockGit.getRemotes.mockResolvedValue([]);

      const result = await ensureRepoCloned('http://repo.git', 'repo');

      expect(result).toBe(false);
      expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('No \'origin\' remote'));
    });

    it('should return false if remote mismatch', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      mockGit.getRemotes.mockResolvedValue([{ name: 'origin', refs: { fetch: 'http://other.git' } }]);

      const result = await ensureRepoCloned('http://repo.git', 'repo');

      expect(result).toBe(false);
      expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining('Remote mismatch'));
    });
  });

  describe('commitAndPush', () => {
    it('should return false if nothing to commit', async () => {
      mockGit.status.mockResolvedValue({ files: [] });
      
      const result = await commitAndPush(mockRepoPath);
      
      expect(result).toBe(false);
      expect(mockGit.commit).not.toHaveBeenCalled();
    });

    it('should commit and push changes', async () => {
      mockGit.status.mockResolvedValue({ files: ['file.txt'] });
      mockGit.add.mockResolvedValue({});
      mockGit.commit.mockResolvedValue({});
      mockGit.push.mockResolvedValue({});

      const result = await commitAndPush(mockRepoPath, 'feat: update');

      expect(result).toBe(true);
      expect(mockGit.add).toHaveBeenCalledWith('.');
      expect(mockGit.commit).toHaveBeenCalledWith('feat: update');
      expect(mockGit.push).toHaveBeenCalledWith('origin');
    });

    it('should handle force push', async () => {
      mockGit.status.mockResolvedValue({ files: ['file.txt'] });
      const result = await commitAndPush(mockRepoPath, 'feat: update', true);

      expect(result).toBe(true);
      expect(mockGit.push).toHaveBeenCalledWith('origin', undefined, { '--force-with-lease': null });
    });
  });

  describe('runGitClean', () => {
    it('should run gc and reflog commands', async () => {
      await runGitClean(mockRepoPath);
      expect(mockGit.raw).toHaveBeenCalledTimes(3);
      expect(Logger.success).toHaveBeenCalled();
    });
  });
});
