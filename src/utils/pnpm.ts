import { execSync } from 'child_process';
import { Logger } from './logger.js';
import { settings } from '../settings.js';

/**
 * Runs "pnpm install" in the specified directory.
 */
export async function runPnpmInstall(repoPath: string): Promise<boolean> {
  Logger.log(`📦 Running 'pnpm install' in ${repoPath}...`);

  if (settings.DRY_RUN) {
    Logger.log(`🔍 [DRY RUN] Would run 'pnpm install'`);
    return true;
  }

  try {
    execSync('pnpm install', {
      cwd: repoPath,
      stdio: 'inherit',
    });
    Logger.success("'pnpm install' completed successfully");
    return true;
  } catch (err) {
    Logger.error(`'pnpm install' failed: ${(err as Error).message}`);
    return false;
  }
}
