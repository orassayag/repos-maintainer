import 'dotenv/config';
import fs from 'fs/promises';
import { Logger } from './utils/logger.js';
import { checkGitHubAuth } from './github.js';
import { showMainMenu } from './cli.js';
import { settings, getReposListPath } from './settings.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight validation
// ─────────────────────────────────────────────────────────────────────────────

async function preFlightValidation(): Promise<boolean> {
  Logger.log('🔍 Running pre-flight validations...\n');

  // 1. Check PROJECTS_ROOT exists and is not empty
  try {
    await fs.access(settings.PROJECTS_ROOT);
    const entries = await fs.readdir(settings.PROJECTS_ROOT);
    if (entries.length === 0) {
      throw new Error('Directory is empty');
    }
    Logger.success(`Projects root: ${settings.PROJECTS_ROOT}`);
  } catch (error: any) {
    Logger.error(`Projects root not found or empty: ${settings.PROJECTS_ROOT}`);
    if (error.message === 'Directory is empty') {
      Logger.log('     The directory exists but has no projects.\n');
    } else {
      Logger.log(
        '     Set REPOS_ROOT env var or ensure the directory exists.\n'
      );
    }
    return false;
  }

  // 2. Check project-repos-names.txt exists and is not empty
  const listPath = getReposListPath();
  try {
    const content = await fs.readFile(listPath, 'utf-8');
    const lines = content
      .split('\n')
      .filter((l: string) => l.trim() && !l.trim().startsWith('#'));
    if (lines.length === 0) {
      throw new Error('File has no repo entries');
    }
    Logger.success(`Repos list: ${listPath} (${lines.length} repos)`);
  } catch (error: any) {
    Logger.error(`Repos list not found or empty: ${listPath}`);
    if (error.code === 'ENOENT') {
      Logger.log('     The file project-repos-names.txt was not found.\n');
    } else if (error.message === 'File has no repo entries') {
      Logger.log('     The file exists but contains no repository names.\n');
    }
    return false;
  }

  // 3. Verify GitHub authentication
  const isAuthValid = await checkGitHubAuth();
  if (!isAuthValid) {
    Logger.error('GitHub authentication failed.');
    Logger.log(
      '     Please ensure your GITHUB_TOKEN is valid and has proper scopes.\n'
    );
    return false;
  }

  Logger.success('All pre-flight checks passed!');
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Goodbye! (SIGINT)');
  process.exit(0);
});

async function main(): Promise<void> {
  Logger.log('\n🚀 Repos Maintainer starting...\n');

  // Parse CLI flags
  const args = process.argv.slice(2);
  const isAutoMode = args.includes('--auto') || args.includes('sync');

  if (args.includes('--dry-run')) {
    settings.DRY_RUN = true;
    Logger.info('DRY RUN mode enabled — no changes will be applied.\n');
  }

  if (args.includes('--git-clean')) {
    settings.GIT_CLEAN_ENABLED = true;
    Logger.info('Git clean mode enabled.\n');
  }

  // Run pre-flight checks
  const validationsPassed = await preFlightValidation();
  if (!validationsPassed) {
    process.exit(1);
  }

  if (isAutoMode) {
    // Auto mode: run Repos Sync directly without menu
    Logger.log('🔄 Running in AUTO mode (Repos Sync)...');
    const { reposSyncCommand } = await import('./commands/reposSync.js');
    await reposSyncCommand();
  } else {
    // Interactive mode: show menu
    await showMainMenu();
  }
}

main().catch((err) => {
  Logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
