import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showMainMenu } from '../cli.js';
import { select } from '../utils/prompts.js';
import { addRepoCommand } from '../commands/addRepo.js';
import { scanReposCommand } from '../commands/scanRepos.js';
import { scanRepoCommand } from '../commands/scanRepo.js';

vi.mock('../utils/prompts.js');
vi.mock('../commands/addRepo.js');
vi.mock('../commands/scanRepos.js');
vi.mock('../commands/scanRepo.js');

describe('cli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call addRepoCommand when "add" is selected', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce('add')
      .mockResolvedValueOnce('exit');

    // We expect it to call addRepoCommand and then exit
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    try {
      await showMainMenu();
    } catch (e: any) {
      if (e.message !== 'process.exit') throw e;
    }

    expect(addRepoCommand).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('should call scanRepoCommand when "scan" is selected', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce('scan')
      .mockResolvedValueOnce('exit');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    try {
      await showMainMenu();
    } catch (e: any) {
      if (e.message !== 'process.exit') throw e;
    }

    expect(scanRepoCommand).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('should call scanReposCommand when "sync" is selected', async () => {
    vi.mocked(select)
      .mockResolvedValueOnce('sync')
      .mockResolvedValueOnce('exit');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    try {
      await showMainMenu();
    } catch (e: any) {
      if (e.message !== 'process.exit') throw e;
    }

    expect(scanReposCommand).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });
});
