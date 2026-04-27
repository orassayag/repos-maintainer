import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from './logger.js';
import { settings } from '../settings.js';

const execAsync = promisify(exec);

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
    await execAsync('pnpm install', {
      cwd: repoPath,
    });
    Logger.success("'pnpm install' completed successfully");
    return true;
  } catch (err) {
    Logger.error(`'pnpm install' failed: ${(err as Error).message}`);
    return false;
  }
}
