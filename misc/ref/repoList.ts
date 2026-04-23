import fs from 'fs/promises';
import path from 'path';
import { getReposListPath } from '../settings';

export async function readRepoList(): Promise<string[]> {
  const filePath = getReposListPath();
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

export async function addOrUpdateRepoInList(repoName: string, repoUrl: string): Promise<void> {
  const filePath = getReposListPath();
  let repos = await readRepoList();

  // Remove existing entry if present
  repos = repos.filter(name => name.toLowerCase() !== repoName.toLowerCase());

  // Add new one
  repos.push(repoName);
  repos.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const content = `# Repos Maintainer List - Automatically sorted\n` +
                 repos.map(name => `${name} ${repoUrl}`).join('\n');

  await fs.writeFile(filePath, content + '\n', 'utf-8');
  console.log(`✅ Updated repo list with ${repoName}`);
}