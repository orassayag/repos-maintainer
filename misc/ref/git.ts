import simpleGit from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import { getLocalRepoPath } from '../settings';

const git = simpleGit();

export async function ensureRepoCloned(repoUrl: string, repoName: string): Promise<boolean> {
  const localPath = getLocalRepoPath(repoName);

  try {
    await fs.access(localPath);
    // Folder exists - verify remote
    const repoGit = simpleGit(localPath);
    const remotes = await repoGit.getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin');

    if (origin && origin.refs.fetch.includes(repoName)) {
      console.log(`✅ Repo already cloned: ${repoName}`);
      await repoGit.pull('origin', 'main').catch(() => repoGit.pull('origin', 'master'));
      return true;
    } else {
      console.warn(`⚠️  Local folder exists but remote mismatch: ${repoName}`);
      return false;
    }
  } catch {
    // Folder doesn't exist → clone
    console.log(`📥 Cloning ${repoUrl}...`);
    await git.clone(repoUrl, localPath);
    console.log(`✅ Cloned ${repoName}`);
    return true;
  }
}

export async function runGitClean(repoPath: string): Promise<void> {
  const gitInstance = simpleGit(repoPath);
  console.log(`🧹 Running git clean on ${path.basename(repoPath)}...`);
  await gitInstance.gc({ aggressive: true, prune: true });
  await gitInstance.raw(['reflog', 'expire', '--expire=now', '--all']);
  await gitInstance.gc({ prune: true });
  console.log(`✅ Git clean completed`);
}