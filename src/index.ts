import 'dotenv/config';
import fs from 'fs/promises';
import { Logger } from './utils/logger.js';
import { checkGitHubAuth } from './github.js';
import { showMainMenu } from './cli.js';
import { settings, getReposListPath, logSettings } from './settings.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pre-flight validation
// ─────────────────────────────────────────────────────────────────────────────

export async function preFlightValidation(): Promise<boolean> {
  Logger.setContext('PreFlight');
  Logger.debug('Running pre-flight validations...');
  Logger.log('🔍 Running pre-flight validations...\n');

  // 1. Check PROJECTS_ROOT exists and is not empty
  try {
    Logger.debug(`Checking PROJECTS_ROOT: ${settings.PROJECTS_ROOT}`);
    await fs.access(settings.PROJECTS_ROOT);
    const entries = await fs.readdir(settings.PROJECTS_ROOT);
    if (entries.length === 0) {
      throw new Error('Directory is empty');
    }
    Logger.debug(`PROJECTS_ROOT exists and contains ${entries.length} entries`);
    Logger.success(`Projects root: ${settings.PROJECTS_ROOT}`);
  } catch (error: any) {
    Logger.error(
      `Projects root not found or empty: ${settings.PROJECTS_ROOT}`,
      error
    );
    if (error.message === 'Directory is empty') {
      Logger.log('     The directory exists but has no projects.\n');
    } else {
      Logger.log(
        '     Set REPOS_ROOT env var or ensure the directory exists.\n'
      );
    }
    return false;
  }

  // 2. Check project-repos-names.json exists and is not empty
  const listPath = getReposListPath();
  try {
    Logger.debug(`Checking repos list file: ${listPath}`);
    const content = await fs.readFile(listPath, 'utf-8');
    const repos = JSON.parse(content);
    if (!Array.isArray(repos) || repos.length === 0) {
      throw new Error('File has no repo entries');
    }
    Logger.debug(`Repos list file found and contains ${repos.length} repos`);
    Logger.success(`Repos list: ${listPath} (${repos.length} repos)`);
  } catch (error: any) {
    Logger.error(`Repos list not found or empty: ${listPath}`, error);
    if (error.code === 'ENOENT') {
      Logger.log('     The file project-repos-names.json was not found.\n');
    } else if (error.message === 'File has no repo entries') {
      Logger.log('     The file exists but contains no repository names.\n');
    } else if (error instanceof SyntaxError) {
      Logger.log('     The file contains invalid JSON.\n');
    }
    return false;
  }

  // 3. Verify GitHub authentication
  Logger.debug('Verifying GitHub authentication...');
  const isAuthValid = await checkGitHubAuth();
  if (!isAuthValid) {
    Logger.error('GitHub authentication failed.');
    Logger.log(
      '     Please ensure your GITHUB_TOKEN is valid and has proper scopes.\n'
    );
    return false;
  }

  Logger.debug('All pre-flight checks passed successfully');
  Logger.success('All pre-flight checks passed!');
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  Logger.setContext('Main');
  Logger.debug('Application starting...', {
    args: process.argv,
    cwd: process.cwd(),
    env: {
      REPOS_ROOT: process.env.REPOS_ROOT,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN ? '***' : 'MISSING',
      LOG_LEVEL: process.env.LOG_LEVEL,
    },
  });

  logSettings();
  Logger.log('\n🚀 Repos Maintainer starting...\n');

  // Parse CLI flags
  const args = process.argv.slice(2);
  const isSyncReposMode =
    args.includes('SYNC-REPOS') || args.includes('--sync-repos');
  const isAutoMode =
    args.includes('--auto') || args.includes('sync') || args.includes('AUTO');

  if (args.includes('--dry-run')) {
    settings.DRY_RUN = true;
    Logger.info('DRY RUN mode enabled — no changes will be applied.\n');
  }

  if (args.includes('--git-clean')) {
    settings.GIT_CLEAN_ENABLED = true;
    Logger.info('Git clean mode enabled.\n');
  }

  Logger.debug('CLI arguments parsed', {
    isSyncReposMode,
    isAutoMode,
    dryRun: settings.DRY_RUN,
    gitClean: settings.GIT_CLEAN_ENABLED,
  });

  // Run pre-flight checks
  const validationsPassed = await preFlightValidation();
  if (!validationsPassed) {
    Logger.error('Pre-flight validations failed, exiting.');
    process.exit(1);
  }

  if (isSyncReposMode) {
    // Sync-repos mode: pull latest for all repos, no scan/fix
    Logger.debug('Running in SYNC-REPOS mode');
    Logger.log('🔃 Running in SYNC-REPOS mode (pull only)...');
    const { syncReposCommand } = await import('./commands/syncRepos.js');
    await syncReposCommand();
  } else if (isAutoMode) {
    // Auto mode: run Scan Repos directly without menu
    Logger.debug('Running in AUTO mode');
    Logger.log('🔄 Running in AUTO mode (Scan Repos)...');
    const { scanReposCommand } = await import('./commands/scanRepos.js');
    await scanReposCommand();
  } else {
    // Interactive mode: show menu
    await showMainMenu();
  }
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    Logger.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}
