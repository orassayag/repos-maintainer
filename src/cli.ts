import { select } from './utils/prompts.js';
import { addRepoCommand } from './commands/addRepo.js';
import { reposSyncCommand } from './commands/reposSync.js';

export async function showMainMenu(): Promise<void> {
  console.log('\n=== Repos Maintainer ===\n');

  const action = await select({
    message: 'Select a script to run (ESC to exit):',
    choices: [
      {
        name: '🔄 Add Repo          - Add and fully standardize a new GitHub repository',
        value: 'add',
      },
      {
        name: '♻️  Repos Sync        - Scan, update and clean all repositories (crawler)',
        value: 'sync',
      },
      { name: '🚪 Exit', value: 'exit' },
    ],
  });

  switch (action) {
    case 'add':
      await addRepoCommand();
      break;
    case 'sync':
      await reposSyncCommand();
      break;
    case 'exit':
      console.log('\n👋 Goodbye!');
      process.exit(0);
  }

  // Loop back to menu after command finishes
  await showMainMenu();
}
