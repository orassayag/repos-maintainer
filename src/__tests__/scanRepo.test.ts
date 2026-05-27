import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanRepoCommand } from '../commands/scanRepo.js';
import fs from 'fs/promises';
import { Logger } from '../utils/logger.js';
import { readRepoList } from '../utils/repoList.js';
import { input } from '../utils/prompts.js';
import { selectRepo } from '../utils/repoSelector.js';
import { getLocalRepoPath } from '../settings.js';

// Mock dependencies
vi.mock('fs/promises');
vi.mock('../utils/repoList.js');
vi.mock('../utils/repoSelector.js');
vi.mock('../utils/prompts.js');
vi.mock('../utils/logger.js');
vi.mock('../github.js');
vi.mock('../settings.js');
vi.mock('../utils/excludes.js', () => ({
  getExcludedPaths: vi.fn(() => []),
  isIssueExcluded: vi.fn(() => false),
  isProjectExcluded: vi.fn(() => false),
  isKnipScanExcluded: vi.fn(() => false),
  isOutdatedScanExcluded: vi.fn(() => false),
  isLegacyProject: vi.fn(() => false),
  getExcludedKnipPackages: vi.fn(() => []),
}));
vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    readFileSync: vi.fn().mockImplementation((p: string, encoding: string) => {
      if (p.includes('package.json')) {
        // We'll override this in tests if needed, but provide a default
        return JSON.stringify({ name: 'test-repo' });
      }
      return actual.readFileSync(p, encoding);
    }),
    existsSync: vi.fn().mockImplementation((p: string) => {
      if (p.includes('node_modules')) return false;
      return true;
    }),
  };
});
vi.mock('latest-version', () => ({
  default: vi.fn().mockResolvedValue('2.0.0'),
}));
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from('')),
  spawnSync: vi.fn().mockReturnValue({
    stdout: '',
    stderr: '',
    status: 0,
  }),
}));
vi.mock('enquirer', () => {
  class MockSelect {
    run = vi.fn().mockResolvedValue('test-repo');
  }
  return {
    Select: MockSelect,
    default: {
      Select: MockSelect,
      AutoComplete: MockSelect,
    },
  };
});

