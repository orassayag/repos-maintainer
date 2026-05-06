import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ensureTemplateFile,
  getChangelogCommitMessage,
} from '../utils/fileFixer.js';
import fs from 'fs/promises';
import { settings } from '../settings.js';
import { Logger } from '../utils/logger.js';
import path from 'path';

vi.mock('fs/promises');
vi.mock('../utils/logger.js');
vi.mock('../settings.js', () => ({
  settings: {
    TEMPLATES_DIR: '/mock/templates',
    OVERWRITE_POLICY: {} as Record<string, string>,
    DRY_RUN: false,
  },
}));

describe('fileFixer', () => {
  const repoPath = '/mock/repo';

  beforeEach(() => {
    vi.clearAllMocks();
    settings.DRY_RUN = false;
    settings.OVERWRITE_POLICY = {};
  });

  describe('ensureTemplateFile', () => {
    it('should create file if missing', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('not found'));
      vi.mocked(fs.readFile).mockResolvedValue('template content #YEAR#');

      const result = await ensureTemplateFile(repoPath, 'LICENSE');

      expect(result).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('LICENSE'),
        expect.stringContaining(new Date().getFullYear().toString()),
        'utf-8'
      );
      expect(Logger.success).toHaveBeenCalledWith(
        expect.stringContaining('Created')
      );
    });

    it('should not overwrite if exists and policy is if-missing', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      settings.OVERWRITE_POLICY['LICENSE'] = 'if-missing';

      const result = await ensureTemplateFile(repoPath, 'LICENSE');

      expect(result).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should overwrite if exists and policy is always', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue('new content');
      settings.OVERWRITE_POLICY['LICENSE'] = 'always';

      const result = await ensureTemplateFile(repoPath, 'LICENSE');

      expect(result).toBe(true);
      expect(fs.writeFile).toHaveBeenCalled();
      expect(Logger.success).toHaveBeenCalledWith(
        expect.stringContaining('Updated')
      );
    });

    it('should not overwrite CHANGELOG.md even if policy is always', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      settings.OVERWRITE_POLICY['CHANGELOG.md'] = 'always';

      const result = await ensureTemplateFile(repoPath, 'CHANGELOG.md');

      expect(result).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle dry run', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('not found'));
      vi.mocked(fs.readFile).mockResolvedValue('content');
      settings.DRY_RUN = true;

      const result = await ensureTemplateFile(repoPath, 'README.md');

      expect(result).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(Logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN]')
      );
    });
  });

  describe('getChangelogCommitMessage', () => {
    it('should return the first item under ### Added', async () => {
      const content = `
# Changelog
## [1.0.0]
### Added
- First feature
- Second feature
`;
      vi.mocked(fs.readFile).mockResolvedValue(content);

      const message = await getChangelogCommitMessage(repoPath);
      expect(message).toBe('First feature');
    });

    it('should return null if ### Added is not found', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('# Changelog\nNo added section');
      const message = await getChangelogCommitMessage(repoPath);
      expect(message).toBeNull();
    });

    it('should return null if file read fails', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('not found'));
      const message = await getChangelogCommitMessage(repoPath);
      expect(message).toBeNull();
    });
  });
});
