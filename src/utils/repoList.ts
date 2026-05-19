import fs from 'fs/promises';
import { getReposListPath } from '../settings.js';
import { Logger } from './logger.js';

export interface RepoEntry {
  name: string;
  url: string;
  type?: string;
  purpose?: 'personal' | 'training';
  structure?: 'single' | 'multi';
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
  Logger.success(`Updated repo list with: ${repoName}`);
}
