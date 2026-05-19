import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showMainMenu } from '../cli.js';
import { select } from '../utils/prompts.js';
import { addRepoCommand } from '../commands/addRepo.js';
import { syncRepoCommand } from '../commands/syncRepo.js';
import { scanReposCommand } from '../commands/scanRepos.js';
import { scanRepoCommand } from '../commands/scanRepo.js';

vi.mock('../utils/prompts.js');
vi.mock('../commands/addRepo.js');
vi.mock('../commands/syncRepo.js');
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

  it('should show rescan option and call it when selected', async () => {
    const mockRepo = { name: 'test-repo', url: 'https://github.com/test/repo' };

    // 1. First scan a repo to set lastScannedRepo
    vi.mocked(select)
      .mockResolvedValueOnce('scan')
      .mockResolvedValueOnce('rescan')
      .mockResolvedValueOnce('exit');

    vi.mocked(scanRepoCommand).mockResolvedValueOnce(mockRepo);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    try {
      await showMainMenu();
    } catch (e: any) {
      if (e.message !== 'process.exit') throw e;
    }

    // First call to scanRepoCommand (without args)
    expect(scanRepoCommand).toHaveBeenCalledWith();
    // Second call to scanRepoCommand (with mockRepo)
    expect(scanRepoCommand).toHaveBeenCalledWith(mockRepo);
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('should update lastScannedRepo when sync-repo is called', async () => {
    const mockRepo = { name: 'sync-repo', url: 'https://github.com/sync/repo' };

    vi.mocked(select)
      .mockResolvedValueOnce('sync-repo')
      .mockResolvedValueOnce('exit');

    vi.mocked(syncRepoCommand).mockResolvedValueOnce(mockRepo);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    try {
      await showMainMenu();
    } catch (e: any) {
      if (e.message !== 'process.exit') throw e;
    }

    expect(syncRepoCommand).toHaveBeenCalled();
    // After sync-repo, scanRepoCommand should NOT be called automatically anymore
    expect(scanRepoCommand).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });

  it('should update lastScannedRepo when add is called', async () => {
    const mockRepo = { name: 'add-repo', url: 'https://github.com/add/repo' };

    vi.mocked(select)
      .mockResolvedValueOnce('add')
      .mockResolvedValueOnce('exit');

    vi.mocked(addRepoCommand).mockResolvedValueOnce(mockRepo);

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit');
    });

    try {
      await showMainMenu();
    } catch (e: any) {
      if (e.message !== 'process.exit') throw e;
    }

    expect(addRepoCommand).toHaveBeenCalled();
    // After add, scanRepoCommand should NOT be called automatically anymore
    expect(scanRepoCommand).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    exitSpy.mockRestore();
  });
});
