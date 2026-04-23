import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';

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
          console.warn(`⏳ Rate limit hit. Retrying after ${retryAfter} seconds...`);
          return true;
        },
        onSecondaryRateLimit: (_retryAfter: number, _options: object): boolean => true,
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
    console.log(`✅ GitHub authenticated as: ${data.login}`);
    return true;
  } catch {
    console.error('❌ GitHub authentication failed.');
    console.error('   Set GITHUB_TOKEN env var or run: gh auth login');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository checks
// ─────────────────────────────────────────────────────────────────────────────

export async function repoExists(owner: string, repo: string): Promise<boolean> {
  try {
    const octokit = getOctokit();
    await octokit.repos.get({ owner, repo });
    return true;
  } catch {
    return false;
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

export async function getRepoMetadata(owner: string, repo: string): Promise<RepoMetadata> {
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
  updates: { description?: string; homepage?: string },
): Promise<void> {
  const octokit = getOctokit();
  await octokit.repos.update({ owner, repo, ...updates });
}

export async function replaceTopics(
  owner: string,
  repo: string,
  topics: string[],
): Promise<void> {
  const octokit = getOctokit();
  await octokit.repos.replaceAllTopics({ owner, repo, names: topics });
}

// ─────────────────────────────────────────────────────────────────────────────
// Star & Watch
// ─────────────────────────────────────────────────────────────────────────────

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

export async function getRulesets(owner: string, repo: string): Promise<RulesetData[]> {
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
  rulesetId: number,
): Promise<RulesetData | null> {
  const octokit = getOctokit();
  try {
    const { data } = await octokit.repos.getRepoRuleset({ owner, repo, ruleset_id: rulesetId });
    return data as unknown as RulesetData;
  } catch {
    return null;
  }
}

export async function createRuleset(
  owner: string,
  repo: string,
  ruleset: RulesetData,
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
  ruleset: RulesetData,
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

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace('.git', '') };
}
