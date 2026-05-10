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
    it('should fix author and contributors if missing', async () => {
      const pkg = JSON.stringify({ name: 'test' });
      vi.mocked(fs.readFile).mockResolvedValue(pkg);

      const result = await fixPackageJson(repoPath);

      expect(result).toBe(true);
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.author).toBe('Or Assayag <orassayag@gmail.com>');
      expect(written.contributors).toHaveLength(1);
      expect(written.contributors[0].name).toBe('Or Assayag');
    });

    it('should return false if already correct', async () => {
      const pkg = JSON.stringify({
        author: 'Or Assayag <orassayag@gmail.com>',
        contributors: [
          {
            name: 'Or Assayag',
            email: 'orassayag@gmail.com',
            url: 'https://github.com/orassayag',
          },
        ],
      });
      vi.mocked(fs.readFile).mockResolvedValue(pkg);

      const result = await fixPackageJson(repoPath);

      expect(result).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should add contributor if missing but array exists', async () => {
      const pkg = JSON.stringify({
        contributors: [{ email: 'other@gmail.com' }],
      });
      vi.mocked(fs.readFile).mockResolvedValue(pkg);

      const result = await fixPackageJson(repoPath);

      expect(result).toBe(true);
      const written = JSON.parse(
        vi.mocked(fs.writeFile).mock.calls[0][1] as string
      );
      expect(written.contributors).toHaveLength(2);
    });

    it('should handle read error', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Read Error'));

      const result = await fixPackageJson(repoPath);

      expect(result).toBe(false);
      expect(Logger.warn).toHaveBeenCalled();
    });

    it('should handle dry run', async () => {
      const pkg = JSON.stringify({ name: 'test' });
      vi.mocked(fs.readFile).mockResolvedValue(pkg);
      settings.DRY_RUN = true;

      const result = await fixPackageJson(repoPath);

      expect(result).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(Logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });
  });
});
