import { select } from './utils/prompts.js';
import { addRepoCommand } from './commands/addRepo.js';
import { syncRepoCommand } from './commands/syncRepo.js';
import { scanReposCommand } from './commands/scanRepos.js';
import { scanRepoCommand } from './commands/scanRepo.js';

let lastScannedRepo: { name: string; url: string } | null = null;

export async function showMainMenu(): Promise<void> {
  console.log('\n=== Repos Maintainer ===\n');

  const choices = [
    {
      name: '🔄 Add Repo          - Add and fully standardize a new GitHub repository',
      value: 'add',
    },
    {
      name: '🔁 Sync Repo         - Sync the project and fix whatever can automatically',
      value: 'sync-repo',
    },
    {
      name: '🔎 Scan Repo         - Scan a repository and generate a report',
      value: 'scan',
    },
  ];

  if (lastScannedRepo) {
    choices.push({
      name: `🔎 Rescan Repo       - Rescan ${lastScannedRepo.name}`,
      value: 'rescan',
    });
  }

  choices.push(
    {
      name: '🔎 Scan Repos        - Scan all repositories in projects folder',
      value: 'sync',
    },
    { name: '🚪 Exit', value: 'exit' }
  );

  const action = await select({
    message: 'Select a script to run (ESC to exit):',
    choices,
  });

  switch (action) {
    case 'add': {
      const added = await addRepoCommand();
      if (added) {
        lastScannedRepo = added;
        // Automatically rescan after add
        await scanRepoCommand(added);
      }
      break;
    }
    case 'sync-repo': {
      const synced = await syncRepoCommand();
      if (synced) {
        lastScannedRepo = synced;
        // Automatically rescan after sync
        await scanRepoCommand(synced);
      }
      break;
    }
    case 'scan': {
      const scanned = await scanRepoCommand();
      if (scanned) {
        lastScannedRepo = scanned;
      }
      break;
    }
    case 'rescan':
      if (lastScannedRepo) {
        await scanRepoCommand(lastScannedRepo);
      }
      break;
    case 'sync':
      await scanReposCommand();
      break;
    case 'exit':
      console.log('\n👋 Goodbye!');
      process.exit(0);
  }

  // Loop back to menu after command finishes
  await showMainMenu();
}