describe('scanRepoCommand', () => {
  const mockRepoList = [
    { name: 'test-repo', url: 'https://github.com/user/test-repo' },
  ];
  const mockRepoPath = 'C:\\mock\\path\\test-repo';

  beforeEach(async () => {
    vi.clearAllMocks();
    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValue(true);

    vi.mocked(selectRepo).mockResolvedValue({
      name: 'test-repo',
      url: 'https://github.com/user/test-repo',
    });
    vi.mocked(readRepoList).mockResolvedValue(mockRepoList);
    vi.mocked(input).mockResolvedValue('test-repo');
    vi.mocked(getLocalRepoPath).mockReturnValue(mockRepoPath);
    vi.mocked(fs.readdir).mockImplementation((_p: any, options: any) => {
      if (options?.withFileTypes) {
        return Promise.resolve([
          { name: '.gitignore', isDirectory: (): boolean => false },
          { name: 'README.md', isDirectory: (): boolean => false },
        ] as any);
      }
      return Promise.resolve(['.gitignore', 'README.md'] as any);
    });
    vi.mocked(fs.readFile).mockResolvedValue('content');
    vi.mocked(fs.access).mockResolvedValue(undefined);

    const { getRulesets } = await import('../github.js');
    vi.mocked(getRulesets).mockResolvedValue([
      {
        name: 'Protect main branch',
        enforcement: 'active',
        target: 'branch',
        conditions: {},
        bypass_actors: [],
        rules: [],
      },
    ]);
  });

  it('should generate a report with grouped issues by severity', async () => {
    // Mock fs.access to fail for .gitignore (Medium) and fail for some README section (Low)
    vi.mocked(fs.access).mockImplementation((p: any) => {
      if (p.toString().endsWith('.gitignore'))
        return Promise.reject(new Error('Not found'));
      return Promise.resolve();
    });

    vi.mocked(fs.readFile).mockImplementation((p: any) => {
      if (p.toString().endsWith('README.md'))
        return Promise.resolve('# Test Repo\nMissing sections here');
      if (p.toString().includes('templates'))
        return Promise.resolve('template content');
      return Promise.resolve('');
    });

    await scanRepoCommand();

    // Verify report structure
    const calls = vi.mocked(fs.writeFile).mock.calls;
    const reportContent = calls.map((call) => call[1]).join('\n');

    expect(reportContent).toContain('2 - Medium - Need to be addressed:');
    expect(reportContent).toContain('-Missing template file: .gitignore');
    expect(reportContent).toContain(
      '3 - Low - Fix when have time, nice to have:'
    );
    expect(reportContent).toContain('-README.md: Missing section');
  });

  it('should show "No issues found" when there are no issues', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    const fullReadme =
      '# Test Repo\n' +
      'A'.repeat(295) +
      '\nFeatures\nCore Capabilities\nTechnical Excellence\nDeveloper Experience\nGetting Started\nPrerequisites\nInstallation\nConfiguration\nUsage\nAvailable Scripts\nBest Practices\nDevelopment\nArchitecture Principles\nArchitecture\nDirectory Structure\nDesign Patterns\nContributing\nLicense\nSupport\nAuthor\nAcknowledgments';
    const fullInstructions =
      'Setup and Usage Instructions\nTable of Contents\nPrerequisites\nSystem Requirements\nInitial Setup\nInstall Dependencies\nAvailable Commands\nDevelopment Commands\nRunning Scripts\nTroubleshooting\nExtending the Application\nBest Practices\nDocumentation\nExternal Resources\nAuthor\nLast Updated\nVersion';

    vi.mocked(fs.readFile).mockImplementation((p: any) => {
      if (p.toString().endsWith('README.md'))
        return Promise.resolve(fullReadme);
      if (p.toString().endsWith('INSTRUCTIONS.md'))
        return Promise.resolve(fullInstructions);
      if (p.toString().endsWith('package.json'))
        return Promise.resolve(
          JSON.stringify({
            name: 'test-repo',
            author: {
              name: 'Or Assayag',
              email: 'orassayag@gmail.com',
              url: 'https://github.com/orassayag',
            },
            license: 'MIT',
            repository: {
              type: 'git',
              url: 'git://github.com/orassayag/test-repo.git',
            },
            homepage: 'https://github.com/orassayag/test-repo#readme',
            bugs: { url: 'https://github.com/orassayag/test-repo/issues' },
            funding: {
              type: 'github',
              url: 'https://github.com/sponsors/orassayag',
            },
            engines: { node: '>=20' },
            contributors: [
              {
                name: 'Or Assayag',
                email: 'orassayag@gmail.com',
                url: 'https://github.com/orassayag',
              },
            ],
            main: 'index.js',
            type: 'module',
            scripts: { start: 'node index.js' },
            files: ['dist'],
            dependencies: {},
            devDependencies: {},
            keywords: ['1', '2', '3', '4', '5', '6', '7', '8'],
            description: 'A'.repeat(295),
          })
        );
      return Promise.resolve('template content');
    });

    // Mock templates dir and repo root to have 'dist' to match package.json
    vi.mocked(fs.readdir).mockImplementation((_p: any, options: any) => {
      if (options?.withFileTypes) {
        return Promise.resolve([
          { name: 'dist', isDirectory: (): boolean => false },
        ] as any);
      }
      return Promise.resolve(['dist'] as any);
    });

    // Mock GitHub methods
    const {
      parseGitHubUrl,
      getRepoMetadata,
      isRepoStarred,
      isRepoWatched,
      getRulesets,
    } = await import('../github.js');
    vi.mocked(parseGitHubUrl).mockReturnValue({
      owner: 'orassayag',
      repo: 'test-repo',
    });
    vi.mocked(getRepoMetadata).mockResolvedValue({
      homepage: 'https://linkedin.com/in/orassayag',
      description: 'A'.repeat(345),
      topics: ['1', '2', '3', '4', '5', '6', '7', '8'],
    } as any);
    vi.mocked(isRepoStarred).mockResolvedValue(true);
    vi.mocked(isRepoWatched).mockResolvedValue(true);
    vi.mocked(getRulesets).mockResolvedValue([
      {
        name: 'Protect main branch',
        enforcement: 'active',
        target: 'branch',
        conditions: {},
        bypass_actors: [],
        rules: [],
      },
    ]);

    await scanRepoCommand();

    const calls = vi.mocked(fs.writeFile).mock.calls;
    const reportContent = calls.map((call) => call[1]).join('\n');

    expect(reportContent).toContain(
      '✨ No issues found! The repository follows all standards.'
    );
  });

  it('should handle scan failure', async () => {
    vi.mocked(selectRepo).mockRejectedValue(new Error('scan failed'));

    await scanRepoCommand();

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Scan failed: scan failed')
    );
  });
});
