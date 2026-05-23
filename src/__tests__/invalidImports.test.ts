import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scanner } from '../utils/scanner.js';
import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';

vi.mock('fs/promises');
vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});
vi.mock('child_process');
vi.mock('latest-version');
vi.mock('simple-git');
vi.mock('../settings.js', () => ({
  getLocalRepoPath: vi.fn((name) => `/mock/path/${name}`),
  settings: {},
}));
vi.mock('../utils/excludes.js', () => ({
  getExcludedPaths: vi.fn(() => []),
  isIssueExcluded: vi.fn(() => false),
  isKnipScanExcluded: vi.fn(() => false),
  isKnipUnusedDepsExcluded: vi.fn(() => false),
  getExcludedKnipPackages: vi.fn(() => []),
  getExcludedKnipPaths: vi.fn(() => []),
  isOutdatedScanExcluded: vi.fn(() => false),
  isLegacyProject: vi.fn(() => false),
}));
vi.mock('../github.js', () => ({
  parseGitHubUrl: vi.fn(() => ({ owner: 'user', repo: 'repo' })),
  getRepoMetadata: vi.fn(),
  isRepoStarred: vi.fn(),
  isRepoWatched: vi.fn(),
  getRulesets: vi.fn(),
}));
vi.mock('../utils/projectType.js', () => ({
  isTypeScriptProject: vi.fn(),
  isDotNetOrWindowsProject: vi.fn(),
}));

describe('Scanner - Invalid Imports', () => {
  let scanner: Scanner;
  const mockRepo = {
    name: 'test-repo',
    url: 'https://github.com/user/test-repo',
    type: 'active',
  };

  beforeEach(async (): Promise<void> => {
    vi.clearAllMocks();
    scanner = new Scanner();
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(fs.readFile).mockResolvedValue('');
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('' as any);

    const { isTypeScriptProject, isDotNetOrWindowsProject } =
      await import('../utils/projectType.js');
    vi.mocked(isTypeScriptProject).mockResolvedValue(true);
    vi.mocked(isDotNetOrWindowsProject).mockResolvedValue(false);
  });

  it('should report invalid imports for active projects', async (): Promise<void> => {
    const repoPath = '/mock/path/test-repo';

    // Mock file list
    vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
      const pathStr = p.toString().replace(/\\/g, '/');
      if (pathStr === repoPath) {
        return Promise.resolve([
          { name: 'src', isDirectory: (): boolean => true },
        ] as any);
      }
      if (pathStr === `${repoPath}/src`) {
        return Promise.resolve([
          { name: 'main.ts', isDirectory: (): boolean => false },
          { name: 'utils', isDirectory: (): boolean => true },
        ] as any);
      }
      if (pathStr === `${repoPath}/src/utils`) {
        return Promise.resolve([
          { name: 'logger.ts', isDirectory: (): boolean => false },
          { name: 'index.ts', isDirectory: (): boolean => false },
        ] as any);
      }
      return Promise.resolve([]);
    });

    // Mock file content
    vi.mocked(fs.readFile).mockImplementation((p: any): Promise<string> => {
      const pathStr = p.toString();
      if (pathStr.endsWith('main.ts')) {
        return Promise.resolve(
          "import { Logger } from './utils/logger.ts';\nimport { Other } from './other';"
        );
      }
      if (pathStr.endsWith('package.json')) {
        return Promise.resolve(JSON.stringify({ name: 'test-repo' }));
      }
      return Promise.resolve('');
    });

    // Mock existsSync and readFileSync for import resolution
    vi.mocked(existsSync).mockImplementation((p: any): boolean => {
      const pathStr = p.toString();
      // index exists in utils
      if (pathStr.endsWith('utils/index.ts')) return true;
      if (pathStr.endsWith('utils\\index.ts')) return true;
      return false;
    });

    vi.mocked(readFileSync).mockImplementation((p: any): any => {
      const pathStr = p.toString();
      // logger.ts exists
      if (pathStr.endsWith('utils/logger.ts')) return 'content' as any;
      if (pathStr.endsWith('utils\\logger.ts')) return 'content' as any;
      throw new Error('File not found');
    });

    const result = await scanner.scanRepo(mockRepo);

    const importIssue = result.issues.find((i): boolean =>
      i.message.includes('Direct file import used instead of index export')
    );
    expect(importIssue).toBeDefined();
    expect(importIssue?.message.replace(/\\/g, '/')).toContain('src/main.ts');
    expect(importIssue?.message).toContain('lines: 1');
  });

  it('should NOT report invalid imports for non-active projects', async (): Promise<void> => {
    const inactiveRepo = { ...mockRepo, type: 'legacy' };

    // Mock file content with invalid import
    vi.mocked(fs.readFile).mockImplementation((p: any): Promise<string> => {
      const pathStr = p.toString();
      if (pathStr.endsWith('main.ts')) {
        return Promise.resolve("import { Logger } from './utils/logger.ts';");
      }
      return Promise.resolve('');
    });

    const result = await scanner.scanRepo(inactiveRepo);
    const importIssue = result.issues.find((i): boolean =>
      i.message.includes('Direct file import used instead of index export')
    );
    expect(importIssue).toBeUndefined();
  });
});
