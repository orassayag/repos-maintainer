import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPnpmInstall } from '../utils/pnpm.js';
import { Logger } from '../utils/logger.js';
import { settings } from '../settings.js';
import { exec } from 'child_process';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));
vi.mock('../utils/logger.js');
vi.mock('../settings.js', () => ({
  settings: {
    DRY_RUN: false,
  },
}));

describe('pnpm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings.DRY_RUN = false;
  });

  it('should run pnpm install successfully', async () => {
    vi.mocked(exec).mockImplementation(((
      _cmd: string,
      _opts: any,
      callback: any
    ) => {
      callback(null, { stdout: 'done', stderr: '' });
    }) as any);

    const result = await runPnpmInstall('/mock/path');

    expect(result).toBe(true);
    expect(exec).toHaveBeenCalledWith(
      'pnpm install',
      { cwd: '/mock/path' },
      expect.any(Function)
    );
    expect(Logger.success).toHaveBeenCalled();
  });

  it('should handle dry run', async () => {
    settings.DRY_RUN = true;
    const result = await runPnpmInstall('/mock/path');

    expect(result).toBe(true);
    expect(exec).not.toHaveBeenCalled();
    expect(Logger.log).toHaveBeenCalledWith(
      expect.stringContaining('[DRY RUN]')
    );
  });

  it('should return false if pnpm install fails', async () => {
    vi.mocked(exec).mockImplementation(((
      _cmd: string,
      _opts: any,
      callback: any
    ) => {
      callback(new Error('pnpm failed'), { stdout: '', stderr: 'error' });
    }) as any);

    const result = await runPnpmInstall('/mock/path');

    expect(result).toBe(false);
    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('pnpm failed')
    );
  });
});
