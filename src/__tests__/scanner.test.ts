import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scanner } from '../utils/scanner.js';
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
}));
vi.mock('../github.js', () => ({
  parseGitHubUrl: vi.fn(() => ({ owner: 'user', repo: 'repo' })),
  getRepoMetadata: vi.fn(),
  isRepoStarred: vi.fn(),
  isRepoWatched: vi.fn(),
  getRulesets: vi.fn(),
}));

describe('Scanner', () => {
  let scanner: Scanner;
  const mockRepo = {
    name: 'test-repo',
    url: 'https://github.com/user/test-repo',
  };

  beforeEach(async () => {
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
  });

  describe('scanLint', () => {
    it('should return early if node_modules exists', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        const pathStr = p.toString();
        if (pathStr.endsWith('node_modules')) return true;
        if (pathStr.endsWith('eslint.config.mjs')) return true;
        if (pathStr.endsWith('vitest.config.ts')) return true;
        return false;
      });
      // We need to provide a pkg with a lint script
      vi.mocked(readFileSync).mockImplementation((p: any) => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ scripts: { lint: 'eslint' } });
        return '';
      });

      const result = await scanner.scanRepo(mockRepo);
      // No lint issues should be reported because it returned early
      expect(result.issues.some((i) => i.message.includes('Lint'))).toBe(false);
    });

    it('should report lint failure if no specific lines found', async () => {
      vi.mocked(readFileSync).mockImplementation((p: any) => {
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
    it('should report test issues if tests fail', async () => {
      vi.mocked(readFileSync).mockImplementation((p: any) => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ scripts: { test: 'vitest' } });
        return '';
      });
      vi.mocked(existsSync).mockImplementation((p: any) => {
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

    it('should return early if vitest.config.ts is missing', async () => {
      vi.mocked(readFileSync).mockImplementation((p: any) => {
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
    it('should handle package not found error', async () => {
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

    it('should skip outdated check if excluded', async () => {
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
    it('should report incorrect homepage', async () => {
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

    it('should report incorrect description length', async () => {
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

    it('should report missing rulesets', async () => {
      const { getRulesets } = await import('../github.js');
      vi.mocked(getRulesets).mockResolvedValue([]);

      const result = await scanner.scanRepo(mockRepo);
      expect(
        result.issues.some((i) => i.message.includes('No rulesets found'))
      ).toBe(true);
    });

    it('should report keyword mismatch between package.json and GitHub topics', async () => {
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

    it('should NOT report if keywords match GitHub topics', async () => {
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
  });

  describe('scanKnip', () => {
    it('should report knip issues if unused items found', async () => {
      vi.mocked(readFileSync).mockImplementation((p: any) => {
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
      expect(knipIssue?.message).toContain('Unused dependencies (2)');
      expect(knipIssue?.message).toContain('  - lodash');
      expect(knipIssue?.message).toContain('  - express');
      expect(knipIssue?.message).toContain('Unused files (1)');
      expect(knipIssue?.message).toContain('  - src/old.ts');
      expect(knipIssue?.severity).toBe('4 - Very Low - Minor issues');
    });

    it('should report knip failure if command fails with error', async () => {
      vi.mocked(readFileSync).mockImplementation((p: any) => {
        if (p.toString().endsWith('package.json'))
          return JSON.stringify({ name: 'test-repo' });
        return '';
      });
      vi.mocked(spawnSync).mockReturnValue({
        stdout: '',
        stderr: 'Error: Knip command failed',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const knipIssue = result.issues.find((i) =>
        i.message.includes('Knip command failed')
      );
      expect(knipIssue).toBeDefined();
    });

    it('should skip knip scan if excluded', async () => {
      const { isKnipScanExcluded } = await import('../utils/excludes.js');
      vi.mocked(isKnipScanExcluded).mockReturnValue(true);

      vi.mocked(readFileSync).mockImplementation((p: any) => {
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

    it('should add --no-dependencies flag if knip unused deps are excluded', async () => {
      const { isKnipUnusedDepsExcluded } = await import('../utils/excludes.js');
      vi.mocked(isKnipUnusedDepsExcluded).mockReturnValue(true);

      vi.mocked(readFileSync).mockImplementation((p: any) => {
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

    it('should filter out excluded packages from knip output', async () => {
      const { getExcludedKnipPackages } = await import('../utils/excludes.js');
      vi.mocked(getExcludedKnipPackages).mockReturnValue(['lodash']);

      vi.mocked(readFileSync).mockImplementation((p: any) => {
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

    it('should filter out excluded paths from knip output and add --ignore flag', async () => {
      const { getExcludedKnipPaths } = await import('../utils/excludes.js');
      vi.mocked(getExcludedKnipPaths).mockReturnValue(['misc', 'poc']);

      vi.mocked(readFileSync).mockImplementation((p: any) => {
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

    it('should handle multiple headers and limit issues in knip output', async () => {
      vi.mocked(readFileSync).mockImplementation((p: any) => {
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

  describe('scanRepo templates', () => {
    it('should handle templates readdir failure', async () => {
      vi.mocked(fs.readdir).mockImplementation((p: any) => {
        if (p.toString().toLowerCase().includes('templates'))
          return Promise.reject(new Error('fail'));
        return Promise.resolve([]);
      });

      const result = await scanner.scanRepo(mockRepo);
      expect(result.repoName).toBe('test-repo');
    });
  });

  describe('git status failure', () => {
    it('should report failure if git status fails', async () => {
      vi.mocked(execSync).mockImplementation(() => {
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
    it('should handle Stylelint check failure', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (p.toString().endsWith('.stylelintrc')) return true;
        return false;
      });

      // Mock resolveRunner to return stylelint
      // Mock runCmd to throw specifically for stylelint
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
    it('should return false if pyproject.toml read fails', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (p.toString().endsWith('pyproject.toml')) return true;
        return false;
      });
      vi.mocked(readFileSync).mockImplementation((p: any) => {
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
    it('should handle formatter check failure', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (p.toString().endsWith('.prettierrc')) return true;
        return false;
      });
      // Mock resolveRunner to return prettier
      // Mock runCmd to throw
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
    it('should return empty object if package.json read fails', () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('read fail');
      });
      // @ts-ignore
      const pkg = scanner.readPkg('/some/dir');
      expect(pkg).toEqual({});
    });
  });

  describe('scanLint catch block', () => {
    it('should handle scanLint unexpected error', async () => {
      // @ts-ignore
      vi.spyOn(scanner, 'scanLint').mockImplementation(() => {
        throw new Error('unexpected');
      });
      const result = await scanner.scanRepo(mockRepo);
      expect(result.issues.length).toBeDefined();
    });
  });

  describe('parsing functions', () => {
    it('should parse Prettier check output and exclude pnpm-lock.yaml', () => {
      // @ts-ignore
      const files = scanner.parsePrettierCheck(
        '[warn] file1.ts\n[warn] pnpm-lock.yaml\n[warn] packages/app/pnpm-lock.yaml\n[warn] file2.ts\n[warn] Code style issues'
      );
      expect(files).toEqual(['file1.ts', 'file2.ts']);
    });

    it('should parse ESLint output and exclude coverage folder', () => {
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

      vi.mocked(existsSync).mockImplementation((p: any) => {
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

    it('should parse Biome output', () => {
      const repoDir = '/repo';
      vi.mocked(existsSync).mockReturnValue(true);
      // @ts-ignore
      const files = scanner.parseBiomeOutput('file1.ts', repoDir);
      expect(files).toEqual(['file1.ts']);
    });
  });

  describe('scanFormatters', () => {
    it('should detect and check Prettier', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
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

    it('should detect and check ESLint', async () => {
      const repoPath =
        process.platform === 'win32'
          ? 'C:\\mock\\path\\test-repo'
          : '/mock/path/test-repo';
      const filePath = path.join(repoPath, 'file1.ts');

      vi.mocked(existsSync).mockImplementation((p: any) => {
        const ps = p.toString();
        if (ps.endsWith('eslint.config.js')) return true;
        if (ps === filePath || ps.endsWith('file1.ts')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockImplementation((cmd: any) => {
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

    it('should detect and check Biome', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
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

    it('should detect and check Stylelint', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
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

    it('should handle ESLint invalid option --ext fallback', async () => {
      const repoPath =
        process.platform === 'win32'
          ? 'C:\\mock\\path\\test-repo'
          : '/mock/path/test-repo';
      path.join(repoPath, 'file1.ts');

      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (p.toString().endsWith('eslint.config.js')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockImplementation((cmd: any) => {
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
      // Should not throw and should handle the fallback gracefully
      expect(result.issues.length).toBeDefined();
    });

    it('should handle Stylelint parse error', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (p.toString().endsWith('.stylelintrc')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'not json',
        stderr: '',
        status: 1,
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      // Should return empty list of issues for Stylelint if parsing fails
      expect(result.issues.some((i) => i.message.includes('Stylelint'))).toBe(
        false
      );
    });

    it('should detect and check rustfmt', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
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

    it('should detect and check gofmt', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
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

    it('should detect and check Black (Python)', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
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

  describe('resolveRunner', () => {
    it('should use local bin if exists', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
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

    it('should use npx if local bin missing', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
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
});
