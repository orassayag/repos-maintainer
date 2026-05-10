import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixMetadata } from '../fixers/metadataFixer.js';
import {
  getRepoMetadata,
  updateRepoMetadata,
  replaceTopics,
} from '../github.js';
import { settings } from '../settings.js';

vi.mock('../github.js');
vi.mock('../utils/logger.js');
vi.mock('../settings.js', () => ({
  settings: {
    DESCRIPTION_MIN_REPLACE: 300,
    DESCRIPTION_MAX: 350,
    DEFAULT_DESCRIPTION:
      'Default description with more than three hundred characters to satisfy the minimum requirements of the maintainer tool for high quality repositories.',
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

    expect(
      result.some((s) => s.includes('Description: Replaced with default'))
    ).toBe(true);
    expect(updateRepoMetadata).toHaveBeenCalledWith(
      owner,
      repo,
      expect.objectContaining({
        description: settings.DEFAULT_DESCRIPTION,
      })
    );
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

    expect(result.some((s) => s.includes('Description: Truncated'))).toBe(true);
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

    expect(result.some((s) => s.includes('Homepage: Set to'))).toBe(true);
    expect(updateRepoMetadata).toHaveBeenCalledWith(
      owner,
      repo,
      expect.objectContaining({
        homepage: settings.DEFAULT_HOMEPAGE,
      })
    );
  });

  it('should pad topics if fewer than minimum', async () => {
    vi.mocked(getRepoMetadata).mockResolvedValue({
      description: 'A'.repeat(320),
      homepage: 'home',
      topics: ['existing'],
      defaultBranch: 'main',
    });

    const result = await fixMetadata(owner, repo);

    expect(result.some((s) => s.includes('Topics: Padded'))).toBe(true);
    expect(replaceTopics).toHaveBeenCalled();
  });

  it('should handle metadata fetch failure', async () => {
    vi.mocked(getRepoMetadata).mockRejectedValue(new Error('API Error'));

    const result = await fixMetadata(owner, repo);

    expect(result.some((s) => s.includes('Metadata: Failed to fetch'))).toBe(
      true
    );
    expect(updateRepoMetadata).not.toHaveBeenCalled();
  });

  it('should truncate at word boundary', async () => {
    // Description length > 350, with a space near the boundary (320-350)
    const description = 'A'.repeat(330) + ' ' + 'B'.repeat(40); // Space at 330
    vi.mocked(getRepoMetadata).mockResolvedValue({
      description,
      homepage: 'home',
      topics: ['t1', 't2', 't3', 't4', 't5'],
      defaultBranch: 'main',
    });

    const result = await fixMetadata(owner, repo);

    expect(result.some((s) => s.includes('Description: Truncated'))).toBe(true);
    const updatedDesc = vi.mocked(updateRepoMetadata).mock.calls[0]![2]!
      .description as string;
    expect(updatedDesc.length).toBe(330); // Truncated at the space
    expect(updatedDesc).not.toMatch(/\s$/);
  });

  it('should handle dry run', async () => {
    settings.DRY_RUN = true;
    vi.mocked(getRepoMetadata).mockResolvedValue({
      description: 'too short',
      homepage: '',
      topics: ['t1'],
      defaultBranch: 'main',
    });

    const result = await fixMetadata(owner, repo);

    expect(result.some((s) => s.includes('Description: Replaced'))).toBe(true);
    expect(result.some((s) => s.includes('Homepage: Set to'))).toBe(true);
    expect(result.some((s) => s.includes('Topics: Padded'))).toBe(true);

    expect(updateRepoMetadata).not.toHaveBeenCalled();
    expect(replaceTopics).not.toHaveBeenCalled();
  });

  it('should handle topics padding when defaults are already present', async () => {
    vi.mocked(getRepoMetadata).mockResolvedValue({
      description: 'A'.repeat(320),
      homepage: 'home',
      topics: ['t1', 't2'], // Defaults are t1, t2, t3, t4, t5
      defaultBranch: 'main',
    });

    // Mock settings to have only t1 and t2 as defaults
    const originalDefaults = settings.DEFAULT_TOPICS;
    settings.DEFAULT_TOPICS = ['t1', 't2'];
    settings.MIN_TOPICS = 5;

    const result = await fixMetadata(owner, repo);

    expect(result.some((s) => s.includes('could not pad further'))).toBe(true);
    expect(replaceTopics).not.toHaveBeenCalled();

    // Restore
    settings.DEFAULT_TOPICS = originalDefaults;
  });
});
