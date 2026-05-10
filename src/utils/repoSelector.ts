import Enquirer from 'enquirer';
import { input } from './prompts.js';
import { readRepoList } from './repoList.js';
import { Logger } from './logger.js';
import { parseGitHubUrl } from '../github.js';

export interface SelectedRepo {
  name: string;
  url: string;
}

/**
 * Prompts the user to select a repository from the list.
 * Supports exact name/URL match and fuzzy search suggestions.
 */
export async function selectRepo(): Promise<SelectedRepo | null> {
  const repoList = await readRepoList();
  if (repoList.length === 0) {
    Logger.error('No repos found in the list. Please add a repo first.');
    return null;
  }

  let selectedRepo: SelectedRepo | null = null;

  while (!selectedRepo) {
    const repoNameOrUrl = await input({
      message: 'Enter the repo name or the repo URL:',
      validate: (val): string | boolean =>
        val.trim() ? true : 'Repo name or URL is required',
    });

    // Try exact match
    const parsedInput = parseGitHubUrl(repoNameOrUrl);
    const inputName = parsedInput
      ? parsedInput.repo
      : repoNameOrUrl.toLowerCase();

    for (const entry of repoList) {
      const [name, url] = entry.includes(':')
        ? entry.split(':').map((s) => s.trim())
        : [entry.trim(), ''];

      if (name.toLowerCase() === inputName || url === repoNameOrUrl) {
        selectedRepo = { name, url };
        break;
      }
    }

    if (!selectedRepo) {
      // Try similar match (fuzzy)
      const suggestions = repoList.filter((entry) => {
        const name = entry.includes(':')
          ? entry.split(':')[0].trim()
          : entry.trim();
        return name.toLowerCase().includes(inputName);
      });

      if (suggestions.length > 0) {
        try {
          const { AutoComplete } = Enquirer as any;
          const prompt = new AutoComplete({
            name: 'repo',
            message: 'Repo not found. Did you mean one of these?',
            choices: suggestions.map((s) =>
              s.includes(':') ? s.split(':')[0].trim() : s.trim()
            ),
          });

          const selectedName = (await prompt.run()) as string;
          const entry = repoList.find(
            (s) =>
              (s.includes(':') ? s.split(':')[0].trim() : s.trim()) ===
              selectedName
          );
          if (entry) {
            const [name, url] = entry.includes(':')
              ? entry.split(':').map((s) => s.trim())
              : [entry.trim(), ''];
            selectedRepo = { name, url };
          }
        } catch (_e) {
          // User might have escaped AutoComplete, loop will continue to ask input
        }
      }
    }

    if (!selectedRepo) {
      Logger.error('Repo not found in the list. Please try again.');
    }
  }

  return selectedRepo;
}
