import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scanner } from '../utils/scanner.js';
import { isLegacyProject } from '../utils/excludes.js';
import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { spawnSync, execSync } from 'child_process';
import path from 'path';

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
  isGithubHomepageWarningExcluded: vi.fn(() => false),
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

describe('Scanner', () => {
  let scanner: Scanner;
  const mockRepo = {
    name: 'test-repo',
    url: 'https://github.com/user/test-repo',
  };

  beforeEach(async (): Promise<void> => {
    const {
      isKnipScanExcluded,
      isKnipUnusedDepsExcluded,
      getExcludedKnipPackages,
      getExcludedKnipPaths,
      isOutdatedScanExcluded,
    } = await import('../utils/excludes.js');
    vi.mocked(isKnipScanExcluded).mockReturnValue(false);
    vi.mocked(isKnipUnusedDepsExcluded).mockReturnValue(false);
    vi.mocked(getExcludedKnipPackages).mockReturnValue([]);
    vi.mocked(getExcludedKnipPaths).mockReturnValue([]);
    vi.mocked(isOutdatedScanExcluded).mockReturnValue(false);
    vi.mocked(isLegacyProject).mockReturnValue(false);

    vi.clearAllMocks();
    scanner = new Scanner();
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(fs.readFile).mockResolvedValue('');
    vi.mocked(spawnSync).mockReturnValue({
      stdout: '',
      stderr: '',
      status: 0,
    } as any);
    vi.mocked(execSync).mockReturnValue('' as any);
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readFileSync).mockReturnValue('');
    const { isTypeScriptProject, isDotNetOrWindowsProject } =
      await import('../utils/projectType.js');
    vi.mocked(isTypeScriptProject).mockResolvedValue(false);
    vi.mocked(isDotNetOrWindowsProject).mockResolvedValue(false);
  });

  describe('Temporary Scan Logic', () => {
    it('should report "Possible invalid scripts" if "start:live" exists in package.json', async () => {
      vi.mocked(fs.readFile).mockImplementation((p: any) => {
        if (p.toString().endsWith('package.json')) {
          return Promise.resolve(
            JSON.stringify({
              name: 'test-repo',
              scripts: { 'start:live': 'node index.js' },
            })
          );
        }
        return Promise.resolve('');
      });

      const result = await scanner.scanRepo(mockRepo);
      const issue = result.issues.find((i) =>
        i.message.includes('Possible invalid scripts')
      );

      expect(issue).toBeDefined();
      expect(issue?.severity).toBe('1 - High - Most critical - Fix ASAP');
    });

    it('should NOT report "Possible invalid scripts" if "start:live" does NOT exist', async () => {
      vi.mocked(fs.readFile).mockImplementation((p: any) => {
        if (p.toString().endsWith('package.json')) {
          return Promise.resolve(
            JSON.stringify({
              name: 'test-repo',
              scripts: { start: 'node index.js' },
            })
          );
        }
        return Promise.resolve('');
      });

      const result = await scanner.scanRepo(mockRepo);
      const issue = result.issues.find((i) =>
        i.message.includes('Possible invalid scripts')
      );

      expect(issue).toBeUndefined();
    });
  });

  describe('isDotNetOrWindowsProject Skipping', () => {
    it('should skip scanFormatters and scanKnip for .NET projects', async (): Promise<void> => {
      const { isDotNetOrWindowsProject } =
        await import('../utils/projectType.js');
      vi.mocked(isDotNetOrWindowsProject).mockResolvedValue(true);

      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({
            name: 'test-repo',
            scripts: { test: 'vitest' },
          });
        return '';
      });

      await scanner.scanRepo(mockRepo);

      // Verify scanFormatters was skipped (by checking if prettier/eslint commands were NOT called)
      expect(spawnSync).not.toHaveBeenCalledWith(
        expect.stringContaining('prettier'),
        expect.any(Object)
      );
      expect(spawnSync).not.toHaveBeenCalledWith(
        expect.stringContaining('eslint'),
        expect.any(Object)
      );
      // Verify scanKnip was skipped
      expect(spawnSync).not.toHaveBeenCalledWith(
        expect.stringContaining('knip'),
        expect.any(Object)
      );

      // Verify VITEST_CONFIG_MISSING was skipped
      const result = await scanner.scanRepo(mockRepo);
      expect(
        result.issues.some((i) =>
          i.message.includes('Vitest: Missing "vitest.config.ts"')
        )
      ).toBe(false);
    });
  });

  describe('Template Scan', () => {
    it('should NOT report missing TS template files for JS-only projects', async (): Promise<void> => {
      const { isTypeScriptProject } = await import('../utils/projectType.js');
      vi.mocked(isTypeScriptProject).mockResolvedValue(false);

      const templatesDir = path.join(process.cwd(), 'src', 'templates');
      vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
        const pathStr = p.toString();
        if (pathStr === templatesDir) {
          return Promise.resolve([
            {
              name: 'tsconfig.json',
              isDirectory: (): boolean => false,
            },
          ] as any);
        }
        return Promise.resolve([]);
      });

      vi.mocked(fs.access).mockImplementation((p: any): Promise<void> => {
        const pathStr = p.toString();
        if (pathStr.includes('tsconfig.json'))
          return Promise.reject(new Error('Not found'));
        return Promise.resolve(undefined);
      });

      const result = await scanner.scanRepo(mockRepo);

      const missingTsConfig = result.issues.find((i) =>
        i.message.includes('Missing template file: tsconfig.json')
      );
      expect(missingTsConfig).toBeUndefined();
    });

    it('should report missing TS template files for TS projects', async (): Promise<void> => {
      const { isTypeScriptProject } = await import('../utils/projectType.js');
      vi.mocked(isTypeScriptProject).mockResolvedValue(true);

      const templatesDir = path.join(process.cwd(), 'src', 'templates');
      vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
        const pathStr = p.toString();
        if (pathStr === templatesDir) {
          return Promise.resolve([
            {
              name: 'tsconfig.json',
              isDirectory: (): boolean => false,
            },
          ] as any);
        }
        return Promise.resolve([]);
      });

      vi.mocked(fs.access).mockImplementation((p: any): Promise<void> => {
        const pathStr = p.toString();
        if (pathStr.includes('tsconfig.json'))
          return Promise.reject(new Error('Not found'));
        return Promise.resolve(undefined);
      });

      const result = await scanner.scanRepo(mockRepo);

      const missingTsConfig = result.issues.find((i) =>
        i.message.includes('Missing template file: tsconfig.json')
      );
      expect(missingTsConfig).toBeDefined();
    });

    it('should ignore missing src/index.ts for non-active projects', async (): Promise<void> => {
      const templatesDir = path.join(process.cwd(), 'src', 'templates');
      vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
        const pathStr = p.toString().replace(/\\/g, '/');
        const normalizedTemplatesDir = templatesDir.replace(/\\/g, '/');

        if (pathStr === normalizedTemplatesDir) {
          return Promise.resolve([
            {
              name: 'src',
              isDirectory: (): boolean => true,
            },
          ] as any);
        }
        if (pathStr === `${normalizedTemplatesDir}/src`) {
          return Promise.resolve([
            {
              name: 'index.ts',
              isDirectory: (): boolean => false,
            },
          ] as any);
        }
        return Promise.resolve([]);
      });

      vi.mocked(fs.access).mockImplementation((p: any): Promise<void> => {
        const pathStr = p.toString().replace(/\\/g, '/');
        if (pathStr.includes('src/index.ts'))
          return Promise.reject(new Error('Not found'));
        return Promise.resolve(undefined);
      });

      // Case 1: Active project (should report)
      const activeRepo = { ...mockRepo, type: 'active' };
      const resultActive = await scanner.scanRepo(activeRepo);
      expect(
        resultActive.issues.some((i) =>
          i.message.includes('Missing template file: src/index.ts')
        )
      ).toBe(true);

      // Case 2: Legacy project (should NOT report)
      const legacyRepo = { ...mockRepo, type: 'legacy' };
      const resultLegacy = await scanner.scanRepo(legacyRepo);
      expect(
        resultLegacy.issues.some((i) =>
          i.message.includes('Missing template file: src/index.ts')
        )
      ).toBe(false);

      // Case 3: Undefined type (should NOT report)
      const unknownRepo = { ...mockRepo, type: undefined };
      const resultUnknown = await scanner.scanRepo(unknownRepo);
      expect(
        resultUnknown.issues.some((i) =>
          i.message.includes('Missing template file: src/index.ts')
        )
      ).toBe(false);
    });

    it('should ignore missing .npmrc for non-active projects', async (): Promise<void> => {
      const templatesDir = path.join(process.cwd(), 'src', 'templates');
      vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
        const pathStr = p.toString().replace(/\\/g, '/');
        const normalizedTemplatesDir = templatesDir.replace(/\\/g, '/');

        if (pathStr === normalizedTemplatesDir) {
          return Promise.resolve([
            {
              name: '.npmrc',
              isDirectory: (): boolean => false,
            },
          ] as any);
        }
        return Promise.resolve([]);
      });

      vi.mocked(fs.access).mockImplementation((p: any): Promise<void> => {
        const pathStr = p.toString().replace(/\\/g, '/');
        if (pathStr.includes('.npmrc'))
          return Promise.reject(new Error('Not found'));
        return Promise.resolve(undefined);
      });

      // Case 1: Active project (should report)
      const activeRepo = { ...mockRepo, type: 'active' };
      const resultActive = await scanner.scanRepo(activeRepo);
      expect(
        resultActive.issues.some((i) =>
          i.message.includes('Missing template file: .npmrc')
        )
      ).toBe(true);

      // Case 2: Legacy project (should NOT report)
      const legacyRepo = { ...mockRepo, type: 'legacy' };
      const resultLegacy = await scanner.scanRepo(legacyRepo);
      expect(
        resultLegacy.issues.some((i) =>
          i.message.includes('Missing template file: .npmrc')
        )
      ).toBe(false);
    });

    it('should report mismatching .npmrc content', async (): Promise<void> => {
      const templatesDir = path.join(process.cwd(), 'src', 'templates');
      vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
        const pathStr = p.toString().replace(/\\/g, '/');
        const normalizedTemplatesDir = templatesDir.replace(/\\/g, '/');

        if (pathStr === normalizedTemplatesDir) {
          return Promise.resolve([
            {
              name: '.npmrc',
              isDirectory: (): boolean => false,
            },
          ] as any);
        }
        return Promise.resolve([]);
      });

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockImplementation((p: any): Promise<any> => {
        const pathStr = p.toString().replace(/\\/g, '/');
        if (pathStr.includes('templates/.npmrc')) {
          return Promise.resolve('minimum-release-age=0');
        }
        if (pathStr.endsWith('.npmrc')) {
          return Promise.resolve('minimum-release-age=10'); // Mismatch
        }
        return Promise.resolve('');
      });

      const activeRepo = { ...mockRepo, type: 'active' };
      const result = await scanner.scanRepo(activeRepo);
      expect(
        result.issues.some((i) =>
          i.message.includes(
            ".npmrc content is incomplete or doesn't match template"
          )
        )
      ).toBe(true);
    });
  });

  describe('scanLint', () => {
    it('should return early if node_modules exists', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        const pathStr = p.toString();
        if (pathStr.endsWith('node_modules')) return true;
        if (pathStr.endsWith('eslint.config.mjs')) return true;
        if (pathStr.endsWith('vitest.config.ts')) return true;
        return false;
      });
      // We need to provide a pkg with a lint script
      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ scripts: { lint: 'eslint' } });
        return '';
      });

      const result = await scanner.scanRepo(mockRepo);
      // No lint issues should be reported because it returned early
      expect(result.issues.some((i) => i.message.includes('Lint'))).toBe(false);
    });

    it('should report lint failure if no specific lines found', async (): Promise<void> => {
      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ scripts: { lint: 'eslint' } });
        return '';
      });
      vi.mocked(spawnSync).mockReturnValue({
        stdout: '',
        stderr: 'Command failed with exit code 1', // Doesn't contain "error" or "warning"
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const lintIssue = result.issues.find((i) =>
        i.message.includes('Lint command failed')
      );
      expect(lintIssue).toBeDefined();
    });
  });

  describe('scanTests', () => {
    it('should report test issues if tests fail', async (): Promise<void> => {
      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ scripts: { test: 'vitest' } });
        return '';
      });
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        const pathStr = p.toString();
        if (pathStr.endsWith('vitest.config.ts')) return true;
        return false;
      });
      vi.mocked(spawnSync).mockReturnValue({
        stdout:
          'ERROR: Coverage for lines (79.46%) does not meet global threshold (80%)',
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const testIssue = result.issues.find((i) =>
        i.message.includes('Test issues found')
      );
      expect(testIssue).toBeDefined();
      expect(testIssue?.message).toContain('Coverage for lines');
      expect(testIssue?.severity).toBe(
        '3 - Low - Fix when have time, nice to have'
      );
    });

    it('should return early if vitest.config.ts is missing', async (): Promise<void> => {
      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ scripts: { test: 'vitest' } });
        return '';
      });
      vi.mocked(existsSync).mockReturnValue(false); // No vitest.config.ts

      const result = await scanner.scanRepo(mockRepo);
      // It should still report VITEST_CONFIG_MISSING (Medium), but NOT TEST_ISSUES (Low)
      expect(
        result.issues.some((i) => i.message.includes('Test issues found'))
      ).toBe(false);
    });
  });

  describe('checkDependenciesVersion', () => {
    it('should handle package not found error', async (): Promise<void> => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          dependencies: { 'non-existent': '^1.0.0' },
        })
      );
      const { default: latestVersion } = await import('latest-version');
      vi.mocked(latestVersion).mockRejectedValue(new Error('Not found'));

      const result = await scanner.scanRepo(mockRepo);
      // Should not throw, should just ignore the error
      expect(result.issues.length).toBeDefined();
    });

    it('should skip outdated check if excluded', async (): Promise<void> => {
      const { isOutdatedScanExcluded } = await import('../utils/excludes.js');
      vi.mocked(isOutdatedScanExcluded).mockReturnValue(true);

      const pkgJson = {
        name: 'test-repo',
        dependencies: { lodash: '^4.0.0' },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkgJson));

      const { default: latestVersion } = await import('latest-version');
      vi.mocked(latestVersion).mockResolvedValue('5.0.0');

      const result = await scanner.scanRepo(mockRepo);
      expect(result.issues.some((i) => i.message.includes('is outdated'))).toBe(
        false
      );
    });
  });

  describe('scanGitHubMetadata', () => {
    it('should report incorrect homepage', async (): Promise<void> => {
      const { getRepoMetadata } = await import('../github.js');
      vi.mocked(getRepoMetadata).mockResolvedValue({
        homepage: 'wrong-homepage',
        description: 'A'.repeat(345),
        topics: ['t1', 't2', 't3', 't4', 't5'],
        defaultBranch: 'main',
      });

      const result = await scanner.scanRepo(mockRepo);
      expect(
        result.issues.some((i) => i.message.includes('Homepage should be'))
      ).toBe(true);
    });

    it('should skip homepage warning if excluded', async (): Promise<void> => {
      const { getRepoMetadata } = await import('../github.js');
      const { isGithubHomepageWarningExcluded } =
        await import('../utils/excludes.js');
      vi.mocked(getRepoMetadata).mockResolvedValue({
        homepage: 'wrong-homepage',
        description: 'A'.repeat(345),
        topics: ['t1', 't2', 't3', 't4', 't5'],
        defaultBranch: 'main',
      });
      vi.mocked(isGithubHomepageWarningExcluded).mockReturnValue(true);

      const result = await scanner.scanRepo(mockRepo);
      expect(
        result.issues.some((i) => i.message.includes('Homepage should be'))
      ).toBe(false);
    });

    it('should report incorrect description length', async (): Promise<void> => {
      const { getRepoMetadata } = await import('../github.js');
      vi.mocked(getRepoMetadata).mockResolvedValue({
        homepage: 'https://linkedin.com/in/orassayag',
        description: 'too short',
        topics: ['t1', 't2', 't3', 't4', 't5'],
        defaultBranch: 'main',
      });

      const result = await scanner.scanRepo(mockRepo);
      expect(
        result.issues.some((i) =>
          i.message.includes('Description length should be')
        )
      ).toBe(true);
    });

    it('should report missing rulesets', async (): Promise<void> => {
      const { getRulesets } = await import('../github.js');
      vi.mocked(getRulesets).mockResolvedValue([]);

      const result = await scanner.scanRepo(mockRepo);
      expect(
        result.issues.some((i) => i.message.includes('No rulesets found'))
      ).toBe(true);
    });

    it('should report keyword mismatch between package.json and GitHub topics', async (): Promise<void> => {
      const pkgJson = {
        name: 'test-repo',
        keywords: ['k1', 'k2'],
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
        main: 'dist/index.js',
        type: 'module',
        scripts: { test: 'vitest' },
        files: ['dist'],
        description: 'A'.repeat(295),
        dependencies: {},
        devDependencies: {},
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkgJson));

      const { getRepoMetadata } = await import('../github.js');
      vi.mocked(getRepoMetadata).mockResolvedValue({
        homepage: 'https://linkedin.com/in/orassayag',
        description: 'A'.repeat(345),
        topics: ['t1', 't2'],
        defaultBranch: 'main',
      });

      const result = await scanner.scanRepo(mockRepo);
      expect(
        result.issues.some((i) =>
          i.message.includes('Keywords do not match GitHub topics')
        )
      ).toBe(true);
    });

    it('should NOT report if keywords match GitHub topics', async (): Promise<void> => {
      const pkgJson = {
        name: 'test-repo',
        keywords: ['k1', 'k2'],
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
        main: 'dist/index.js',
        type: 'module',
        scripts: { test: 'vitest' },
        files: ['dist'],
        description: 'A'.repeat(295),
        dependencies: {},
        devDependencies: {},
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkgJson));

      const { getRepoMetadata } = await import('../github.js');
      vi.mocked(getRepoMetadata).mockResolvedValue({
        homepage: 'https://linkedin.com/in/orassayag',
        description: 'A'.repeat(345),
        topics: ['k2', 'k1'], // Different order
        defaultBranch: 'main',
      });

      const result = await scanner.scanRepo(mockRepo);
      expect(
        result.issues.some((i) =>
          i.message.includes('Keywords do not match GitHub topics')
        )
      ).toBe(false);
    });

    it.skip('should exclude "coverage" folder from package.json "files" comparison', async (): Promise<void> => {
      const pkgJson = {
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
        main: 'dist/index.js',
        type: 'module',
        scripts: { test: 'vitest' },
        files: ['dist'], // only dist is in package.json
        description: 'A'.repeat(295),
        dependencies: {},
        devDependencies: {},
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pkgJson));

      // Mock readdir to include 'dist' and 'coverage'
      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'dist', isDirectory: (): boolean => true },
        { name: 'coverage', isDirectory: (): boolean => true },
        { name: '.git', isDirectory: (): boolean => true },
        { name: 'node_modules', isDirectory: (): boolean => true },
      ] as any);

      const result = await scanner.scanRepo(mockRepo);

      // The issue should NOT be present because 'coverage' is excluded,
      // and 'dist' is already in pkg.files.
      const filesIssue = result.issues.find((i) =>
        i.message.includes('package.json: "files" section is not identical')
      );
      expect(filesIssue).toBeUndefined();
    });
  });

  describe('scanKnip', () => {
    it('should report knip issues if unused items found', async (): Promise<void> => {
      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ name: 'test-repo' });
        return '';
      });
      vi.mocked(spawnSync).mockReturnValue({
        stdout:
          'Unused dependencies (2):\n- lodash\n- express\nUnused files (1):\n- src/old.ts',
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);

      // Verify knip was called with --directory and from current process.cwd()
      const knipCall = vi
        .mocked(spawnSync)
        .mock.calls.find(
          (call) =>
            call[0].toString().includes('knip') &&
            call[0].toString().includes('--directory')
        );
      expect(knipCall).toBeDefined();
      expect((knipCall![1] as any)?.cwd).toBe(process.cwd());

      const knipIssue = result.issues.find((i) =>
        i.message.includes('Knip found unused dependencies')
      );
      expect(knipIssue).toBeDefined();
    });

    it('should skip knip scan if excluded', async (): Promise<void> => {
      const { isKnipScanExcluded } = await import('../utils/excludes.js');
      vi.mocked(isKnipScanExcluded).mockReturnValue(true);

      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ name: 'test-repo' });
        return '';
      });

      const result = await scanner.scanRepo(mockRepo);
      expect(spawnSync).not.toHaveBeenCalledWith(
        expect.stringContaining('knip'),
        expect.any(Object)
      );
      expect(
        result.issues.some((i) => i.message.includes('Knip found unused'))
      ).toBe(false);
    });

    it('should add --no-dependencies flag if knip unused deps are excluded', async (): Promise<void> => {
      const { isKnipUnusedDepsExcluded } = await import('../utils/excludes.js');
      vi.mocked(isKnipUnusedDepsExcluded).mockReturnValue(true);

      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ name: 'test-repo' });
        return '';
      });

      await scanner.scanRepo(mockRepo);

      const knipCall = vi
        .mocked(spawnSync)
        .mock.calls.find((call) => call[0].toString().includes('knip'));
      expect(knipCall![0].toString()).toContain('--no-dependencies');
    });

    it('should filter out excluded packages from knip output', async (): Promise<void> => {
      const { getExcludedKnipPackages } = await import('../utils/excludes.js');
      vi.mocked(getExcludedKnipPackages).mockReturnValue(['lodash']);

      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ name: 'test-repo' });
        return '';
      });

      vi.mocked(spawnSync).mockReturnValue({
        stdout:
          'Unused dependencies (2):\n- lodash\n- express\nUnused devDependencies (1):\n- @eslint/js',
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const knipIssue = result.issues.find((i) =>
        i.message.includes('Knip found unused dependencies')
      );
      expect(knipIssue).toBeDefined();
      expect(knipIssue?.message).not.toContain('lodash');
      expect(knipIssue?.message).toContain('express');
      expect(knipIssue?.message).toContain('@eslint/js');
    });

    it('should filter out excluded paths from knip output and add --ignore flag', async (): Promise<void> => {
      const { getExcludedKnipPaths } = await import('../utils/excludes.js');
      vi.mocked(getExcludedKnipPaths).mockReturnValue(['misc', 'poc']);

      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ name: 'test-repo' });
        return '';
      });

      vi.mocked(spawnSync).mockReturnValue({
        stdout:
          'Unused files (3):\n- src/main.ts\n- misc/old.ts\n- poc/test.ts',
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);

      // Verify --ignore flags were added
      const knipCall = vi
        .mocked(spawnSync)
        .mock.calls.find((call) => call[0].toString().includes('knip'));
      expect(knipCall![0].toString()).toContain('--ignore "misc"');
      expect(knipCall![0].toString()).toContain('--ignore "poc"');

      const knipIssue = result.issues.find((i) =>
        i.message.includes('Knip found unused dependencies')
      );
      expect(knipIssue).toBeDefined();
      expect(knipIssue?.message).toContain('src/main.ts');
      expect(knipIssue?.message).not.toContain('misc/old.ts');
      expect(knipIssue?.message).not.toContain('poc/test.ts');
    });

    it('should handle multiple headers and limit issues in knip output', async (): Promise<void> => {
      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ name: 'test-repo' });
        return '';
      });

      let stdout = 'Unused dependencies (1):\n- dep1\n';
      stdout += 'Unlisted dependencies (1):\n- dep2\n';
      stdout += 'Duplicate dependencies (1):\n- dep3\n';
      for (let i = 0; i < 50; i++) {
        stdout += `- extra${i}\n`;
      }

      vi.mocked(spawnSync).mockReturnValue({
        stdout,
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const knipIssue = result.issues.find((i) =>
        i.message.includes('Knip found unused dependencies')
      );
      expect(knipIssue).toBeDefined();
      expect(knipIssue?.message).toContain('Unused dependencies');
      expect(knipIssue?.message).toContain('Unlisted dependencies');
      expect(knipIssue?.message).toContain('Duplicate dependencies');
    });
  });

  describe('scanTypeScriptRules', () => {
    it('should report missing tsconfig files if .ts files exist', async () => {
      const { isTypeScriptProject } = await import('../utils/projectType.js');
      vi.mocked(isTypeScriptProject).mockResolvedValue(true);

      vi.mocked(readFileSync).mockImplementation((p: any) => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({
            name: 'test-repo',
            scripts: { test: 'vitest' },
          });
        return '';
      });

      const templatesDir = path.join(process.cwd(), 'src', 'templates');
      vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
        const pathStr = p.toString();
        if (pathStr === templatesDir) {
          return Promise.resolve([
            {
              name: 'tsconfig.json',
              isFile: (): boolean => true,
              isDirectory: (): boolean => false,
            },
            {
              name: 'tsconfig.node.json',
              isFile: (): boolean => true,
              isDirectory: (): boolean => false,
            },
            {
              name: 'vitest.config.ts',
              isFile: (): boolean => true,
              isDirectory: (): boolean => false,
            },
          ] as any);
        }
        return Promise.resolve([]);
      });

      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        const pathStr = p.toString();
        if (pathStr.includes('package.json')) return true;
        if (pathStr.includes('tsconfig.json')) return false;
        if (pathStr.includes('tsconfig.node.json')) return false;
        if (pathStr.includes('vitest.config.ts')) return false;
        return true;
      });

      vi.mocked(fs.access).mockImplementation((p: any): Promise<void> => {
        const pathStr = p.toString();
        if (pathStr.includes('tsconfig.json'))
          return Promise.reject(new Error('Not found'));
        if (pathStr.includes('tsconfig.node.json'))
          return Promise.reject(new Error('Not found'));
        if (pathStr.includes('vitest.config.ts'))
          return Promise.reject(new Error('Not found'));
        return Promise.resolve();
      });

      const result = await scanner.scanRepo(mockRepo);

      expect(
        result.issues.some(
          (i) => i.message === 'Missing template file: tsconfig.json'
        )
      ).toBe(true);
      expect(
        result.issues.some(
          (i) => i.message === 'Missing template file: tsconfig.node.json'
        )
      ).toBe(true);
      expect(
        result.issues.some(
          (i) => i.message === 'Missing template file: vitest.config.ts'
        )
      ).toBe(true);
      expect(
        result.issues.some(
          (i) => i.message === 'Vitest: Missing "vitest.config.ts" in the root'
        )
      ).toBe(true);
    });

    it('should NOT report missing files if NO .ts files exist', async (): Promise<void> => {
      const { isTypeScriptProject } = await import('../utils/projectType.js');
      vi.mocked(isTypeScriptProject).mockResolvedValue(false);

      vi.mocked(existsSync).mockReturnValue(false);

      const result = await scanner.scanRepo(mockRepo);

      expect(result.issues.some((i) => i.message.includes('tsconfig'))).toBe(
        false
      );
      expect(
        result.issues.some((i) => i.message.includes('vitest.config.ts'))
      ).toBe(false);
    });

    it('should NOT report VITEST_CONFIG_MISSING for JS projects even if test script exists', async (): Promise<void> => {
      const { isTypeScriptProject } = await import('../utils/projectType.js');
      vi.mocked(isTypeScriptProject).mockResolvedValue(false);

      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json')) {
          return JSON.stringify({
            name: 'js-repo',
            scripts: { test: 'vitest' },
          });
        }
        return '';
      });

      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('vitest.config.ts')) return false;
        if (p.toString().endsWith('package.json')) return true;
        return false;
      });

      const result = await scanner.scanRepo(mockRepo);

      expect(
        result.issues.some(
          (i) => i.message === 'Vitest: Missing "vitest.config.ts" in the root'
        )
      ).toBe(false);
    });
  });

  describe('scanRepo templates', () => {
    it('should handle templates readdir failure', async (): Promise<void> => {
      vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
        if (p.toString().toLowerCase().includes('templates'))
          return Promise.reject(new Error('fail'));
        return Promise.resolve([]);
      });

      const result = await scanner.scanRepo(mockRepo);
      expect(result.repoName).toBe('test-repo');
    });
  });

  describe('git status failure', () => {
    it('should report failure if git status fails', async (): Promise<void> => {
      vi.mocked(execSync).mockImplementation((): string => {
        throw new Error('git fail');
      });

      const result = await scanner.scanRepo(mockRepo);
      expect(
        result.issues.some((i) =>
          i.message.includes('Failed to check git status')
        )
      ).toBe(true);
    });
  });

  describe('Stylelint check catch block', () => {
    it('should handle Stylelint check failure', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('.stylelintrc')) return true;
        return false;
      });

      // @ts-ignore
      vi.spyOn(scanner, 'runCmd').mockImplementation((cmd: string) => {
        if (cmd.includes('stylelint')) throw new Error('stylelint fail');
        return { stdout: '', combined: '' };
      });

      const result = await scanner.scanRepo(mockRepo);
      expect(result.issues.length).toBeDefined();
    });
  });

  describe('Black formatter detection', () => {
    it('should return false if pyproject.toml read fails', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('pyproject.toml')) return true;
        return false;
      });
      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('pyproject.toml')) throw new Error('fail');
        return '';
      });

      const result = await scanner.scanRepo(mockRepo);
      expect(result.issues.some((i) => i.message.includes('Black'))).toBe(
        false
      );
    });
  });

  describe('scanFormatters catch blocks', () => {
    it('should handle formatter check failure', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('.prettierrc')) return true;
        return false;
      });
      const scannerWithFailingCmd = new Scanner();
      // @ts-ignore
      vi.spyOn(scannerWithFailingCmd, 'runCmd').mockImplementation(() => {
        throw new Error('cmd fail');
      });

      const result = await scannerWithFailingCmd.scanRepo(mockRepo);
      // Should not throw, just ignore the formatter error
      expect(result.issues.length).toBeDefined();
    });
  });

  describe('readPkg catch block', () => {
    it('should return empty object if package.json read fails', (): void => {
      vi.mocked(readFileSync).mockImplementation((): string => {
        throw new Error('read fail');
      });
      // @ts-ignore
      const pkg = scanner.readPkg('/some/dir');
      expect(pkg).toEqual({});
    });
  });

  describe('scanLint catch block', () => {
    it('should handle scanLint unexpected error', async (): Promise<void> => {
      // @ts-ignore
      vi.spyOn(scanner, 'scanLint').mockImplementation(() => {
        throw new Error('unexpected');
      });
      const result = await scanner.scanRepo(mockRepo);
      expect(result.issues.length).toBeDefined();
    });
  });

  describe('parsing functions', () => {
    it('should parse Prettier check output and exclude pnpm-lock.yaml, pnpm-workspace.yaml and package-lock.json', (): void => {
      // @ts-ignore
      const files = scanner.parsePrettierCheck(
        '[warn] file1.ts\n[warn] pnpm-lock.yaml\n[warn] packages/app/pnpm-lock.yaml\n[warn] pnpm-workspace.yaml\n[warn] packages/app/pnpm-workspace.yaml\n[warn] package-lock.json\n[warn] packages/app/package-lock.json\n[warn] file2.ts\n[warn] Code style issues'
      );
      expect(files).toEqual(['file1.ts', 'file2.ts']);
    });

    it('should parse ESLint output and exclude coverage folder', (): void => {
      const repoDir = process.platform === 'win32' ? 'C:\\repo' : '/repo';
      const file1 = path.join(repoDir, 'file1.ts');
      const coverageFile = path.join(repoDir, 'coverage', 'sorter.js');
      const nestedCoverageFile = path.join(
        repoDir,
        'packages',
        'app',
        'coverage',
        'prettify.js'
      );

      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        const pStr = p.toString();
        return (
          pStr === file1 || pStr === coverageFile || pStr === nestedCoverageFile
        );
      });

      // @ts-ignore
      const files = scanner.parseEslintOutput(
        `${file1}\n  1:1 error\n${coverageFile}\n  1:1 error\n${nestedCoverageFile}\n  1:1 error`,
        repoDir
      );
      expect(files).toEqual([path.relative(repoDir, file1)]);
      expect(files).not.toContain(path.relative(repoDir, coverageFile));
      expect(files).not.toContain(path.relative(repoDir, nestedCoverageFile));
    });

    it('should parse Biome output', (): void => {
      const repoDir = '/repo';
      vi.mocked(existsSync).mockReturnValue(true);
      // @ts-ignore
      const files = scanner.parseBiomeOutput('file1.ts', repoDir);
      expect(files).toEqual(['file1.ts']);
    });
  });

  describe('scanFormatters', () => {
    it('should detect and check Prettier', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('.prettierrc')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockReturnValue({
        stdout: '[warn] file1.ts\n[warn] file2.ts',
        stderr: '',
        status: 0,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const prettierIssue = result.issues.find((i) =>
        i.message.includes('Prettier')
      );
      expect(prettierIssue).toBeDefined();
      expect(prettierIssue?.message).toContain('2 file(s) unformatted');
    });

    it('should filter out excluded paths from formatters', async (): Promise<void> => {
      const { getExcludedPaths } = await import('../utils/excludes.js');
      vi.mocked(getExcludedPaths).mockReturnValue(['misc', 'db/days.json']);

      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('.prettierrc')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockReturnValue({
        stdout:
          '[warn] file1.ts\n[warn] misc/file2.ts\n[warn] db/days.json\n[warn] other/file3.ts',
        stderr: '',
        status: 0,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const prettierIssue = result.issues.find((i) =>
        i.message.includes('Prettier')
      );
      expect(prettierIssue).toBeDefined();
      // Should only have file1.ts and other/file3.ts (2 files)
      expect(prettierIssue?.message).toContain('2 file(s) unformatted');
      expect(prettierIssue?.message).toContain('file1.ts');
      expect(prettierIssue?.message).toContain('other/file3.ts');
      expect(prettierIssue?.message).not.toContain('misc/file2.ts');
      expect(prettierIssue?.message).not.toContain('db/days.json');
    });

    it('should filter out excluded paths from lint issues', async (): Promise<void> => {
      const { getExcludedPaths } = await import('../utils/excludes.js');
      vi.mocked(getExcludedPaths).mockReturnValue(['misc']);

      vi.mocked(readFileSync).mockImplementation((p: any): string => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ scripts: { lint: 'eslint .' } });
        return '';
      });

      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().includes('node_modules')) return false; // Trigger npx lint
        return false;
      });

      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'error in misc/file.ts\nerror in src/main.ts',
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const lintIssue = result.issues.find((i) => i.message.includes('Lint'));
      expect(lintIssue).toBeDefined();
      expect(lintIssue?.message).toContain('src/main.ts');
      expect(lintIssue?.message).not.toContain('misc/file.ts');
    });

    it('should detect and check ESLint', async (): Promise<void> => {
      const repoPath =
        process.platform === 'win32'
          ? 'C:\\mock\\path\\test-repo'
          : '/mock/path/test-repo';
      const filePath = path.join(repoPath, 'file1.ts');

      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        const ps = p.toString();
        if (ps.endsWith('eslint.config.js')) return true;
        if (ps === filePath || ps.endsWith('file1.ts')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockImplementation((cmd: any): any => {
        if (cmd.toString().includes('eslint')) {
          return {
            stdout: '',
            stderr: `${filePath}\n  1:1  error  Some issue`,
            status: 1,
          } as any;
        }
        return { stdout: '', stderr: '', status: 0 } as any;
      });

      const result = await scanner.scanRepo(mockRepo);
      const eslintIssue = result.issues.find((i) =>
        i.message.toLowerCase().includes('eslint')
      );
      expect(eslintIssue).toBeDefined();
    });

    it('should detect and check Biome', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('biome.json')) return true;
        if (p.toString().endsWith('file1.ts')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'file1.ts',
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const biomeIssue = result.issues.find((i) => i.message.includes('Biome'));
      expect(biomeIssue).toBeDefined();
    });

    it('should detect and check Stylelint', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('.stylelintrc')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockReturnValue({
        stdout: JSON.stringify([
          { source: 'style.css', warnings: [{ fixable: true }] },
        ]),
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const issue = result.issues.find((i) => i.message.includes('Stylelint'));
      expect(issue).toBeDefined();
    });

    it('should handle ESLint invalid option --ext fallback', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('eslint.config.js')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockImplementation((cmd: any): any => {
        if (cmd.toString().includes('eslint')) {
          if (cmd.toString().includes('--ext')) {
            return { stdout: '[]', stderr: '', status: 0 } as any;
          }
          return {
            stdout: '',
            stderr: "Invalid option '--ext'",
            status: 1,
          } as any;
        }
        return { stdout: '', stderr: '', status: 0 } as any;
      });

      const result = await scanner.scanRepo(mockRepo);
      expect(result.issues.length).toBeDefined();
    });

    it('should handle Stylelint parse error', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('.stylelintrc')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'not json',
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      expect(result.issues.some((i) => i.message.includes('Stylelint'))).toBe(
        false
      );
    });

    it('should detect and check rustfmt', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('Cargo.toml')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'Diff in src/main.rs at line 1:',
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const issue = result.issues.find((i) => i.message.includes('rustfmt'));
      expect(issue).toBeDefined();
    });

    it('should detect and check gofmt', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('go.mod')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'main.go',
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const issue = result.issues.find((i) => i.message.includes('gofmt'));
      expect(issue).toBeDefined();
    });

    it('should detect and check Black (Python)', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('pyproject.toml')) return true;
        return false;
      });
      vi.mocked(readFileSync).mockReturnValue('[tool.black]');

      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'would reformat main.py',
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const issue = result.issues.find((i) => i.message.includes('Black'));
      expect(issue).toBeDefined();
    });
  });

  describe('Purpose-based Scanning', () => {
    it('should ignore ESLint missing issue for training repositories', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        const ps = p.toString();
        // Return false for all eslint related files
        if (ps.includes('eslintrc') || ps.includes('eslint.config'))
          return false;
        return false;
      });

      const result = await scanner.scanRepo({
        ...mockRepo,
        purpose: 'training',
      });

      expect(
        result.issues.some((i) =>
          i.message.includes('ESLint: Missing both "eslintrc.json"')
        )
      ).toBe(false);
    });

    it('should NOT ignore ESLint missing issue for non-training repositories', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        const ps = p.toString();
        if (ps.includes('eslintrc') || ps.includes('eslint.config'))
          return false;
        return false;
      });

      const result = await scanner.scanRepo({
        ...mockRepo,
        purpose: 'personal',
      });

      expect(
        result.issues.some((i) =>
          i.message.includes('ESLint: Missing both "eslintrc.json"')
        )
      ).toBe(true);
    });
  });

  describe('resolveRunner', () => {
    it('should use local bin if exists', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('.prettierrc')) return true;
        if (p.toString().includes('node_modules')) return true;
        return false;
      });

      await scanner.scanRepo(mockRepo);

      const spawnCalls = vi.mocked(spawnSync).mock.calls;
      const prettierCall = spawnCalls.find((c) =>
        c[0].toString().includes('prettier')
      );
      expect(prettierCall?.[0]).toContain('node_modules');
    });

    it('should use npx if local bin missing', async (): Promise<void> => {
      vi.mocked(existsSync).mockImplementation((p: any): boolean => {
        if (p.toString().endsWith('.prettierrc')) return true;
        return false;
      });

      await scanner.scanRepo(mockRepo);

      const spawnCalls = vi.mocked(spawnSync).mock.calls;
      const prettierCall = spawnCalls.find((c) =>
        c[0].toString().includes('prettier')
      );
      expect(prettierCall?.[0]).toContain('npx --yes');
    });
  });

  describe('TSConfig Validation', () => {
    it('should log an issue if tsconfig.json types do not match for active repos', async (): Promise<void> => {
      const { isTypeScriptProject } = await import('../utils/projectType.js');
      vi.mocked(isTypeScriptProject).mockResolvedValue(true);

      vi.mocked(fs.readFile).mockImplementation((p: any): any => {
        if (p.toString().endsWith('tsconfig.json')) {
          return Promise.resolve(
            JSON.stringify({
              compilerOptions: {
                types: ['node'], // Mismatch, should be ['node', 'vitest']
              },
            })
          );
        }
        return Promise.resolve('');
      });

      const result = await scanner.scanRepo({
        ...mockRepo,
        type: 'active',
      });

      expect(
        result.issues.some((i) =>
          i.message.includes(
            'compilerOptions.types" should be ["node", "vitest"]'
          )
        )
      ).toBe(true);
    });

    it('should NOT log an issue if tsconfig.json types match for active repos', async (): Promise<void> => {
      const { isTypeScriptProject } = await import('../utils/projectType.js');
      vi.mocked(isTypeScriptProject).mockResolvedValue(true);

      vi.mocked(fs.readFile).mockImplementation((p: any): any => {
        if (p.toString().endsWith('tsconfig.json')) {
          return Promise.resolve(
            JSON.stringify({
              compilerOptions: {
                types: ['node', 'vitest'],
              },
            })
          );
        }
        return Promise.resolve('');
      });

      const result = await scanner.scanRepo({
        ...mockRepo,
        type: 'active',
      });

      expect(
        result.issues.some((i) =>
          i.message.includes(
            'compilerOptions.types" should be ["node", "vitest"]'
          )
        )
      ).toBe(false);
    });

    it('should NOT log an issue if types do not match but repo is NOT active', async (): Promise<void> => {
      const { isTypeScriptProject } = await import('../utils/projectType.js');
      vi.mocked(isTypeScriptProject).mockResolvedValue(true);

      vi.mocked(fs.readFile).mockImplementation((p: any): any => {
        if (p.toString().endsWith('tsconfig.json')) {
          return Promise.resolve(
            JSON.stringify({
              compilerOptions: {
                types: ['node'],
              },
            })
          );
        }
        return Promise.resolve('');
      });

      const result = await scanner.scanRepo({
        ...mockRepo,
        type: 'other',
      });

      expect(
        result.issues.some((i) =>
          i.message.includes(
            'compilerOptions.types" should be ["node", "vitest"]'
          )
        )
      ).toBe(false);
    });
  });
});
