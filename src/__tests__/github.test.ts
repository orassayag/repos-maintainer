import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getOctokit,
  checkGitHubAuth,
  repoExists,
  isRepoEmpty,
  parseGitHubUrl,
  resetOctokitInstance,
} from '../github.js';
import { Logger } from '../utils/logger.js';

vi.mock('../utils/logger.js');
vi.mock('@octokit/rest', () => {
  const Octokit = vi.fn(function () {
    return {
      users: {
        getAuthenticated: vi.fn(),
      },
      repos: {
        get: vi.fn(),
        listCommits: vi.fn(),
      },
    };
  });
  (Octokit as any).plugin = vi.fn().mockReturnValue(Octokit);
  return { Octokit };
});

describe('github', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOctokitInstance();
  });

  it('should initialize Octokit with throttling', async () => {
    const octokit = getOctokit();
    expect(octokit).toBeDefined();
    const { Octokit } = await import('@octokit/rest');
    expect(Octokit).toHaveBeenCalled();
  });

  it('should cover throttling callbacks', async () => {
    // We need to trigger initialization first
    getOctokit();

    // This is tricky because it's passed to the constructor.
    // We can check the constructor arguments.
    const { Octokit } = await import('@octokit/rest');
    const mockedOctokit = vi.mocked(Octokit);
    const options = mockedOctokit.mock.calls[0][0];

    expect(options).toBeDefined();
    expect(options!.throttle).toBeDefined();

    // Test onRateLimit
    const onRateLimit = options!.throttle!.onRateLimit;
    const result = onRateLimit!(10, {} as any, {} as any, 0);
    expect(result).toBe(true);
    expect(Logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Rate limit hit. Retrying after 10 seconds...')
    );

    // Test onSecondaryRateLimit
    const onSecondaryRateLimit = options!.throttle!.onSecondaryRateLimit;
    const result2 = onSecondaryRateLimit!(10, {} as any, {} as any, 0);
    expect(result2).toBe(true);
  });

  it('should check GitHub auth successfully', async () => {
    const octokit = getOctokit();
    vi.mocked(octokit.users.getAuthenticated).mockResolvedValue({
      data: { login: 'testuser' },
    } as any);

    const result = await checkGitHubAuth();
    expect(result).toBe(true);
    expect(Logger.success).toHaveBeenCalledWith(
      'GitHub authenticated as: testuser'
    );
  });

  it('should handle GitHub auth failure', async () => {
    const octokit = getOctokit();
    vi.mocked(octokit.users.getAuthenticated).mockRejectedValue(
      new Error('Unauthorized')
    );

    const result = await checkGitHubAuth();
    expect(result).toBe(false);
    expect(Logger.error).toHaveBeenCalledWith('GitHub authentication failed.');
  });

  it('should check if repo exists', async () => {
    const octokit = getOctokit();
    vi.mocked(octokit.repos.get).mockResolvedValue({} as any);

    const exists = await repoExists('owner', 'repo');
    expect(exists).toBe(true);
  });

  it('should handle repo not existing', async () => {
    const octokit = getOctokit();
    vi.mocked(octokit.repos.get).mockRejectedValue(new Error('Not Found'));

    const exists = await repoExists('owner', 'repo');
    expect(exists).toBe(false);
  });

  it('should check if repo is empty', async () => {
    const octokit = getOctokit();
    vi.mocked(octokit.repos.listCommits).mockResolvedValue({
      data: [{ sha: '123' }],
    } as any);

    const empty = await isRepoEmpty('owner', 'repo');
    expect(empty).toBe(false);
  });

  it('should handle empty repo (409)', async () => {
    const octokit = getOctokit();
    vi.mocked(octokit.repos.listCommits).mockRejectedValue({ status: 409 });

    const empty = await isRepoEmpty('owner', 'repo');
    expect(empty).toBe(true);
  });

  it('should handle empty repo (404)', async () => {
    const octokit = getOctokit();
    vi.mocked(octokit.repos.listCommits).mockRejectedValue({ status: 404 });

    const empty = await isRepoEmpty('owner', 'repo');
    expect(empty).toBe(true);
  });

  it('should handle other errors in isRepoEmpty as empty for safety', async () => {
    const octokit = getOctokit();
    vi.mocked(octokit.repos.listCommits).mockRejectedValue(
      new Error('Unknown')
    );

    const empty = await isRepoEmpty('owner', 'repo');
    expect(empty).toBe(true);
  });

  it('should parse GitHub URL correctly', () => {
    expect(parseGitHubUrl('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseGitHubUrl('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseGitHubUrl('git@github.com:owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseGitHubUrl('invalid')).toBeNull();
  });
});
