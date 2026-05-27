import { readRepoList } from './repoList.js';
import { Logger } from './logger.js';
import { SearchableSelect } from './searchableSelect.js';

export interface SelectedRepo {
  name: string;
  url: string;
  type?: string;
  purpose?: 'personal' | 'training';
  structure?: 'single' | 'multi';
}

/**
 * Prompts the user to select a repository from the list.
 * Uses a searchable dropdown selection.
 */
export async function selectRepo(): Promise<SelectedRepo | null> {
  const repoList = await readRepoList();
  if (repoList.length === 0) {
    Logger.error('No repos found in the list. Please add a repo first.');
    return null;
  }

  try {
    const prompt = new SearchableSelect({
      name: 'repo',
      message: 'Select a project to scan/sync (ESC to cancel):',
      choices: repoList.map((repo) => ({
        name: repo.name,
        value: repo.name,
      })),
      limit: 15,
    });

    const selectedName = await prompt.run();
    const entry = repoList.find((s) => s.name === selectedName);

    if (entry) {
      return {
        name: entry.name,
        url: entry.url,
        type: entry.type,
        purpose: entry.purpose,
        structure: entry.structure,
      };
    }
  } catch (_e) {
    // User pressed ESC or interrupted
    return null;
  }

  return null;
}
