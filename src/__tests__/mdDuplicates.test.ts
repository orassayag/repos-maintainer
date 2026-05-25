import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scanner } from '../utils/scanner.js';
import fs from 'fs/promises';

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
  isKnipScanExcluded: vi.fn(() => true), // Skip knip for speed
  isKnipUnusedDepsExcluded: vi.fn(() => true),
  getExcludedKnipPackages: vi.fn(() => []),
  getExcludedKnipPaths: vi.fn(() => []),
  isOutdatedScanExcluded: vi.fn(() => true),
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
  isTypeScriptProject: vi.fn(() => Promise.resolve(false)),
  isDotNetOrWindowsProject: vi.fn(() => Promise.resolve(false)),
}));

describe('Scanner - MD Duplicate Titles', () => {
  let scanner: Scanner;
  const mockRepo = {
    name: 'test-repo',
    url: 'https://github.com/user/test-repo',
  };

  beforeEach((): void => {
    vi.clearAllMocks();
    scanner = new Scanner();
    vi.mocked(fs.access).mockResolvedValue(undefined);
  });

  it('should detect duplicate titles of the same level', async (): Promise<void> => {
    const mdContent = `
# Title
## Section 1
## Section 2
## Section 1
### Subtitle
### Subtitle
`;
    vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
      if (p.toString() === '/mock/path/test-repo') {
        return Promise.resolve([
          { name: 'README.md', isDirectory: (): boolean => false },
        ] as any);
      }
      return Promise.resolve([]);
    });

    vi.mocked(fs.readFile).mockImplementation((p: any): Promise<string> => {
      if (p.toString().endsWith('README.md')) {
        return Promise.resolve(mdContent);
      }
      return Promise.resolve('');
    });

    const result = await scanner.scanRepo(mockRepo);

    const duplicateIssues = result.issues.filter((i) =>
      i.message.includes('Duplicate MD title')
    );

    expect(duplicateIssues).toHaveLength(2);
    expect(duplicateIssues[0].message).toContain('Section 1');
    expect(duplicateIssues[0].message).toContain('level 2');
    expect(duplicateIssues[1].message).toContain('Subtitle');
    expect(duplicateIssues[1].message).toContain('level 3');
  });

  it('should NOT detect duplicate titles of different levels', async (): Promise<void> => {
    const mdContent = `
# Title
## License
### License
`;
    vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
      if (p.toString() === '/mock/path/test-repo') {
        return Promise.resolve([
          { name: 'README.md', isDirectory: (): boolean => false },
        ] as any);
      }
      return Promise.resolve([]);
    });

    vi.mocked(fs.readFile).mockImplementation((p: any): Promise<string> => {
      if (p.toString().endsWith('README.md')) {
        return Promise.resolve(mdContent);
      }
      return Promise.resolve('');
    });

    const result = await scanner.scanRepo(mockRepo);

    const duplicateIssues = result.issues.filter((i) =>
      i.message.includes('Duplicate MD title')
    );

    expect(duplicateIssues).toHaveLength(0);
  });

  it('should ignore headings inside code blocks', async (): Promise<void> => {
    const mdContent = `
# Title
## Section
\`\`\`
## Section
\`\`\`
`;
    vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
      if (p.toString() === '/mock/path/test-repo') {
        return Promise.resolve([
          { name: 'README.md', isDirectory: (): boolean => false },
        ] as any);
      }
      return Promise.resolve([]);
    });

    vi.mocked(fs.readFile).mockImplementation((p: any): Promise<string> => {
      if (p.toString().endsWith('README.md')) {
        return Promise.resolve(mdContent);
      }
      return Promise.resolve('');
    });

    const result = await scanner.scanRepo(mockRepo);

    const duplicateIssues = result.issues.filter((i) =>
      i.message.includes('Duplicate MD title')
    );

    expect(duplicateIssues).toHaveLength(0);
  });

  it('should skip duplicate title detection if the purpose is training', async (): Promise<void> => {
    const mdContent = `
# Title
## Section 1
## Section 1
`;
    vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
      if (p.toString() === '/mock/path/test-repo') {
        return Promise.resolve([
          { name: 'README.md', isDirectory: (): boolean => false },
        ] as any);
      }
      return Promise.resolve([]);
    });

    vi.mocked(fs.readFile).mockImplementation((p: any): Promise<string> => {
      if (p.toString().endsWith('README.md')) {
        return Promise.resolve(mdContent);
      }
      return Promise.resolve('');
    });

    const trainingRepo = { ...mockRepo, purpose: 'training' };
    const result = await scanner.scanRepo(trainingRepo);

    const duplicateIssues = result.issues.filter((i) =>
      i.message.includes('Duplicate MD title')
    );

    expect(duplicateIssues).toHaveLength(0);
  });
});
