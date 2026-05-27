import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectRepo } from '../utils/repoSelector.js';
import { readRepoList } from '../utils/repoList.js';
import { SearchableSelect } from '../utils/searchableSelect.js';

// Mock dependencies
vi.mock('../utils/repoList.js');
vi.mock('../utils/searchableSelect.js');
vi.mock('../utils/logger.js');

describe('repoSelector', () => {
  const mockRepoList = [
    { name: 'repo-a', url: 'https://github.com/user/repo-a' },
    { name: 'repo-b', url: 'https://github.com/user/repo-b' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the selected repo when a choice is made', async () => {
    vi.mocked(readRepoList).mockResolvedValue(mockRepoList as any);

    // Mock SearchableSelect
    const mockRun = vi.fn().mockResolvedValue('repo-a');
    vi.mocked(SearchableSelect).mockImplementation(
      class {
        run = mockRun;
      } as any
    );

    const result = await selectRepo();

    expect(result).toEqual({
      name: 'repo-a',
      url: 'https://github.com/user/repo-a',
      type: undefined,
      purpose: undefined,
      structure: undefined,
    });
  });

  it('should return null when the list is empty', async () => {
    vi.mocked(readRepoList).mockResolvedValue([]);

    const result = await selectRepo();
    expect(result).toBeNull();
  });

  it('should return null when user cancels (ESC)', async () => {
    vi.mocked(readRepoList).mockResolvedValue(mockRepoList as any);

    vi.mocked(SearchableSelect).mockImplementation(
      class {
        run = vi.fn().mockRejectedValue(new Error('User cancelled'));
      } as any
    );

    const result = await selectRepo();
    expect(result).toBeNull();
  });
});
