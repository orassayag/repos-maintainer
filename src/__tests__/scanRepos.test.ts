import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanReposCommand } from '../commands/scanRepos.js';
import fs from 'fs/promises';
import { readRepoList } from '../utils/repoList.js';
import { Scanner } from '../utils/scanner.js';
import { Logger } from '../utils/logger.js';

vi.mock('fs/promises');
vi.mock('../utils/repoList.js');
vi.mock('../utils/scanner.js');
vi.mock('../utils/logger.js');
vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  })),
}));
vi.mock('../settings.js', () => ({
  settings: {
    PROJECTS_ROOT: '/mock/projects',
    AUTHOR_GITHUB: 'user',
    EXCLUDED_PROJECTS: [],
  },
}));

describe('scanReposCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should scan directories and generate a report', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'repo1', isDirectory: (): boolean => true },
      { name: 'repo2', isDirectory: (): boolean => true },
    ] as any);
    vi.mocked(readRepoList).mockResolvedValue(['repo1: url1']);
    
    const mockScanner = {
      scanRepo: vi.fn().mockResolvedValue({
        repoName: 'repo1',
        issues: [{ severity: '3 - Low - Fix when have time, nice to have', message: 'issue1' }],
        maxSeverity: 3,
      }),
    };
    vi.mocked(Scanner).mockImplementation(function() {
      return mockScanner as any;
    });

    await scanReposCommand();

    expect(fs.writeFile).toHaveBeenCalled();
    expect(Logger.log).toHaveBeenCalledWith(expect.stringContaining('Found 2 directories'));
  });

  it('should handle empty projects root', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([]);
    await scanReposCommand();
    expect(Logger.error).toHaveBeenCalledWith(expect.stringContaining('No directories found'));
  });

  it('should handle readdir error', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error('fail'));
    await scanReposCommand();
    expect(Logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to read projects root'));
  });
});
