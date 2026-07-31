import fs from 'fs/promises';
import { getReposListPath, getLocalRepoPath } from '../settings.js';
import { Logger } from './logger.js';
import { listUserRepos } from '../github.js';
import {
  ensureRepoCloned,
  pullLatestForRepo,
  PullSkipReason,
} from './git.js';

export interface RepoEntry {
  name: string;
  url: string;
  type?: string;
  purpose?: 'personal' | 'training';
  structure?: 'single' | 'multi';
}

export interface RepoSyncResult {
  name: string;
  pulled: boolean;
  skippedReason?: PullSkipReason;
  error?: string;
}

export interface SyncSummary {
  results: RepoSyncResult[];
  pulled: number;
  upToDate: number;
  skippedDirty: number;
  errors: number;
}

/**
 * Reads the repo list file and returns an array of repo entries.
 */
export async function readRepoList(): Promise<RepoEntry[]> {
  const filePath = getReposListPath();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

/**
 * Adds or updates a repo entry in the list file (alphabetically sorted).
 * Idempotent — if the name already exists, it will be updated with the new URL.
 */
export async function addOrUpdateRepoInList(
  repoName: string,
  repoUrl: string,
  purpose?: 'personal' | 'training',
  structure?: 'single' | 'multi'
): Promise<void> {
  const filePath = getReposListPath();
  const entries = await readRepoList();

  const index = entries.findIndex(
    (e) => e.name.toLowerCase() === repoName.toLowerCase()
  );

  if (index !== -1) {
    entries[index].url = repoUrl;
    if (purpose) entries[index].purpose = purpose;
    if (structure) entries[index].structure = structure;
    // Preserve existing name casing and type
  } else {
    entries.push({
      name: repoName,
      url: repoUrl,
      type: 'active',
      purpose: purpose || 'personal',
      structure: structure || 'single',
    });
  }

  // Sort alphabetically by name
  entries.sort((a, b) => a.name.localeCompare(b.name));

  await fs.writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8');
  Logger.success('Updated repo list with: ' + repoName);
}

/**
 * Ensures all repos from GitHub are in project-repos-names.json and cloned locally.
 */
export async function ensureAllReposArePresent(): Promise<void> {
  Logger.setContext('EnsureRepos');
  Logger.log('Ensuring all GitHub repos are present locally...');

  // 1. Fetch all repos from GitHub
  const githubRepos = await listUserRepos();
  Logger.log('Found ' + githubRepos.length + ' repos on GitHub');

  // 2. Read existing repo list
  const repoList = await readRepoList();
  const existingRepoNames = new Set(repoList.map((r) => r.name.toLowerCase()));
  Logger.log('Found ' + repoList.length + ' repos in project-repos-names.json');

  // 3. Check and add missing repos to list, and clone them
  let addedCount = 0;
  for (const githubRepo of githubRepos) {
    if (!existingRepoNames.has(githubRepo.name.toLowerCase())) {
      Logger.log('Adding missing repo to list: ' + githubRepo.name);
      await addOrUpdateRepoInList(githubRepo.name, githubRepo.html_url);
      addedCount++;
    }

    // 4. Ensure repo is cloned locally
    await ensureRepoCloned(githubRepo.html_url, githubRepo.name);
  }

  Logger.success(
    'All GitHub repos are present! Added ' + addedCount + ' new repos!'
  );
}

/**
 * Pull-only orchestrator for the nightly sync: reads the local repo list and
 * pulls latest for each already-cloned repo via the shared `pullLatestForRepo`.
 * Does not clone missing repos, add to the list, scan, or fix — it only pulls.
 * Returns a per-repo summary so callers can build a report.
 */
export async function syncAllRepos(): Promise<SyncSummary> {
  Logger.setContext('SyncRepos');
  Logger.log('Pulling latest for all repos in the list...');

  const repoList = await readRepoList();
  Logger.log('Found ' + repoList.length + ' repos in the list');

  const results: RepoSyncResult[] = [];

  for (const entry of repoList) {
    const localPath = getLocalRepoPath(entry.name);

    let cloned = true;
    try {
      await fs.access(localPath);
    } catch {
      cloned = false;
    }

    if (!cloned) {
      Logger.warn(
        `Skipping ${entry.name} — not cloned locally at ${localPath}`
      );
      results.push({
        name: entry.name,
        pulled: false,
        error: 'not cloned locally',
      });
      continue;
    }

    try {
      const result = await pullLatestForRepo(localPath, entry.name);
      results.push({
        name: entry.name,
        pulled: result.pulled,
        skippedReason: result.skippedReason,
      });
    } catch (err) {
      Logger.error(`Failed to pull ${entry.name}`, err);
      results.push({
        name: entry.name,
        pulled: false,
        error: (err as Error).message,
      });
    }
  }

  const summary: SyncSummary = {
    results,
    pulled: results.filter((r) => r.pulled).length,
    upToDate: results.filter((r) => r.skippedReason === 'up-to-date').length,
    skippedDirty: results.filter((r) => r.skippedReason === 'dirty').length,
    errors: results.filter((r) => r.error).length,
  };

  Logger.success(
    `Sync complete: ${summary.pulled} pulled, ${summary.upToDate} up to date, ` +
      `${summary.skippedDirty} skipped (uncommitted), ${summary.errors} errors`
  );

  return summary;
}
