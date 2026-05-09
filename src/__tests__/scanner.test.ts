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

  beforeEach(() => {
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
    it('should parse Prettier check output', () => {
      // @ts-ignore
      const files = scanner.parsePrettierCheck(
        '[warn] file1.ts\n[warn] file2.ts\n[warn] Code style issues'
      );
      expect(files).toEqual(['file1.ts', 'file2.ts']);
    });

    it('should parse ESLint output', () => {
      const repoDir = process.platform === 'win32' ? 'C:\\repo' : '/repo';
      const file1 = path.join(repoDir, 'file1.ts');
      vi.mocked(existsSync).mockImplementation((p: any) => p === file1);

      // @ts-ignore
      const files = scanner.parseEslintOutput(
        `${file1}\n  1:1 error msg`,
        repoDir
      );
      expect(files).toContain(path.relative(repoDir, file1));
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
