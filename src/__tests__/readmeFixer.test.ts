import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixReadme } from '../fixers/readmeFixer.js';
import fs from 'fs/promises';
import { settings } from '../settings.js';
import { Logger } from '../utils/logger.js';

vi.mock('fs/promises');
vi.mock('../utils/logger.js');
vi.mock('../settings.js', () => ({
  settings: {
    AUTHOR_NAME: 'Or Assayag',
    AUTHOR_EMAIL: 'orassayag@gmail.com',
    AUTHOR_GITHUB: 'orassayag',
    AUTHOR_STACKOVERFLOW: 'or-assayag',
    DRY_RUN: false,
  },
}));

describe('readmeFixer', () => {
  const repoPath = '/mock/repo';

  beforeEach(() => {
    vi.clearAllMocks();
    settings.DRY_RUN = false;
  });

  it('should append Author and License sections if missing', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('# Test Repo\n');

    const result = await fixReadme(repoPath);

    expect(result).toBe(true);
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
    expect(written).toContain('## Author');
    expect(written).toContain('Or Assayag');
    expect(written).toContain('## License');
    expect(written).toContain('MIT License');
  });

  it('should return false if sections already exist', async () => {
    const existing = '## Author\nOr Assayag\n## License\nMIT License';
    vi.mocked(fs.readFile).mockResolvedValue(existing);

    const result = await fixReadme(repoPath);

    expect(result).toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('should handle dry run', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('# Test Repo\n');
    settings.DRY_RUN = true;

    const result = await fixReadme(repoPath);

    expect(result).toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(Logger.log).toHaveBeenCalledWith(
      expect.stringContaining('[DRY RUN]')
    );
  });
});
