import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseGitHubUrl,
  checkGitHubAuth,
  repoExists,
  isRepoEmpty,
  getRepoMetadata,
  updateRepoMetadata,
  replaceTopics,
  isRepoStarred,
  isRepoWatched,
  starRepo,
  watchRepo,
  getRulesets,
  getRulesetDetails,
  createRuleset,
  updateRuleset,
} from '../github.js';
import { Logger } from '../utils/logger.js';

const mockOctokit = {
  users: {
    getAuthenticated: vi.fn(),
  },
  repos: {
    get: vi.fn(),
    listCommits: vi.fn(),
    update: vi.fn(),
    replaceAllTopics: vi.fn(),
    getRepoRulesets: vi.fn(),
    getRepoRuleset: vi.fn(),
    createRepoRuleset: vi.fn(),
    updateRepoRuleset: vi.fn(),
  },
  activity: {
    checkRepoIsStarredByAuthenticatedUser: vi.fn(),
    getRepoSubscription: vi.fn(),
    starRepoForAuthenticatedUser: vi.fn(),
    setRepoSubscription: vi.fn(),
  },
};

vi.mock('@octokit/rest', () => {
  return {
    Octokit: {
      plugin: vi.fn().mockReturnValue(function () {
        return mockOctokit;
      }),
    },
  };
});

vi.mock('../utils/logger.js');

