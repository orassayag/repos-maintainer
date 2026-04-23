import inquirer from 'inquirer';
import { addRepoCommand } from './commands/addRepo';
import { reposSyncCommand } from './commands/reposSync';

export async function showMainMenu(): Promise<void> {
  console.log('\n=== Repos Maintainer ===\n');

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Select a script to run (ESC to exit):',
      choices: [
        { name: '🔄 Add Repo          - Add the initial features missing for a GitHub project', value: 'add' },
        { name: '♻️  Repos Sync        - Syncs and standardizes all the repos', value: 'sync' },
        { name: '🚪 Exit', value: 'exit' },
      ],
    },
  ]);

  switch (action) {
    case 'add':
      await addRepoCommand();
      break;
    case 'sync':
      await reposSyncCommand();
      break;
    case 'exit':
      console.log('👋 Goodbye!');
      process.exit(0);
  }

  // Ask again after command finishes (loop until exit)
  await showMainMenu();
}