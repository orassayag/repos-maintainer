import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scanner } from '../utils/scanner.js';
import { syncTemplateFiles } from '../utils/fileFixer.js';
import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
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
vi.mock('../utils/logger.js');
vi.mock('../utils/projectType.js', () => ({
  isTypeScriptProject: vi.fn(() => Promise.resolve(true)),
  isDotNetOrWindowsProject: vi.fn(() => Promise.resolve(false)),
}));
vi.mock('../settings.js', () => ({
  getLocalRepoPath: vi.fn((name) => `/mock/path/${name}`.replace(/\//g, '\\')),
  settings: {
    TEMPLATES_DIR: '/mock/templates'.replace(/\//g, '\\'),
    OVERWRITE_POLICY: {},
  },
}));

describe('VSCode Settings Validation and Sync', () => {
  const repoPath = '/mock/path/test-repo'.replace(/\//g, '\\');
  const settingsPath = path.join(repoPath, '.vscode', 'settings.json');
  const templateSettingsPath = '/mock/templates/.vscode/settings.json'.replace(
    /\//g,
    '\\'
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Scanner Validation', () => {
    it('should report missing cSpell.ignorePaths in .vscode/settings.json', async () => {
      const scanner = new Scanner();
      vi.mocked(existsSync).mockImplementation((p: any) => p === settingsPath);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'cSpell.words': ['word1'],
        })
      );

      // Mock other things to make scanRepo happy
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const result = await scanner.scanRepo({
        name: 'test-repo',
        url: 'https://github.com/user/test-repo',
      });

      const issue = result.issues.find((i) =>
        i.message.includes('Missing "cSpell.ignorePaths" section')
      );
      expect(issue).toBeDefined();
    });

    it('should NOT report if cSpell.ignorePaths exists', async () => {
      const scanner = new Scanner();
      vi.mocked(existsSync).mockImplementation((p: any) => p === settingsPath);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'cSpell.words': ['word1'],
          'cSpell.ignorePaths': ['path1'],
        })
      );

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const result = await scanner.scanRepo({
        name: 'test-repo',
        url: 'https://github.com/user/test-repo',
      });

      const issue = result.issues.find((i) =>
        i.message.includes('Missing "cSpell.ignorePaths" section')
      );
      expect(issue).toBeUndefined();
    });
  });

  describe('Sync Logic', () => {
    it('should add cSpell.ignorePaths after cSpell.words if missing', async () => {
      const templateJson = {
        'cSpell.words': ['templateWord'],
        'cSpell.ignorePaths': ['templatePath'],
      };
      const destJson = {
        'cSpell.words': ['destWord'],
        otherSetting: true,
      };

      vi.mocked(fs.readFile).mockImplementation((p: any) => {
        if (p === templateSettingsPath)
          return Promise.resolve(JSON.stringify(templateJson));
        if (p === settingsPath)
          return Promise.resolve(JSON.stringify(destJson));
        return Promise.resolve('');
      });
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const changes = await syncTemplateFiles(repoPath, [
        '.vscode/settings.json',
      ]);

      expect(changes).toContain(
        'Updated .vscode/settings.json: Added missing cSpell.ignorePaths'
      );
      expect(fs.writeFile).toHaveBeenCalled();

      const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      const writtenJson = JSON.parse(writtenContent);

      const keys = Object.keys(writtenJson);
      expect(keys.indexOf('cSpell.ignorePaths')).toBe(
        keys.indexOf('cSpell.words') + 1
      );
      expect(writtenJson['cSpell.ignorePaths']).toEqual(['templatePath']);
    });

    it('should create .vscode/settings.json if missing', async () => {
      const templateJson = {
        'cSpell.words': ['templateWord'],
        'cSpell.ignorePaths': ['templatePath'],
      };

      vi.mocked(fs.readFile).mockImplementation((p: any) => {
        if (p === templateSettingsPath)
          return Promise.resolve(JSON.stringify(templateJson));
        if (p === settingsPath)
          return Promise.reject(new Error('File not found'));
        return Promise.resolve('');
      });
      vi.mocked(fs.access).mockImplementation((p: any) => {
        if (p === settingsPath)
          return Promise.reject(new Error('File not found'));
        return Promise.resolve(undefined);
      });

      const changes = await syncTemplateFiles(repoPath, [
        '.vscode/settings.json',
      ]);

      expect(changes).toContain('Created missing .vscode/settings.json');
    });
  });
});
