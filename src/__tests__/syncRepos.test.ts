import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncReposCommand } from '../commands/syncRepos.js';
import fs from 'fs/promises';
import { syncAllRepos } from '../utils/repoList.js';
import { Logger } from '../utils/logger.js';

vi.mock('fs/promises');
vi.mock('../utils/repoList.js');
vi.mock('../utils/logger.js');
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  })),
}));

describe('syncReposCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write a grouped report from the sync summary', async () => {
    vi.mocked(syncAllRepos).mockResolvedValue({
      pulled: 1,
      upToDate: 1,
      skippedDirty: 1,
      errors: 1,
      results: [
        { name: 'pulled-repo', pulled: true },
        { name: 'fresh-repo', pulled: false, skippedReason: 'up-to-date' },
        { name: 'dirty-repo', pulled: false, skippedReason: 'dirty' },
        { name: 'broken-repo', pulled: false, error: 'boom' },
      ],
    });

    await syncReposCommand();

    expect(fs.writeFile).toHaveBeenCalled();
    const content = vi.mocked(fs.writeFile).mock.calls[0]![1] as string;
    expect(content).toContain('SYNC_REPOS_REPORT');
    expect(content).toContain('1 pulled, 1 up to date, 1 skipped');
    expect(content).toContain('pulled-repo');
    expect(content).toContain('fresh-repo');
    expect(content).toContain('dirty-repo');
    expect(content).toContain('broken-repo: boom');
    expect(Logger.success).toHaveBeenCalledWith(
      expect.stringContaining('Sync completed')
    );
  });

  it('should log an error when the report cannot be written', async () => {
    vi.mocked(syncAllRepos).mockResolvedValue({
      pulled: 0,
      upToDate: 0,
      skippedDirty: 0,
      errors: 0,
      results: [],
    });
    vi.mocked(fs.writeFile).mockRejectedValue(new Error('disk full'));

    await syncReposCommand();

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to save report')
    );
  });
});
