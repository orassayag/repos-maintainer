import { input } from '../utils/prompts.js';
import { parseGitHubUrl, repoExists } from '../github.js';
import { standardizeRepo } from '../fixers/standardizer.js';
import { Logger } from '../utils/logger.js';

/**
 * Interactive "Add Repo" command.
 * Prompts for a GitHub URL, validates it, verifies the repo exists,
 * then runs full standardization.
 */
export async function addRepoCommand(): Promise<void> {
  Logger.log('\n🔄 Add Repo — Add and fully standardize a new GitHub repository\n');

  const repoUrl = await input({
    message: 'Enter the GitHub repository URL:',
    validate: (value: string): string | boolean => {
      if (!value.trim()) return 'URL is required';
      const parsed = parseGitHubUrl(value.trim());
      if (!parsed) return 'Invalid GitHub URL (expected: https://github.com/owner/repo)';
      return true;
    },
  });

  const parsed = parseGitHubUrl(repoUrl.trim())!;

  // Verify the repo exists on GitHub
  Logger.log(`\n🔍 Checking if ${parsed.owner}/${parsed.repo} exists on GitHub...`);
  const exists = await repoExists(parsed.owner, parsed.repo);
  if (!exists) {
    Logger.error(`Repository not found: ${parsed.owner}/${parsed.repo}`);
    Logger.log('   Please check the URL and try again.\n');
    return;
  }
  Logger.success(`Repository found: ${parsed.owner}/${parsed.repo}\n`);

  // Run full standardization
  const result = await standardizeRepo(repoUrl.trim());

  // ── Summary ────────────────────────────────────────────────────────────
  const line = '═'.repeat(60);
  Logger.log('\n' + line);
  Logger.log(`📋 Add Repo Summary: ${result.repoName}`);
  Logger.log(line);

  if (result.changes.length > 0) {
    Logger.log('\n✅ Changes made:');
    result.changes.forEach(change => Logger.log(`   • ${change}`));
  }

  if (result.errors.length > 0) {
    Logger.log('\n⚠️  Issues encountered:');
    result.errors.forEach(err => Logger.log(`   • ${err}`));
  }

  const icon = result.success ? '🎉' : '⚠️';
  Logger.log(`\n${icon} Standardization ${result.success ? 'completed successfully' : 'finished with issues'}`);
  Logger.log(line + '\n');
}
