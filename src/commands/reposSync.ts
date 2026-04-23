import { readRepoList } from '../utils/repoList.js';
import { standardizeRepo, type StandardizeResult } from '../fixers/standardizer.js';
import { settings } from '../settings.js';
import { Logger } from '../utils/logger.js';

/**
 * Repos Sync (Crawler) command.
 * Reads all repos from project-repos-names.txt and runs full
 * standardization on each one. Outputs a summary table at the end.
 */
export async function reposSyncCommand(): Promise<void> {
  Logger.log('\n♻️  Repos Sync — Starting full standardization crawl...\n');

  const repoNames = await readRepoList();

  if (repoNames.length === 0) {
    Logger.error('No repositories found in project-repos-names.txt');
    return;
  }

  Logger.log(`📦 Found ${repoNames.length} repositories to process.\n`);

  const results: StandardizeResult[] = [];
  let successCount = 0;

  for (let i = 0; i < repoNames.length; i++) {
    const repoName = repoNames[i];
    const repoUrl = `https://github.com/${settings.AUTHOR_GITHUB}/${repoName}`;

    Logger.log(`\n[${i + 1}/${repoNames.length}] Processing: ${repoName}`);

    try {
      const result = await standardizeRepo(repoUrl);
      results.push(result);
      if (result.success) successCount++;
    } catch (err) {
      // Per-repo try/catch: one failing repo does not stop the entire run
      Logger.error(`Critical failure for ${repoName}: ${(err as Error).message}`);
      results.push({
        repoName,
        success: false,
        changes: [],
        errors: [`Critical error: ${(err as Error).message}`],
      });
    }
  }

  // ── Summary Table ──────────────────────────────────────────────────────
  printSummaryTable(results, repoNames.length, successCount);
}

/**
 * Prints a formatted summary table of all processed repos.
 */
function printSummaryTable(
  results: StandardizeResult[],
  total: number,
  successCount: number,
): void {
  const line = '═'.repeat(80);
  Logger.log('\n\n' + line);
  Logger.log('📊 REPOS SYNC SUMMARY');
  Logger.log(line);
  Logger.log(`  Total repos processed : ${total}`);
  Logger.log(`  ✅ Successful         : ${successCount}`);
  Logger.log(`  ⚠️  With issues        : ${total - successCount}`);

  if (settings.GIT_CLEAN_ENABLED) {
    Logger.log('  🧹 Git clean          : Enabled');
  }
  if (settings.DRY_RUN) {
    Logger.log('  🔍 Mode               : DRY RUN (no changes applied)');
  }
  Logger.log(line);

  // Per-repo details
  for (const result of results) {
    const status = result.success ? '✅' : '⚠️';
    const changesCount = result.changes.length;
    const errorsCount = result.errors.length;

    Logger.log(`\n${status}  ${result.repoName}  (${changesCount} changes, ${errorsCount} errors)`);

    if (result.changes.length > 0) {
      const shown = result.changes.slice(0, 8);
      shown.forEach(c => Logger.log(`     ✓ ${c}`));
      if (result.changes.length > 8) {
        Logger.log(`     ... and ${result.changes.length - 8} more`);
      }
    }

    if (result.errors.length > 0) {
      result.errors.forEach(e => Logger.log(`     ✗ ${e}`));
    }
  }

  Logger.log('\n' + line);
  Logger.log('🎯 Repos Sync completed!');
  Logger.log(line + '\n');
}
