import fs from 'fs/promises';
import { getReposListPath } from '../settings.js';
import { Logger } from './logger.js';

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
 * Adds or updates a repo entry in the list file (alphabetically sorted).
 * Format: "repo-name: repo-url"
 * Idempotent — if the name already exists, it will be updated with the new URL.
 */
export async function addOrUpdateRepoInList(
  repoName: string,
  repoUrl: string
): Promise<void> {
  const filePath = getReposListPath();
  const rawEntries = await readRepoList();

  // Parse entries into map to easily update/dedup
  const repoMap = new Map<string, string>();
  for (const entry of rawEntries) {
    if (entry.includes(':')) {
      const [name, ...urlParts] = entry.split(':');
      repoMap.set(name.trim().toLowerCase(), urlParts.join(':').trim());
    } else {
      // Fallback for legacy entries without URL
      repoMap.set(entry.trim().toLowerCase(), '');
    }
  }

  // Add/Update current repo
  repoMap.set(repoName.toLowerCase(), repoUrl);

  // Convert back to array and sort alphabetically by name
  const sortedNames = Array.from(repoMap.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  const newEntries = sortedNames.map((name) => {
    const url = repoMap.get(name);
    // Find original casing if possible, or use current repoName if it matches
    const displayName = name === repoName.toLowerCase() ? repoName : name;
    return url ? `${displayName}: ${url}` : displayName;
  });

  const content = newEntries.join('\n') + '\n';
  await fs.writeFile(filePath, content, 'utf-8');
  Logger.success(`Updated repo list with: ${repoName}`);
}
