import simpleGit, { SimpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import { getLocalRepoPath } from '../settings.js';

/**
 * Ensures a repo is cloned locally and up-to-date.
 * - If the folder doesn't exist → clone
 * - If the folder exists → verify remote matches, then pull
 * Returns true on success, false on remote mismatch or failure.
 */
export async function ensureRepoCloned(repoUrl: string, repoName: string): Promise<boolean> {
  const localPath = getLocalRepoPath(repoName);

  try {
    await fs.access(localPath);

    // Folder exists — verify remote
    const repoGit: SimpleGit = simpleGit(localPath);
    const remotes = await repoGit.getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin');

    if (!origin) {
      console.warn(`⚠️  No 'origin' remote found in: ${repoName}`);
      return false;
    }

    // Verify the remote URL contains the expected repo name
    const normalizeUrl = (url: string): string => url.replace(/\.git$/, '').toLowerCase();
    if (!normalizeUrl(origin.refs.fetch).includes(repoName.toLowerCase())) {
      console.warn(`⚠️  Remote mismatch for ${repoName}:`);
      console.warn(`   Expected URL containing: ${repoName}`);
      console.warn(`   Found: ${origin.refs.fetch}`);
      return false;
    }

    console.log(`📥 Pulling latest for ${repoName}...`);
    try {
      await repoGit.pull('origin', 'main', { '--rebase': null });
    } catch {
      // main branch might not exist, try master
      try {
        await repoGit.pull('origin', 'master', { '--rebase': null });
      } catch {
        console.warn(`⚠️  Pull failed for ${repoName} (may have uncommitted changes)`);
      }
    }
    return true;
  } catch {
    // Folder doesn't exist → clone
    console.log(`📥 Cloning ${repoUrl}...`);
    const git: SimpleGit = simpleGit();
    await git.clone(repoUrl, localPath);
    console.log(`✅ Cloned ${repoName}`);
    return true;
  }
}

/**
 * Commits all local changes with the conventional commit message
 * and pushes to origin.
 */
export async function commitAndPush(repoPath: string): Promise<boolean> {
  const repoGit: SimpleGit = simpleGit(repoPath);

  try {
    const status = await repoGit.status();
    if (status.files.length === 0) {
      return false; // nothing to commit
    }

    await repoGit.add('.');
    await repoGit.commit('chore(maintainer): standardize repository structure');
    console.log(`📝 Committed changes in ${path.basename(repoPath)}`);

    await repoGit.push('origin');
    console.log(`🚀 Pushed changes for ${path.basename(repoPath)}`);
    return true;
  } catch (err) {
    console.warn(`⚠️  Commit/push failed for ${path.basename(repoPath)}: ${(err as Error).message}`);
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
  console.log(`🧹 Running git clean on ${name}...`);

  await gitInstance.raw(['gc', '--aggressive', '--prune=now']);
  await gitInstance.raw(['reflog', 'expire', '--expire=now', '--all']);
  await gitInstance.raw(['gc', '--prune=now']);

  console.log(`✅ Git clean completed for ${name}`);
}
