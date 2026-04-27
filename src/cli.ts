import { select } from './utils/prompts.js';
import { addRepoCommand } from './commands/addRepo.js';
import { scanReposCommand } from './commands/scanRepos.js';
import { scanRepoCommand } from './commands/scanRepo.js';

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
        name: '🔎 Scan Repo         - Scan a repository and generate a report',
        value: 'scan',
      },
      {
        name: '🔎 Scan Repos        - Scan all repositories in projects folder',
        value: 'sync',
      },
      { name: '🚪 Exit', value: 'exit' },
    ],
  });

  switch (action) {
    case 'add':
      await addRepoCommand();
      break;
    case 'scan':
      await scanRepoCommand();
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
