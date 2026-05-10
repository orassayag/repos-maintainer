import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Scanner } from '../utils/scanner.js';

vi.mock('fs/promises');
vi.mock('../settings.js', () => ({
  getLocalRepoPath: vi.fn().mockReturnValue('mock-path'),
}));
vi.mock('../github.js', () => ({
  parseGitHubUrl: vi.fn(),
  getRepoMetadata: vi.fn(),
  isRepoStarred: vi.fn(),
  isRepoWatched: vi.fn(),
  getRulesets: vi.fn(),
}));

describe('Scanner .gitignore validation', () => {
  let scanner: Scanner;

  beforeEach(() => {
    vi.clearAllMocks();
    scanner = new Scanner();
  });

  it('should report missing lines in .gitignore', async () => {
    const templateContent = `
# Logs
logs
*.log

# Dist
dist
node_modules
`.trim();

    const targetContent = `
# Logs
logs

# Dist
node_modules
`.trim();

    // @ts-ignore - accessing private method for testing
    await scanner.validateGitignore(targetContent, templateContent);

    // @ts-ignore - accessing private field for testing
    const issues = scanner['scanIssues'];

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('*.log');
    expect(issues[0].message).toContain('dist');
    expect(issues[0].message).not.toContain('logs');
    expect(issues[0].message).not.toContain('node_modules');
  });

  it('should not report if all template lines exist', async () => {
    const templateContent = `
dist
node_modules
`.trim();

    const targetContent = `
# My custom gitignore
dist
node_modules
custom-file
`.trim();

    // @ts-ignore - accessing private method for testing
    await scanner.validateGitignore(targetContent, templateContent);

    // @ts-ignore - accessing private field for testing
    const issues = scanner['scanIssues'];

    expect(issues).toHaveLength(0);
  });
});