describe('github utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseGitHubUrl', () => {
    it('should parse standard https URL', () => {
      const url = 'https://github.com/orassayag/repos-maintainer';
      const result = parseGitHubUrl(url);
      expect(result).toEqual({ owner: 'orassayag', repo: 'repos-maintainer' });
    });

    it('should parse URL with .git extension', () => {
      const url = 'https://github.com/orassayag/repos-maintainer.git';
      const result = parseGitHubUrl(url);
      expect(result).toEqual({ owner: 'orassayag', repo: 'repos-maintainer' });
    });

    it('should parse SSH URL', () => {
      const url = 'git@github.com:orassayag/repos-maintainer.git';
      const result = parseGitHubUrl(url);
      expect(result).toEqual({ owner: 'orassayag', repo: 'repos-maintainer' });
    });

    it('should return null for non-github URLs', () => {
      const url = 'https://gitlab.com/orassayag/repos-maintainer';
      const result = parseGitHubUrl(url);
      expect(result).toBeNull();
    });

    it('should return null for invalid strings', () => {
      const url = 'not-a-url';
      const result = parseGitHubUrl(url);
      expect(result).toBeNull();
    });
  });

  describe('checkGitHubAuth', () => {
    it('should return true if authenticated', async () => {
      mockOctokit.users.getAuthenticated.mockResolvedValue({
        data: { login: 'user' },
      });
      const result = await checkGitHubAuth();
      expect(result).toBe(true);
      expect(Logger.success).toHaveBeenCalledWith(
        expect.stringContaining('user')
      );
    });

    it('should return false if auth fails', async () => {
      mockOctokit.users.getAuthenticated.mockRejectedValue(new Error('fail'));
      const result = await checkGitHubAuth();
      expect(result).toBe(false);
      expect(Logger.error).toHaveBeenCalled();
    });
  });

  describe('repoExists', () => {
    it('should return true if repo exists', async () => {
      mockOctokit.repos.get.mockResolvedValue({ data: {} });
      const result = await repoExists('owner', 'repo');
      expect(result).toBe(true);
    });

    it('should return false if repo does not exist', async () => {
      mockOctokit.repos.get.mockRejectedValue(new Error('fail'));
      const result = await repoExists('owner', 'repo');
      expect(result).toBe(false);
    });
  });

  describe('isRepoEmpty', () => {
    it('should return false if commits exist', async () => {
      mockOctokit.repos.listCommits.mockResolvedValue({ data: [{}] });
      const result = await isRepoEmpty('owner', 'repo');
      expect(result).toBe(false);
    });

    it('should return true if commits fail with 409', async () => {
      const err = new Error('empty');
      (err as any).status = 409;
      mockOctokit.repos.listCommits.mockRejectedValue(err);
      const result = await isRepoEmpty('owner', 'repo');
      expect(result).toBe(true);
    });

    it('should return true if commits fail with 404', async () => {
      const err = new Error('not found');
      (err as any).status = 404;
      mockOctokit.repos.listCommits.mockRejectedValue(err);
      const result = await isRepoEmpty('owner', 'repo');
      expect(result).toBe(true);
    });

    it('should return true for other errors in listCommits', async () => {
      mockOctokit.repos.listCommits.mockRejectedValue(new Error('other'));
      const result = await isRepoEmpty('owner', 'repo');
      expect(result).toBe(true);
    });
  });

  describe('getRepoMetadata', () => {
    it('should return metadata', async () => {
      mockOctokit.repos.get.mockResolvedValue({
        data: {
          description: 'desc',
          homepage: 'home',
          topics: ['t1'],
          default_branch: 'main',
        },
      });
      const result = await getRepoMetadata('owner', 'repo');
      expect(result).toEqual({
        description: 'desc',
        homepage: 'home',
        topics: ['t1'],
        defaultBranch: 'main',
      });
    });

    it('should return empty fields if missing in response', async () => {
      mockOctokit.repos.get.mockResolvedValue({
        data: {
          default_branch: 'main',
        },
      });
      const result = await getRepoMetadata('owner', 'repo');
      expect(result.description).toBe('');
      expect(result.homepage).toBe('');
      expect(result.topics).toEqual([]);
    });
  });

  describe('updateRepoMetadata', () => {
    it('should call update', async () => {
      mockOctokit.repos.update.mockResolvedValue({});
      await updateRepoMetadata('owner', 'repo', { description: 'new' });
      expect(mockOctokit.repos.update).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        description: 'new',
      });
    });
  });

  describe('replaceTopics', () => {
    it('should call replaceAllTopics', async () => {
      mockOctokit.repos.replaceAllTopics.mockResolvedValue({});
      await replaceTopics('owner', 'repo', ['t1']);
      expect(mockOctokit.repos.replaceAllTopics).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        names: ['t1'],
      });
    });
  });

  describe('star & watch', () => {
    it('should check if starred', async () => {
      mockOctokit.activity.checkRepoIsStarredByAuthenticatedUser.mockResolvedValue(
        {}
      );
      expect(await isRepoStarred('o', 'r')).toBe(true);
    });

    it('should return false if check starred fails', async () => {
      mockOctokit.activity.checkRepoIsStarredByAuthenticatedUser.mockRejectedValue(
        new Error('fail')
      );
      expect(await isRepoStarred('o', 'r')).toBe(false);
    });

    it('should check if watched', async () => {
      mockOctokit.activity.getRepoSubscription.mockResolvedValue({
        data: { subscribed: true },
      });
      expect(await isRepoWatched('o', 'r')).toBe(true);
    });

    it('should return false if check watched fails', async () => {
      mockOctokit.activity.getRepoSubscription.mockRejectedValue(
        new Error('fail')
      );
      expect(await isRepoWatched('o', 'r')).toBe(false);
    });

    it('should star repo', async () => {
      mockOctokit.activity.starRepoForAuthenticatedUser.mockResolvedValue({});
      await starRepo('o', 'r');
      expect(
        mockOctokit.activity.starRepoForAuthenticatedUser
      ).toHaveBeenCalled();
    });

    it('should watch repo', async () => {
      mockOctokit.activity.setRepoSubscription.mockResolvedValue({});
      await watchRepo('o', 'r');
      expect(mockOctokit.activity.setRepoSubscription).toHaveBeenCalledWith({
        owner: 'o',
        repo: 'r',
        subscribed: true,
      });
    });
  });

  describe('rulesets', () => {
    it('should get rulesets', async () => {
      mockOctokit.repos.getRepoRulesets.mockResolvedValue({
        data: [{ id: 1 }],
      });
      const result = await getRulesets('o', 'r');
      expect(result).toEqual([{ id: 1 }]);
    });

    it('should return empty array if getRulesets fails', async () => {
      mockOctokit.repos.getRepoRulesets.mockRejectedValue(new Error('fail'));
      const result = await getRulesets('o', 'r');
      expect(result).toEqual([]);
    });

    it('should get ruleset details', async () => {
      mockOctokit.repos.getRepoRuleset.mockResolvedValue({ data: { id: 1 } });
      const result = await getRulesetDetails('o', 'r', 1);
      expect(result).toEqual({ id: 1 });
    });

    it('should return null if getRulesetDetails fails', async () => {
      mockOctokit.repos.getRepoRuleset.mockRejectedValue(new Error('fail'));
      const result = await getRulesetDetails('o', 'r', 1);
      expect(result).toBeNull();
    });

    it('should create ruleset', async () => {
      mockOctokit.repos.createRepoRuleset.mockResolvedValue({});
      const ruleset: any = {
        name: 'rs',
        target: 'branch',
        enforcement: 'active',
        rules: [],
      };
      await createRuleset('o', 'r', ruleset);
      expect(mockOctokit.repos.createRepoRuleset).toHaveBeenCalled();
    });

    it('should update ruleset', async () => {
      mockOctokit.repos.updateRepoRuleset.mockResolvedValue({});
      const ruleset: any = { name: 'rs', enforcement: 'active' };
      await updateRuleset('o', 'r', 1, ruleset);
      expect(mockOctokit.repos.updateRepoRuleset).toHaveBeenCalled();
    });
  });
});
