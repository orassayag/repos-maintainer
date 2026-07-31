import { describe, it, expect, vi, beforeEach } from 'vitest';
import { preFlightValidation, main } from '../index.js';
import fs from 'fs/promises';
import { settings } from '../settings.js';
import { checkGitHubAuth } from '../github.js';
import { Logger } from '../utils/logger.js';
import { showMainMenu } from '../cli.js';

vi.mock('fs/promises');
vi.mock('../github.js');
vi.mock('../utils/logger.js');
vi.mock('../cli.js');
vi.mock('../settings.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    settings: {
      ...actual.settings,
      PROJECTS_ROOT: '/mock/projects',
    },
    getReposListPath: vi.fn().mockReturnValue('/mock/projects/repos.json'),
  };
});

describe('index entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkGitHubAuth).mockResolvedValue(true);
  });

  describe('preFlightValidation', () => {
    it('should pass when all checks pass', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['project1'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([{ name: 'repo1', url: 'url1' }])
      );

      const result = await preFlightValidation();
      expect(result).toBe(true);
      expect(Logger.success).toHaveBeenCalledWith(
        'All pre-flight checks passed!'
      );
    });

    it('should fail if projects root is missing', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await preFlightValidation();
      expect(result).toBe(false);
      expect(Logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Projects root not found or empty')
      );
    });

    it('should fail if projects root is empty', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const result = await preFlightValidation();
      expect(result).toBe(false);
      expect(Logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Projects root not found or empty')
      );
    });

    it('should fail if repos list is missing', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['project1'] as any);
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      const result = await preFlightValidation();
      expect(result).toBe(false);
      expect(Logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Repos list not found or empty')
      );
    });

    it('should fail if repos list is empty', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['project1'] as any);
      vi.mocked(fs.readFile).mockResolvedValue('[]');

      const result = await preFlightValidation();
      expect(result).toBe(false);
      expect(Logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Repos list not found or empty')
      );
    });

    it('should fail if repos list contains invalid JSON', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['project1'] as any);
      vi.mocked(fs.readFile).mockResolvedValue('invalid json');

      const result = await preFlightValidation();
      expect(result).toBe(false);
      expect(Logger.log).toHaveBeenCalledWith(
        expect.stringContaining('The file contains invalid JSON')
      );
    });

    it('should fail if GitHub auth fails', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['project1'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([{ name: 'repo1', url: 'url1' }])
      );
      vi.mocked(checkGitHubAuth).mockResolvedValue(false);

      const result = await preFlightValidation();
      expect(result).toBe(false);
      expect(Logger.error).toHaveBeenCalledWith(
        'GitHub authentication failed.'
      );
    });
  });

  describe('main', () => {
    it('should run auto mode if --auto flag is present', async () => {
      process.argv = ['node', 'index.js', '--auto'];
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['p1'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([{ name: 'r1', url: 'u1' }])
      );

      // We need to mock the dynamic import of scanReposCommand
      const mockScanRepos = vi.fn();
      vi.doMock('../commands/scanRepos.js', () => ({
        scanReposCommand: mockScanRepos,
      }));

      await main();

      expect(Logger.log).toHaveBeenCalledWith(
        expect.stringContaining('Running in AUTO mode')
      );
    });

    it('should run sync-repos mode when SYNC-REPOS is present', async () => {
      process.argv = ['node', 'index.js', 'SYNC-REPOS'];
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['p1'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([{ name: 'r1', url: 'u1' }])
      );

      const mockSyncRepos = vi.fn();
      vi.doMock('../commands/syncRepos.js', () => ({
        syncReposCommand: mockSyncRepos,
      }));

      await main();

      expect(Logger.log).toHaveBeenCalledWith(
        expect.stringContaining('Running in SYNC-REPOS mode')
      );
      expect(showMainMenu).not.toHaveBeenCalled();
    });

    it('should show menu if not in auto mode', async () => {
      process.argv = ['node', 'index.js'];
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['p1'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([{ name: 'r1', url: 'u1' }])
      );

      await main();

      expect(showMainMenu).toHaveBeenCalled();
    });

    it('should handle dry run flag', async () => {
      process.argv = ['node', 'index.js', '--dry-run'];
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['p1'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([{ name: 'r1', url: 'u1' }])
      );

      await main();

      expect(settings.DRY_RUN).toBe(true);
      expect(Logger.info).toHaveBeenCalledWith(
        expect.stringContaining('DRY RUN mode enabled')
      );
    });

    it('should handle git clean flag', async () => {
      process.argv = ['node', 'index.js', '--git-clean'];
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['p1'] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify([{ name: 'r1', url: 'u1' }])
      );

      await main();

      expect(settings.GIT_CLEAN_ENABLED).toBe(true);
      expect(Logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Git clean mode enabled')
      );
    });
  });
});
