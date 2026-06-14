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
    const { stdout, stderr } = await execAsync(
      'pnpm install --ignore-scripts',
      {
        cwd: repoPath,
        env: {
          ...process.env,
          PNPM_CONFIG_IGNORE_BUILDS: 'false',
        },
      }
    );
    if (stdout) Logger.info(stdout);
    if (stderr) Logger.warn(stderr);
    Logger.success("'pnpm install' completed successfully");
    return true;
  } catch (err: any) {
    Logger.error(`'pnpm install' failed: ${err.message}`);
    if (err.stdout) Logger.error(`stdout: ${err.stdout}`);
    if (err.stderr) Logger.error(`stderr: ${err.stderr}`);
    return false;
  }
}
