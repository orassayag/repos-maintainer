import { checkGitHubAuth } from './github';
import { showMainMenu } from './cli';
import { settings } from './settings';
import fs from 'fs/promises';
import path from 'path';

async function preFlightValidation(): Promise<boolean> {
  console.log('🔍 Running pre-flight validations...\n');

  // 1. Projects root
  try {
    await fs.access(settings.PROJECTS_ROOT);
    const entries = await fs.readdir(settings.PROJECTS_ROOT);
    if (entries.length === 0) {
      throw new Error('Projects directory is empty');
    }
  } catch (err) {
    console.error(`❌ Projects root not found or empty: ${settings.PROJECTS_ROOT}`);
    console.error('   Make sure the directory exists and contains your repos.');
    return false;
  }

  // 2. Repos list file
  const listPath = path.join(settings.PROJECTS_ROOT, settings.REPOS_LIST_FILE);
  try {
    await fs.access(listPath);
  } catch {
    console.error(`❌ Repos list file not found: ${listPath}`);
    return false;
  }

  // 3. GitHub auth
  const isAuthValid = await checkGitHubAuth();
  if (!isAuthValid) {
    return false;
  }

  console.log('✅ All pre-flight checks passed!\n');
  return true;
}

async function main() {
  console.log('🚀 Repos Maintainer starting...\n');

  const args = process.argv.slice(2);
  const isAutoMode = args.includes('--auto') || args.includes('sync');

  const validationsPassed = await preFlightValidation();
  if (!validationsPassed) {
    process.exit(1);
  }

  if (isAutoMode) {
    console.log('🔄 Running in AUTO mode (Repos Sync)...');
    const { reposSyncCommand } = await import('./commands/reposSync');
    await reposSyncCommand();
  } else {
    await showMainMenu();
  }
}

main().catch((err) => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});