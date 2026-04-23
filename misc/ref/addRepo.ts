import inquirer from 'inquirer';
import { parseGitHubUrl } from '../github';
import { standardizeRepo } from '../fixers/standardizer';
import { settings } from '../settings';

export async function addRepoCommand(): Promise<void> {
  console.log('\n🔄 Add Repo - Standardizing a new GitHub project\n');

  const { repoUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'repoUrl',
      message: 'Enter the GitHub repository URL:',
      validate: (input: string) => {
        if (!input) return 'URL is required';
        const parsed = parseGitHubUrl(input);
        if (!parsed) return 'Invalid GitHub URL (must be https://github.com/owner/repo)';
        return true;
      },
    },
  ]);

  const result = await standardizeRepo(repoUrl);

  console.log('\n' + '='.repeat(60));
  console.log(`📋 Add Repo Summary for ${result.repoName}`);
  console.log('='.repeat(60));

  if (result.changes.length > 0) {
    console.log('✅ Changes made:');
    result.changes.forEach(change => console.log(`   • ${change}`));
  }

  if (result.errors.length > 0) {
    console.log('\n⚠️  Issues encountered:');
    result.errors.forEach(err => console.log(`   • ${err}`));
  }

  console.log(`\n${result.success ? '🎉' : '⚠️'}  Standardization ${result.success ? 'completed successfully' : 'finished with issues'}`);
}