import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { Logger } from './utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Octokit singleton
// ─────────────────────────────────────────────────────────────────────────────

const MyOctokit = Octokit.plugin(throttling);

let octokitInstance: any = null;

export function getOctokit(): any {
  if (!octokitInstance) {
    octokitInstance = new MyOctokit({
      auth: process.env.GITHUB_TOKEN,
      throttle: {
        onRateLimit: (retryAfter: number, _options: object): boolean => {
          Logger.warn(
            `Rate limit hit. Retrying after ${retryAfter} seconds...`
          );
          return true;
        },
        onSecondaryRateLimit: (
          _retryAfter: number,
          _options: object
        ): boolean => true,
      },
    });
  }
  return octokitInstance;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

export async function checkGitHubAuth(): Promise<boolean> {
  try {
    const octokit = getOctokit();
    const { data } = await octokit.users.getAuthenticated();
    Logger.success(`GitHub authenticated as: ${data.login}`);
    return true;
  } catch {
    Logger.error('GitHub authentication failed.');
    Logger.log('   Set GITHUB_TOKEN env var or run: gh auth login');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository checks
// ─────────────────────────────────────────────────────────────────────────────

export async function repoExists(
  owner: string,
  repo: string
): Promise<boolean> {
  try {
    const octokit = getOctokit();
    await octokit.repos.get({ owner, repo });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a repository is empty (no commits).
 */
export async function isRepoEmpty(
  owner: string,
  repo: string
): Promise<boolean> {
  try {
    const octokit = getOctokit();
    // If listCommits fails with 409, the repo is empty
    await octokit.repos.listCommits({
      owner,
      repo,
      per_page: 1,
    });
    return false;
  } catch (err: any) {
    // 409 Conflict is returned by GitHub API when the repository is empty
    if (err.status === 409 || err.status === 404) {
      return true;
    }
    // If it's some other error, we assume it's not empty or we can't tell, 
    // but for safety in this flow, we'll treat it as empty if we can't get commits.
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

export interface RepoMetadata {
  description: string;
  homepage: string;
  topics: string[];
  defaultBranch: string;
}

export async function getRepoMetadata(
  owner: string,
  repo: string
): Promise<RepoMetadata> {
  const octokit = getOctokit();
  const { data } = await octokit.repos.get({ owner, repo });
  return {
    description: data.description || '',
    homepage: data.homepage || '',
    topics: data.topics || [],
    defaultBranch: data.default_branch,
  };
}

export async function updateRepoMetadata(
  owner: string,
  repo: string,
  updates: { description?: string; homepage?: string }
): Promise<void> {
  const octokit = getOctokit();
  await octokit.repos.update({ owner, repo, ...updates });
}

/**
 * Replaces all topics for a repository.
 */
export async function replaceTopics(
  owner: string,
  repo: string,
  topics: string[]
): Promise<void> {
  const octokit = getOctokit();
  await octokit.repos.replaceAllTopics({ owner, repo, names: topics });
}

// ─────────────────────────────────────────────────────────────────────────────
// Star & Watch
// ─────────────────────────────────────────────────────────────────────────────

export async function isRepoStarred(owner: string, repo: string): Promise<boolean> {
  const octokit = getOctokit();
  try {
    await octokit.activity.checkRepoIsStarredByAuthenticatedUser({ owner, repo });
    return true;
  } catch {
    return false;
  }
}

export async function isRepoWatched(owner: string, repo: string): Promise<boolean> {
  const octokit = getOctokit();
  try {
    const { data } = await octokit.activity.getRepoSubscription({ owner, repo });
    return data.subscribed;
  } catch {
    return false;
  }
}

export async function starRepo(owner: string, repo: string): Promise<void> {
  const octokit = getOctokit();
  await octokit.activity.starRepoForAuthenticatedUser({ owner, repo });
}

export async function watchRepo(owner: string, repo: string): Promise<void> {
  const octokit = getOctokit();
  await octokit.activity.setRepoSubscription({ owner, repo, subscribed: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Rulesets
// ─────────────────────────────────────────────────────────────────────────────

export interface RulesetData {
  id?: number;
  name: string;
  target: string;
  enforcement: string;
  conditions: Record<string, unknown>;
  bypass_actors: unknown[];
  rules: any[];
}

export async function getRulesets(
  owner: string,
  repo: string
): Promise<RulesetData[]> {
  const octokit = getOctokit();
  try {
    const { data } = await octokit.repos.getRepoRulesets({ owner, repo });
    return data as unknown as RulesetData[];
  } catch {
    return [];
  }
}

export async function getRulesetDetails(
  owner: string,
  repo: string,
  rulesetId: number
): Promise<RulesetData | null> {
  const octokit = getOctokit();
  try {
    const { data } = await octokit.repos.getRepoRuleset({
      owner,
      repo,
      ruleset_id: rulesetId,
    });
    return data as unknown as RulesetData;
  } catch {
    return null;
  }
}

export async function createRuleset(
  owner: string,
  repo: string,
  ruleset: RulesetData
): Promise<void> {
  const octokit = getOctokit();
  await octokit.repos.createRepoRuleset({
    owner,
    repo,
    name: ruleset.name,
    target: ruleset.target as 'branch' | 'tag',
    enforcement: ruleset.enforcement as 'active' | 'disabled' | 'evaluate',
    conditions: ruleset.conditions,
    bypass_actors: ruleset.bypass_actors as any,
    rules: ruleset.rules as any,
  });
}

export async function updateRuleset(
  owner: string,
  repo: string,
  rulesetId: number,
  ruleset: RulesetData
): Promise<void> {
  const octokit = getOctokit();
  await octokit.repos.updateRepoRuleset({
    owner,
    repo,
    ruleset_id: rulesetId,
    name: ruleset.name,
    enforcement: ruleset.enforcement as 'active' | 'disabled' | 'evaluate',
    conditions: ruleset.conditions,
    bypass_actors: ruleset.bypass_actors as any,
    rules: ruleset.rules as any,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// URL parsing
// ─────────────────────────────────────────────────────────────────────────────

export function parseGitHubUrl(
  url: string
): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/]+)/);
  if (!match) return null;
  const owner = match[1];
  let repo = match[2];

  if (repo.endsWith('.git')) {
    repo = repo.slice(0, -4);
  }

  // Remove trailing slashes or anchors
  repo = repo.split(/[?#]/)[0].replace(/\/$/, '');

  return { owner, repo };
}
