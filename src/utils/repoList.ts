import fs from 'fs/promises';
import { getReposListPath } from '../settings.js';

/**
 * Reads the repo list file and returns an array of repo names.
 * Lines starting with # are treated as comments and skipped.
 */
export async function readRepoList(): Promise<string[]> {
  const filePath = getReposListPath();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Adds or updates a repo name in the list file (alphabetically sorted).
 * Idempotent — if the name already exists, it won't be duplicated.
 */
export async function addOrUpdateRepoInList(repoName: string): Promise<void> {
  const filePath = getReposListPath();
  let repos = await readRepoList();

  // Remove existing entry if present (case-insensitive dedup)
  repos = repos.filter(name => name.toLowerCase() !== repoName.toLowerCase());

  // Add and sort alphabetically
  repos.push(repoName);
  repos.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const content = repos.join('\n') + '\n';
  await fs.writeFile(filePath, content, 'utf-8');
  console.log(`✅ Updated repo list with: ${repoName}`);
}
