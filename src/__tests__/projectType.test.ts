import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isTypeScriptProject } from '../utils/projectType.js';
import fs from 'fs/promises';

vi.mock('fs/promises');

describe('projectType', () => {
  const repoPath = '/mock/repo';

  beforeEach((): void => {
    vi.clearAllMocks();
  });

  it('should detect TS project if .ts files exist and no JS entry points', async (): Promise<void> => {
    vi.mocked(fs.readdir).mockResolvedValue([
      {
        name: 'main.ts',
        isFile: (): boolean => true,
        isDirectory: (): boolean => false,
      },
    ] as any);
    vi.mocked(fs.access).mockImplementation((p: any): Promise<void> => {
      if (
        p.includes('index.js') ||
        p.includes('main.js') ||
        p.includes('app.js')
      ) {
        return Promise.reject(new Error('Not found'));
      }
      return Promise.resolve();
    });

    const result = await isTypeScriptProject(repoPath);
    expect(result).toBe(true);
  });

  it('should detect JS project if index.js exists and no TS dependency, even if some .ts files exist', async (): Promise<void> => {
    // Mocking hasTypeScriptFiles to return true
    vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
      if (p === repoPath) {
        return Promise.resolve([
          {
            name: 'random.ts',
            isFile: (): boolean => true,
            isDirectory: (): boolean => false,
          },
          {
            name: 'index.js',
            isFile: (): boolean => true,
            isDirectory: (): boolean => false,
          },
        ] as any);
      }
      return Promise.resolve([]);
    });

    vi.mocked(fs.access).mockImplementation((p: any): Promise<void> => {
      if (p.includes('index.js')) return Promise.resolve();
      return Promise.reject(new Error('Not found'));
    });

    // Mock package.json without TS dep
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        name: 'js-project',
        main: 'index.js',
      })
    );

    const result = await isTypeScriptProject(repoPath);
    expect(result).toBe(false);
  });

  it('should detect TS project if TS dependency exists even if index.js exists (migrating project)', async (): Promise<void> => {
    vi.mocked(fs.readdir).mockImplementation((p: any): Promise<any> => {
      if (p === repoPath) {
        return Promise.resolve([
          {
            name: 'main.ts',
            isFile: (): boolean => true,
            isDirectory: (): boolean => false,
          },
          {
            name: 'index.js',
            isFile: (): boolean => true,
            isDirectory: (): boolean => false,
          },
        ] as any);
      }
      return Promise.resolve([]);
    });

    vi.mocked(fs.access).mockImplementation((p: any): Promise<void> => {
      if (p.includes('index.js')) return Promise.resolve();
      return Promise.reject(new Error('Not found'));
    });

    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        name: 'migrating-project',
        devDependencies: { typescript: '^5.0.0' },
      })
    );

    const result = await isTypeScriptProject(repoPath);
    expect(result).toBe(true);
  });

  it('should detect JS project if main points to .js and no TS dep', async (): Promise<void> => {
    vi.mocked(fs.readdir).mockResolvedValue([]); // No TS files
    vi.mocked(fs.access).mockRejectedValue(new Error('Not found'));

    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        name: 'js-project',
        main: 'dist/bundle.js',
      })
    );

    const result = await isTypeScriptProject(repoPath);
    expect(result).toBe(false);
  });
});
