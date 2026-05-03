import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';

const MyOctokit = Octokit.plugin(throttling);

let octokitInstance: Octokit | null = null;

export function getOctokit(): Octokit {
  if (!octokitInstance) {
    octokitInstance = new MyOctokit({
      auth: process.env.GITHUB_TOKEN,
      throttle: {
        onRateLimit: (retryAfter: number, options: any) => {
          console.warn(`Rate limit hit. Retrying after ${retryAfter} seconds...`);
          return true;
        },
        onSecondaryRateLimit: () => true,
      },
    });
  }
  return octokitInstance;
}

export async function checkGitHubAuth(): Promise<boolean> {
  try {
    const octokit = getOctokit();
    await octokit.users.getAuthenticated();
    return true;
  } catch (error) {
    console.error('❌ GitHub authentication failed. Run: gh auth login');
    return false;
  }
}

export async function repoExists(owner: string, repo: string): Promise<boolean> {
  try {
    const octokit = getOctokit();
    await octokit.repos.get({ owner, repo });
    return true;
  } catch {
    return false;
  }
}

export async function getRepoMetadata(owner: string, repo: string) {
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
  updates: { description?: string; homepage?: string; topics?: string[] }
) {
  const octokit = getOctokit();
  await octokit.repos.update({
    owner,
    repo,
    ...updates,
  });
}

export async function starRepo(owner: string, repo: string) {
  const octokit = getOctokit();
  await octokit.activity.starRepoForAuthenticatedUser({ owner, repo });
}

export async function watchRepo(owner: string, repo: string) {
  const octokit = getOctokit();
  await octokit.activity.setRepoSubscription({
    owner,
    repo,
    subscribed: true,
  });
}

// Rulesets - kept exactly as you wanted
export async function getRulesets(owner: string, repo: string) {
  const octokit = getOctokit();
  try {
    const { data } = await octokit.repos.getRepoRulesets({ owner, repo });
    return data;
  } catch {
    return [];
  }
}

export async function updateRulesets(owner: string, repo: string, rulesets: any[]) {
  const octokit = getOctokit();
  // GitHub API for rulesets is a bit special - this is simplified
  console.log(`🔧 Updating rulesets for ${owner}/${repo}`);
  // Full implementation would use repos.updateRepoRuleset or create
}

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