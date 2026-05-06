import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scanner } from '../utils/scanner.js';
import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';

vi.mock('fs/promises');
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});
vi.mock('child_process');
vi.mock('../settings.js', () => ({
  getLocalRepoPath: vi.fn((name) => `/mock/path/${name}`),
}));
vi.mock('../github.js', () => ({
  parseGitHubUrl: vi.fn((url) => ({ owner: 'user', repo: 'repo' })),
  getRepoMetadata: vi.fn(),
  isRepoStarred: vi.fn(),
  isRepoWatched: vi.fn(),
  getRulesets: vi.fn(),
}));

describe('Scanner', () => {
  let scanner: Scanner;
  const mockRepo = { name: 'test-repo', url: 'https://github.com/user/test-repo' };

  beforeEach(() => {
    vi.clearAllMocks();
    scanner = new Scanner();
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(fs.readFile).mockResolvedValue('');
    vi.mocked(spawnSync).mockReturnValue({ stdout: '', stderr: '', status: 0 } as any);
    vi.mocked(existsSync).mockReturnValue(false);
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
        status: 0
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const prettierIssue = result.issues.find(i => i.message.includes('Prettier'));
      expect(prettierIssue).toBeDefined();
      expect(prettierIssue?.message).toContain('2 file(s) unformatted');
    });

    it('should detect and check ESLint', async () => {
      const repoPath = process.platform === 'win32' ? 'C:\\mock\\path\\test-repo' : '/mock/path/test-repo';
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
            status: 1
          } as any;
        }
        return { stdout: '', stderr: '', status: 0 } as any;
      });

      const result = await scanner.scanRepo(mockRepo);
      const eslintIssue = result.issues.find(i => i.message.toLowerCase().includes('eslint'));
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
        status: 1
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const biomeIssue = result.issues.find(i => i.message.includes('Biome'));
      expect(biomeIssue).toBeDefined();
    });

    it('should detect and check Stylelint', async () => {
        vi.mocked(existsSync).mockImplementation((p: any) => {
          if (p.toString().endsWith('.stylelintrc')) return true;
          return false;
        });
  
        vi.mocked(spawnSync).mockReturnValue({
          stdout: JSON.stringify([{ source: 'style.css', warnings: [{ fixable: true }] }]),
          stderr: '',
          status: 1
        } as any);
  
        const result = await scanner.scanRepo(mockRepo);
        const issue = result.issues.find(i => i.message.includes('Stylelint'));
        expect(issue).toBeDefined();
      });

    it('should detect and check rustfmt', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (p.toString().endsWith('Cargo.toml')) return true;
        return false;
      });

      vi.mocked(spawnSync).mockReturnValue({
        stdout: 'Diff in src/main.rs at line 1:',
        stderr: '',
        status: 1
      } as any);

      const result = await scanner.scanRepo(mockRepo);
      const issue = result.issues.find(i => i.message.includes('rustfmt'));
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
          status: 1
        } as any);
  
        const result = await scanner.scanRepo(mockRepo);
        const issue = result.issues.find(i => i.message.includes('gofmt'));
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
          status: 1
        } as any);
  
        const result = await scanner.scanRepo(mockRepo);
        const issue = result.issues.find(i => i.message.includes('Black'));
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
      const prettierCall = spawnCalls.find(c => c[0].toString().includes('prettier'));
      expect(prettierCall?.[0]).toContain('node_modules');
    });

    it('should use npx if local bin missing', async () => {
      vi.mocked(existsSync).mockImplementation((p: any) => {
        if (p.toString().endsWith('.prettierrc')) return true;
        return false;
      });

      await scanner.scanRepo(mockRepo);
      
      const spawnCalls = vi.mocked(spawnSync).mock.calls;
      const prettierCall = spawnCalls.find(c => c[0].toString().includes('prettier'));
      expect(prettierCall?.[0]).toContain('npx --yes');
    });
  });
});
