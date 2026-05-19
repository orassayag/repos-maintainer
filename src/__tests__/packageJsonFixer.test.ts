import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  injectPackageJson,
  fixPackageJson,
} from '../fixers/packageJsonFixer.js';
import fs from 'fs/promises';
import { settings } from '../settings.js';
import { Logger } from '../utils/logger.js';
import { execSync } from 'child_process';

vi.mock('fs/promises');
vi.mock('../utils/logger.js');
vi.mock('child_process');
vi.mock('../settings.js', () => ({
  settings: {
    TEMPLATES_DIR: '/mock/templates',
    AUTHOR_NAME: 'Or Assayag',
    AUTHOR_EMAIL: 'orassayag@gmail.com',
    AUTHOR_GITHUB: 'orassayag',
    DRY_RUN: false,
  },
}));

describe('packageJsonFixer', () => {
  const repoPath = '/mock/repo';

  beforeEach(() => {
    vi.clearAllMocks();
    settings.DRY_RUN = false;
  });

  describe('injectPackageJson', () => {
    it('should inject package.json with dynamic values', async () => {
      const template = JSON.stringify({
        name: '#REPO-NAME#',
        dependencies: { pkg1: '' },
        devDependencies: { pkg2: '' },
      });
      vi.mocked(fs.readFile).mockResolvedValue(template);
      vi.mocked(execSync).mockReturnValue('1.0.0' as any);

      const result = await injectPackageJson(repoPath, 'test-repo', 'desc', [
        'k1',
      ]);

      expect(result).toBe(true);
      expect(fs.writeFile).toHaveBeenCalled();
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.name).toBe('test-repo');
      expect(written.description).toBe('desc');
      expect(written.dependencies.pkg1).toBe('^1.0.0');
      expect(written.author).toContain('Or Assayag');
    });

    it('should handle getLatestVersion failure', async () => {
      const template = JSON.stringify({
        name: '#REPO-NAME#',
        dependencies: { pkg1: '' },
      });
      vi.mocked(fs.readFile).mockResolvedValue(template);
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('npm error');
      });

      const result = await injectPackageJson(repoPath, 'test-repo', 'desc', []);

      expect(result).toBe(true);
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.dependencies.pkg1).toBe('');
    });

    it('should handle inject failure', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('File Error'));

      const result = await injectPackageJson(repoPath, 'test-repo', 'desc', []);

      expect(result).toBe(false);
      expect(Logger.error).toHaveBeenCalled();
    });

    it('should handle dry run', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ name: 'test' })
      );
      settings.DRY_RUN = true;

      const result = await injectPackageJson(repoPath, 'test-repo', 'desc', []);

      expect(result).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('fixPackageJson', () => {
    const template = JSON.stringify({
      author: {
        name: 'Or Assayag',
        email: 'orassayag@gmail.com',
        url: 'https://github.com/orassayag',
      },
      contributors: [
        {
          name: 'Or Assayag',
          email: 'orassayag@gmail.com',
          url: 'https://github.com/orassayag',
        },
      ],
      funding: { type: 'github', url: 'https://github.com/sponsors/orassayag' },
      type: 'module',
      repository: {
        type: 'git',
        url: 'git://github.com/orassayag/#REPO-NAME#.git',
      },
      bugs: { url: 'https://github.com/orassayag/#REPO-NAME#/issues' },
      homepage: 'https://github.com/orassayag/#REPO-NAME##readme',
    });

    beforeEach(() => {
      vi.mocked(fs.readdir).mockResolvedValue([]);
      vi.mocked(fs.access).mockResolvedValue(undefined);
    });

    it('should fix author and contributors if missing', async () => {
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({ name: 'test' }))
        .mockResolvedValueOnce(template);

      const result = await fixPackageJson(repoPath, 'test-repo');

      expect(result).toBe(true);
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.author.name).toBe('Or Assayag');
      expect(written.contributors).toHaveLength(1);
    });

    it('should fix repository field if missing or incorrect', async () => {
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(
          JSON.stringify({
            name: 'test',
            repository: { type: 'git', url: 'wrong-url' },
          })
        )
        .mockResolvedValueOnce(template);

      const result = await fixPackageJson(repoPath, 'test-repo');

      expect(result).toBe(true);
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.repository.url).toBe(
        'git://github.com/orassayag/test-repo.git'
      );
    });

    it('should return false if already correct', async () => {
      const pkg = JSON.stringify({
        author: {
          name: 'Or Assayag',
          email: 'orassayag@gmail.com',
          url: 'https://github.com/orassayag',
        },
        contributors: [
          {
            name: 'Or Assayag',
            email: 'orassayag@gmail.com',
            url: 'https://github.com/orassayag',
          },
        ],
        funding: {
          type: 'github',
          url: 'https://github.com/sponsors/orassayag',
        },
        engines: { node: '>=20.0.0', pnpm: '>=8.0.0' },
        type: 'module',
        repository: {
          type: 'git',
          url: 'git://github.com/orassayag/test-repo.git',
        },
        bugs: { url: 'https://github.com/orassayag/test-repo/issues' },
        homepage: 'https://github.com/orassayag/test-repo#readme',
        main: 'dist/index.js',
        files: [],
      });
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(pkg)
        .mockResolvedValueOnce(template);

      const result = await fixPackageJson(repoPath, 'test-repo');

      expect(result).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle read error', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Read Error'));

      const result = await fixPackageJson(repoPath, 'test-repo');

      expect(result).toBe(false);
      expect(Logger.warn).toHaveBeenCalled();
    });

    it('should handle dry run', async () => {
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({ name: 'test' }))
        .mockResolvedValueOnce(template);
      settings.DRY_RUN = true;

      const result = await fixPackageJson(repoPath, 'test-repo');

      expect(result).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(Logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });

    it('should sort files correctly: directories first, then files alphabetically', async () => {
      const pkg = JSON.stringify({
        author: {
          name: 'Or Assayag',
          email: 'orassayag@gmail.com',
          url: 'https://github.com/orassayag',
        },
        contributors: [
          {
            name: 'Or Assayag',
            email: 'orassayag@gmail.com',
            url: 'https://github.com/orassayag',
          },
        ],
        funding: {
          type: 'github',
          url: 'https://github.com/sponsors/orassayag',
        },
        engines: { node: '>=20.0.0', pnpm: '>=8.0.0' },
        type: 'module',
        bugs: { url: 'https://github.com/orassayag/test-repo/issues' },
        homepage: 'https://github.com/orassayag/test-repo#readme',
        main: 'dist/index.js',
        files: [],
      });
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(pkg)
        .mockResolvedValueOnce(template);

      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'b.txt', isDirectory: (): boolean => false },
        { name: 'a_dir', isDirectory: (): boolean => true },
        { name: 'a.txt', isDirectory: (): boolean => false },
        { name: 'b_dir', isDirectory: (): boolean => true },
      ] as any);

      const result = await fixPackageJson(repoPath, 'test-repo');

      expect(result).toBe(true);
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.files).toEqual(['a_dir', 'b_dir', 'a.txt', 'b.txt']);
    });

    it('should exclude "coverage", ".git" and "node_modules" from files section', async () => {
      const pkg = JSON.stringify({
        author: {
          name: 'Or Assayag',
          email: 'orassayag@gmail.com',
          url: 'https://github.com/orassayag',
        },
        contributors: [
          {
            name: 'Or Assayag',
            email: 'orassayag@gmail.com',
            url: 'https://github.com/orassayag',
          },
        ],
        funding: {
          type: 'github',
          url: 'https://github.com/sponsors/orassayag',
        },
        engines: { node: '>=20.0.0', pnpm: '>=8.0.0' },
        type: 'module',
        bugs: { url: 'https://github.com/orassayag/test-repo/issues' },
        homepage: 'https://github.com/orassayag/test-repo#readme',
        main: 'dist/index.js',
        files: [],
      });
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(pkg)
        .mockResolvedValueOnce(template);

      vi.mocked(fs.readdir).mockResolvedValue([
        { name: 'src', isDirectory: (): boolean => true },
        { name: 'coverage', isDirectory: (): boolean => true },
        { name: '.git', isDirectory: (): boolean => true },
        { name: 'node_modules', isDirectory: (): boolean => true },
        { name: 'package.json', isDirectory: (): boolean => false },
      ] as any);

      const result = await fixPackageJson(repoPath, 'test-repo');

      expect(result).toBe(true);
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.files).toEqual(['src', 'package.json']);
      expect(written.files).not.toContain('coverage');
      expect(written.files).not.toContain('.git');
      expect(written.files).not.toContain('node_modules');
    });

    it('should fix "main" field to point to source file if current main is invalid (e.g., dist/main.js -> src/main.ts)', async () => {
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(
          JSON.stringify({ name: 'test', main: 'dist/main.js' })
        )
        .mockResolvedValueOnce(template);

      // Mock fs.access: dist/main.js fails, src/main.ts succeeds
      vi.mocked(fs.access).mockImplementation((p: any) => {
        const normalizedPath = p.toString().replace(/\\/g, '/');
        if (normalizedPath.endsWith('src/main.ts')) return Promise.resolve();
        return Promise.reject(new Error('Not found'));
      });

      const result = await fixPackageJson(repoPath, 'test-repo');

      expect(result).toBe(true);
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.main).toBe('src/main.ts');
    });

    it('should fix "main" field using smart scan if candidates fail', async () => {
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({ name: 'test' }))
        .mockResolvedValueOnce(template);

      // Mock fs.access to fail for all candidates
      vi.mocked(fs.access).mockRejectedValue(new Error('Not found'));

      // Mock fs.readdir for collectSourceFiles
      vi.mocked(fs.readdir).mockImplementation((p: any) => {
        if (p === repoPath) {
          return Promise.resolve([
            {
              name: 'app.ts',
              isFile: (): boolean => true,
              isDirectory: (): boolean => false,
              startsWith: (s: string): boolean => 'app.ts'.startsWith(s),
            },
          ] as any);
        }
        return Promise.resolve([]);
      });

      const result = await fixPackageJson(repoPath, 'test-repo');

      expect(result).toBe(true);
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.main).toBe('app.ts');
    });

    it('should add devDependencies if missing in package.json', async () => {
      const templateWithDevDeps = JSON.stringify({
        author: {
          name: 'Or Assayag',
          email: 'orassayag@gmail.com',
          url: 'https://github.com/orassayag',
        },
        devDependencies: { 'mock-pkg': '' },
      });

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({ name: 'test' }))
        .mockResolvedValueOnce(templateWithDevDeps);

      vi.mocked(execSync).mockReturnValue('1.2.3' as any);

      const result = await fixPackageJson(repoPath, 'test-repo');

      expect(result).toBe(true);
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.devDependencies).toBeDefined();
      expect(written.devDependencies['mock-pkg']).toBe('^1.2.3');
    });

    it('should add dependencies if missing in package.json', async () => {
      const templateWithDeps = JSON.stringify({
        author: {
          name: 'Or Assayag',
          email: 'orassayag@gmail.com',
          url: 'https://github.com/orassayag',
        },
        dependencies: { 'mock-dep': '' },
      });

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({ name: 'test' }))
        .mockResolvedValueOnce(templateWithDeps);

      vi.mocked(execSync).mockReturnValue('2.0.0' as any);

      const result = await fixPackageJson(repoPath, 'test-repo');

      expect(result).toBe(true);
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.dependencies).toBeDefined();
      expect(written.dependencies['mock-dep']).toBe('^2.0.0');
    });

    it('should add scripts if missing in package.json', async () => {
      const templateWithScripts = JSON.stringify({
        author: {
          name: 'Or Assayag',
          email: 'orassayag@gmail.com',
          url: 'https://github.com/orassayag',
        },
        scripts: { test: 'vitest' },
      });

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify({ name: 'test' }))
        .mockResolvedValueOnce(templateWithScripts);

      const result = await fixPackageJson(repoPath, 'test-repo');

      expect(result).toBe(true);
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.scripts).toBeDefined();
      expect(written.scripts.test).toBe('vitest');
    });
  });
});
