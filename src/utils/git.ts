import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import { getLocalRepoPath } from '../settings.js';
import { Logger } from './logger.js';

export type PullSkipReason = 'clean' | 'dirty' | 'up-to-date' | 'mismatch';

export interface PullResult {
  pulled: boolean;
  skippedReason?: PullSkipReason;
}

/**
 * Resolves the checked-out branch of an existing repo.
 * Falls back to `main` (then callers fall back to `master`) only when the
 * branch can't be read — e.g. a detached HEAD.
 */
async function resolveCurrentBranch(repoGit: SimpleGit): Promise<string> {
  try {
    const branch = (
      await repoGit.revparse(['--abbrev-ref', 'HEAD'])
    ).trim();
    if (branch && branch !== 'HEAD') {
      return branch;
    }
  } catch {
    // Unreadable HEAD — fall through to the main/master last resort.
  }
  return 'main';
}

/**
 * Number of commits the local branch is behind its remote tracking branch.
 * A value of 0 means a pull would be a no-op.
 */
async function countCommitsBehind(
  repoGit: SimpleGit,
  branch: string
): Promise<number> {
  const output = await repoGit.raw([
    'rev-list',
    '--count',
    `HEAD..origin/${branch}`,
  ]);
  return parseInt(output.trim(), 10) || 0;
}

/**
 * Pulls the latest commits for an already-cloned repo — but only when a pull is
 * actually needed. Skips when: origin doesn't match the expected repo, the
 * working tree is dirty, or the branch is already up to date with its remote.
 * The single pull implementation shared by the weekly scan and the nightly sync.
 * Throws on unexpected git failures so callers can report them per-repo.
 */
export async function pullLatestForRepo(
  localPath: string,
  repoName: string
): Promise<PullResult> {
  const repoGit: SimpleGit = simpleGit(localPath);

  const remotes = await repoGit.getRemotes(true);
  const origin = remotes.find((r) => r.name === 'origin');
  if (!origin) {
    Logger.warn(`No 'origin' remote found in: ${repoName}`);
    return { pulled: false, skippedReason: 'mismatch' };
  }

  const normalizeUrl = (url: string): string =>
    url.replace(/\.git$/, '').toLowerCase();
  if (!normalizeUrl(origin.refs.fetch).includes(repoName.toLowerCase())) {
    Logger.warn(`Remote mismatch for ${repoName}:`);
    Logger.log(`   Expected URL containing: ${repoName}`);
    Logger.log(`   Found: ${origin.refs.fetch}`);
    return { pulled: false, skippedReason: 'mismatch' };
  }

  const status = await repoGit.status();
  if (status.files.length > 0) {
    Logger.warn(
      `Skipping pull for ${repoName} — uncommitted changes detected!`
    );
    return { pulled: false, skippedReason: 'dirty' };
  }

  const branch = await resolveCurrentBranch(repoGit);
  await repoGit.fetch('origin', branch);

  const behindCount = await countCommitsBehind(repoGit, branch);
  if (behindCount === 0) {
    Logger.log(`✅ ${repoName} already up to date — skipping pull`);
    return { pulled: false, skippedReason: 'up-to-date' };
  }

  Logger.log(
    `📥 Pulling latest for ${repoName} (${behindCount} commit(s) behind)...`
  );
  await repoGit.pull('origin', branch, { '--rebase': null });
  return { pulled: true };
}

/**
 * Ensures a repo is cloned locally and up-to-date.
 * - If the folder doesn't exist → clone
 * - If the folder exists → delegate to `pullLatestForRepo` (verify remote,
 *   skip when dirty/up-to-date, pull when behind)
 * Returns true on success, false on remote mismatch.
 */
export async function ensureRepoCloned(
  repoUrl: string,
  repoName: string
): Promise<boolean> {
  const localPath = getLocalRepoPath(repoName);

  let folderExists = false;
  try {
    await fs.access(localPath);
    folderExists = true;
  } catch {
    folderExists = false;
  }

  if (!folderExists) {
    Logger.log(`📥 Cloning ${repoUrl}...`);
    const git: SimpleGit = simpleGit();
    await git.clone(repoUrl, localPath);
    Logger.success(`Cloned ${repoName}`);
    return true;
  }

  try {
    const result = await pullLatestForRepo(localPath, repoName);
    return result.skippedReason !== 'mismatch';
  } catch (err) {
    Logger.warn(`Pull failed for ${repoName}: ${(err as Error).message}`);
    return true;
  }
}

/**
 * Commits all local changes and pushes to origin.
 */
export async function commitAndPush(
  repoPath: string,
  message: string = 'chore(maintainer): standardize repository structure',
  force: boolean = false
): Promise<boolean> {
  const repoGit: SimpleGit = simpleGit(repoPath);

  try {
    const status = await repoGit.status();
    if (status.files.length === 0) {
      return false; // nothing to commit
    }

    await repoGit.add('.');
    await repoGit.commit(message);
    Logger.log(`📝 Committed: ${message}`);

    if (force) {
      await repoGit.push('origin', undefined, { '--force-with-lease': null });
      Logger.log(`🚀 Pushed (force-with-lease) to origin`);
    } else {
      await repoGit.push('origin');
      Logger.log(`🚀 Pushed to origin`);
    }

    return true;
  } catch (err) {
    Logger.error(
      `Commit/push failed for ${path.basename(repoPath)}: ${(err as Error).message}`
    );
    return false;
  }
}

/**
 * Runs aggressive git garbage collection to reduce .git size.
 * Only runs when explicitly enabled.
 */
export async function runGitClean(repoPath: string): Promise<void> {
  const gitInstance: SimpleGit = simpleGit(repoPath);
  const name = path.basename(repoPath);
  Logger.log(`🧹 Running git clean on ${name}...`);

  await gitInstance.raw(['gc', '--aggressive', '--prune=now']);
  await gitInstance.raw(['reflog', 'expire', '--expire=now', '--all']);
  await gitInstance.raw(['gc', '--prune=now']);

  Logger.success(`Git clean completed for ${name}`);
}
