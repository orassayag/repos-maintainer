import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ensureTemplateFile,
  getChangelogCommitMessage,
  syncTemplateFiles,
} from '../utils/fileFixer.js';
import fs from 'fs/promises';
import { settings } from '../settings.js';
import { Logger } from '../utils/logger.js';

vi.mock('fs/promises');
vi.mock('../utils/logger.js');
vi.mock('../settings.js', () => ({
  settings: {
    TEMPLATES_DIR: '/mock/templates',
    OVERWRITE_POLICY: {} as Record<string, string>,
    DRY_RUN: false,
  },
}));
vi.mock('../utils/projectType.js', () => ({
  isTypeScriptProject: vi.fn(),
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

  describe('syncTemplateFiles', () => {
    it('should copy missing files', async () => {
      const { isTypeScriptProject } = await import('../utils/projectType.js');
      vi.mocked(isTypeScriptProject).mockResolvedValue(true);

      vi.mocked(fs.access).mockRejectedValue(new Error('not found'));
      vi.mocked(fs.readFile).mockResolvedValue('template content');

      const result = await syncTemplateFiles(repoPath, ['.prettierrc']);

      expect(result).toContain('Created missing file: .prettierrc');
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should NOT copy missing TS files if project is NOT TypeScript', async () => {
      const { isTypeScriptProject } = await import('../utils/projectType.js');
      vi.mocked(isTypeScriptProject).mockResolvedValue(false);

      vi.mocked(fs.access).mockRejectedValue(new Error('not found'));
      vi.mocked(fs.readFile).mockResolvedValue('template content');

      const result = await syncTemplateFiles(repoPath, ['tsconfig.json']);

      expect(result).not.toContain('Created missing file: tsconfig.json');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should sync .gitignore by appending missing lines', async () => {
      const { isTypeScriptProject } = await import('../utils/projectType.js');
      vi.mocked(isTypeScriptProject).mockResolvedValue(true);

      const templateGitignore = 'node_modules/\ndist/\n# Comment\n.env';
      const existingGitignore = 'node_modules/\n';

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockImplementation((path) => {
        if (path.toString().includes('templates'))
          return Promise.resolve(templateGitignore);
        return Promise.resolve(existingGitignore);
      });
      vi.mocked(fs.appendFile).mockResolvedValue(undefined);

      const result = await syncTemplateFiles(repoPath, ['.gitignore']);

      expect(result).toContain('Added 2 missing lines to .gitignore');
      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.stringContaining('.gitignore'),
        expect.stringContaining('# Others:\ndist/\n.env'),
        'utf-8'
      );
    });

    it('should sync LICENSE and preserve year', async () => {
      const { isTypeScriptProject } = await import('../utils/projectType.js');
      vi.mocked(isTypeScriptProject).mockResolvedValue(true);

      const templateLicense = 'Copyright (c) #YEAR# Or Assayag\nMIT License';
      const existingLicense = 'Copyright (c) 2023 Or Assayag\nOld Content';

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockImplementation((path) => {
        if (path.toString().includes('templates'))
          return Promise.resolve(templateLicense);
        return Promise.resolve(existingLicense);
      });

      const result = await syncTemplateFiles(repoPath, ['LICENSE']);

      expect(result).toContain('Updated LICENSE (preserved year: 2023)');
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('LICENSE'),
        'Copyright (c) 2023 Or Assayag\nMIT License',
        'utf-8'
      );
    });

    it('should handle LICENSE with year range', async () => {
      const templateLicense = 'Copyright (c) #YEAR# Or Assayag\nMIT License';
      const existingLicense = 'Copyright (c) 2017-2023 Or Assayag\nOld Content';

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockImplementation((path) => {
        if (path.toString().includes('templates'))
          return Promise.resolve(templateLicense);
        return Promise.resolve(existingLicense);
      });

      const result = await syncTemplateFiles(repoPath, ['LICENSE']);

      expect(result).toContain('Updated LICENSE (preserved year: 2017-2023)');
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('LICENSE'),
        'Copyright (c) 2017-2023 Or Assayag\nMIT License',
        'utf-8'
      );
    });

    it('should warn if LICENSE has no year', async () => {
      const templateLicense = 'Copyright (c) #YEAR# Or Assayag\nMIT License';
      const existingLicense = 'Copyright (c) Or Assayag\nOld Content';

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockImplementation((path) => {
        if (path.toString().includes('templates'))
          return Promise.resolve(templateLicense);
        return Promise.resolve(existingLicense);
      });

      const result = await syncTemplateFiles(repoPath, ['LICENSE']);

      expect(result).toContain(
        "Unable to update the LICENSE file since it doesn't contain a year"
      );
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });
});
