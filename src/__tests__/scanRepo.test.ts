import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scanRepoCommand } from '../commands/scanRepo.js';
import fs from 'fs/promises';
import { readRepoList } from '../utils/repoList.js';
import { input } from '../utils/prompts.js';
import { getLocalRepoPath } from '../settings.js';

// Mock dependencies
vi.mock('fs/promises');
vi.mock('../utils/repoList.js');
vi.mock('../utils/prompts.js');
vi.mock('../utils/logger.js');
vi.mock('../github.js');
vi.mock('../settings.js');
vi.mock('latest-version', () => ({
  default: vi.fn().mockResolvedValue('2.0.0'),
}));
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(Buffer.from('')),
}));
vi.mock('enquirer', () => ({
  default: {
    AutoComplete: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue('test-repo'),
    })),
  },
}));

describe('scanRepoCommand', () => {
  const mockRepoList = ['test-repo:https://github.com/user/test-repo'];
  const mockRepoPath = 'C:\\mock\\path\\test-repo';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readRepoList).mockResolvedValue(mockRepoList);
    vi.mocked(input).mockResolvedValue('test-repo');
    vi.mocked(getLocalRepoPath).mockReturnValue(mockRepoPath);
    vi.mocked(fs.readdir).mockResolvedValue(['.gitignore', 'README.md'] as any);
    vi.mocked(fs.readFile).mockResolvedValue('content');
    vi.mocked(fs.access).mockResolvedValue(undefined);
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
      'A'.repeat(150) +
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
            description: 'A'.repeat(150),
          })
        );
      return Promise.resolve('template content');
    });

    // Mock templates dir to be empty for simplicity
    vi.mocked(fs.readdir).mockResolvedValue([] as any);

    // Mock GitHub methods
    const { getRepoMetadata, isRepoStarred, isRepoWatched, getRulesets } =
      await import('../github.js');
    vi.mocked(getRepoMetadata).mockResolvedValue({
      homepage: 'https://linkedin.com/in/orassayag',
      description: 'A'.repeat(345),
    } as any);
    vi.mocked(isRepoStarred).mockResolvedValue(true);
    vi.mocked(isRepoWatched).mockResolvedValue(true);
    vi.mocked(getRulesets).mockResolvedValue([{ id: 1 }] as any);

    await scanRepoCommand();

    const calls = vi.mocked(fs.writeFile).mock.calls;
    const reportContent = calls.map((call) => call[1]).join('\n');

    expect(reportContent).toContain(
      '✨ No issues found! The repository follows all standards.'
    );
  });

  it('should report outdated packages as severity 3 (Low)', async () => {
    const pkgJson = {
      name: 'test-repo',
      version: '1.0.0',
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
      scripts: { test: 'vitest' },
      files: ['src'],
      dependencies: {
        express: '^1.0.0',
      },
      devDependencies: {
        vitest: '^1.0.0',
      },
      keywords: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
      description: 'A'.repeat(150),
    };

    vi.mocked(fs.readFile).mockImplementation((p: any) => {
      if (p.toString().endsWith('package.json'))
        return Promise.resolve(JSON.stringify(pkgJson));
      if (p.toString().endsWith('README.md'))
        return Promise.resolve(
          '# Test Repo\n' +
            'A'.repeat(150) +
            '\nFeatures\nCore Capabilities\nTechnical Excellence\nDeveloper Experience\nGetting Started\nPrerequisites\nInstallation\nConfiguration\nUsage\nAvailable Scripts\nBest Practices\nDevelopment\nArchitecture Principles\nArchitecture\nDirectory Structure\nDesign Patterns\nContributing\nLicense\nSupport\nAuthor\nAcknowledgments'
        );
      if (p.toString().endsWith('INSTRUCTIONS.md'))
        return Promise.resolve(
          'Setup and Usage Instructions\nTable of Contents\nPrerequisites\nSystem Requirements\nInitial Setup\nInstall Dependencies\nAvailable Commands\nDevelopment Commands\nRunning Scripts\nTroubleshooting\nExtending the Application\nBest Practices\nDocumentation\nExternal Resources\nAuthor\nLast Updated\nVersion'
        );
      return Promise.resolve('template content');
    });

    await scanRepoCommand();

    const calls = vi.mocked(fs.writeFile).mock.calls;
    const reportContent = calls.map((call) => call[1]).join('\n');

    expect(reportContent).toContain(
      '3 - Low - Fix when have time, nice to have:'
    );
    expect(reportContent).toContain(
      '-Package "express" is outdated. Current: ^1.0.0, Latest: 2.0.0'
    );
    expect(reportContent).toContain(
      '-Package "vitest" is outdated. Current: ^1.0.0, Latest: 2.0.0'
    );
  });
});
