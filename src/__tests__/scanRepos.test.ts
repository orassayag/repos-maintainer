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
  },
}));
vi.mock('../utils/excludes.js', () => ({
  isProjectExcluded: vi.fn(() => false),
}));

describe('scanReposCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
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
        issues: [
          {
            severity: '3 - Low - Fix when have time, nice to have',
            message: 'issue1',
          },
        ],
        maxSeverity: 3,
      }),
    };
    vi.mocked(Scanner).mockImplementation(function () {
      return mockScanner as any;
    });

    await scanReposCommand();

    expect(fs.writeFile).toHaveBeenCalled();
    expect(Logger.log).toHaveBeenCalledWith(
      expect.stringContaining('Found 2 directories')
    );
  });

  it('should handle empty projects root', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([]);
    await scanReposCommand();
    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('No directories found')
    );
  });

  it('should handle readdir error', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error('fail'));
    await scanReposCommand();
    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read projects root')
    );
  });

  it('should handle scan errors and sorting', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: 'repo-b', isDirectory: (): boolean => true },
      { name: 'repo-a', isDirectory: (): boolean => true },
    ] as any);
    vi.mocked(readRepoList).mockResolvedValue([]);

    const mockScanner = {
      scanRepo: vi.fn().mockImplementation((repo: any) => {
        if (repo.name === 'repo-a') {
          return {
            repoName: 'repo-a',
            issues: [
              {
                severity: '1 - High - Most critical - Fix ASAP',
                message: 'msg',
              },
            ],
            maxSeverity: 1,
          };
        }
        throw new Error('fail');
      }),
    };
    vi.mocked(Scanner).mockImplementation(function () {
      return mockScanner as any;
    });

    await scanReposCommand();

    const writeCall = vi.mocked(fs.writeFile).mock.calls[0];
    const content = writeCall![1] as string;
    expect(content).toContain('repo-a');
    expect(content).toContain('repo-b');
  });
});
