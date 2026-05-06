import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixMetadata } from '../fixers/metadataFixer.js';
import { getRepoMetadata, updateRepoMetadata, replaceTopics } from '../github.js';
import { settings } from '../settings.js';

vi.mock('../github.js');
vi.mock('../utils/logger.js');
vi.mock('../settings.js', () => ({
  settings: {
    DESCRIPTION_MIN_REPLACE: 300,
    DESCRIPTION_MAX: 350,
    DEFAULT_DESCRIPTION: 'Default description with more than three hundred characters to satisfy the minimum requirements of the maintainer tool for high quality repositories.',
    DEFAULT_HOMEPAGE: 'https://linkedin.com/in/user',
    MIN_TOPICS: 5,
    DEFAULT_TOPICS: ['t1', 't2', 't3', 't4', 't5'],
    DRY_RUN: false,
  },
}));

describe('metadataFixer', () => {
  const owner = 'user';
  const repo = 'test-repo';

  beforeEach(() => {
    vi.clearAllMocks();
    settings.DRY_RUN = false;
  });

  it('should replace short description', async () => {
    vi.mocked(getRepoMetadata).mockResolvedValue({
      description: 'too short',
      homepage: 'home',
      topics: ['t1', 't2', 't3', 't4', 't5'],
      defaultBranch: 'main',
    });

    const result = await fixMetadata(owner, repo);

    expect(result.some(s => s.includes('Description: Replaced with default'))).toBe(true);
    expect(updateRepoMetadata).toHaveBeenCalledWith(owner, repo, expect.objectContaining({
      description: settings.DEFAULT_DESCRIPTION
    }));
  });

  it('should truncate long description', async () => {
    const longDesc = 'A'.repeat(400);
    vi.mocked(getRepoMetadata).mockResolvedValue({
      description: longDesc,
      homepage: 'home',
      topics: ['t1', 't2', 't3', 't4', 't5'],
      defaultBranch: 'main',
    });

    const result = await fixMetadata(owner, repo);

    expect(result.some(s => s.includes('Description: Truncated'))).toBe(true);
    expect(updateRepoMetadata).toHaveBeenCalled();
  });

  it('should set homepage if empty', async () => {
    vi.mocked(getRepoMetadata).mockResolvedValue({
      description: 'A'.repeat(320),
      homepage: '',
      topics: ['t1', 't2', 't3', 't4', 't5'],
      defaultBranch: 'main',
    });

    const result = await fixMetadata(owner, repo);

    expect(result.some(s => s.includes('Homepage: Set to'))).toBe(true);
    expect(updateRepoMetadata).toHaveBeenCalledWith(owner, repo, expect.objectContaining({
      homepage: settings.DEFAULT_HOMEPAGE
    }));
  });

  it('should pad topics if fewer than minimum', async () => {
    vi.mocked(getRepoMetadata).mockResolvedValue({
      description: 'A'.repeat(320),
      homepage: 'home',
      topics: ['existing'],
      defaultBranch: 'main',
    });

    const result = await fixMetadata(owner, repo);

    expect(result.some(s => s.includes('Topics: Padded'))).toBe(true);
    expect(replaceTopics).toHaveBeenCalled();
  });
});
