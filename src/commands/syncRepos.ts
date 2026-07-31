import fs from 'fs/promises';
import ora from 'ora';
import { Logger } from '../utils/logger.js';
import { syncAllRepos, RepoSyncResult } from '../utils/repoList.js';

const REPORT_PATH = 'C:\\Users\\Or Assayag\\Desktop\\SYNC_REPOS_REPORT.txt';

function formatGroup(title: string, lines: string[]): string {
  if (lines.length === 0) {
    return '';
  }
  return `\n${title} (${lines.length}):\n` + lines.map((l) => `  - ${l}`).join('\n') + '\n';
}

/**
 * Pull-only command: pulls the latest for every repo in the list and writes a
 * summary report. It never scans, fixes, or writes to GitHub.
 */
export async function syncReposCommand(): Promise<void> {
  Logger.setContext('SyncRepos');
  Logger.debug('Starting syncReposCommand');
  Logger.log('\n🔃 Sync Repos — Pulling latest for all repos...\n');

  const spinner = ora({
    text: 'Pulling latest for all repos...',
    spinner: 'dots',
  }).start();

  const summary = await syncAllRepos();

  spinner.stop();

  const pulled = summary.results.filter((r) => r.pulled).map((r) => r.name);
  const upToDate = summary.results
    .filter((r) => r.skippedReason === 'up-to-date')
    .map((r) => r.name);
  const skippedDirty = summary.results
    .filter((r) => r.skippedReason === 'dirty')
    .map((r) => r.name);
  const mismatched = summary.results
    .filter((r) => r.skippedReason === 'mismatch')
    .map((r) => r.name);
  const errored = summary.results
    .filter((r: RepoSyncResult) => r.error)
    .map((r) => `${r.name}: ${r.error}`);

  let reportContent = `SYNC_REPOS_REPORT\n`;
  reportContent += `Date: ${new Date().toLocaleString()}\n`;
  reportContent += `==========================\n`;
  reportContent += `Summary: ${summary.pulled} pulled, ${summary.upToDate} up to date, `;
  reportContent += `${summary.skippedDirty} skipped (uncommitted), ${summary.errors} errors\n`;
  reportContent += formatGroup('PULLED', pulled);
  reportContent += formatGroup('UP TO DATE', upToDate);
  reportContent += formatGroup('SKIPPED (uncommitted changes)', skippedDirty);
  reportContent += formatGroup('SKIPPED (remote mismatch)', mismatched);
  reportContent += formatGroup('ERRORS', errored);
  reportContent += `\n==========================\n`;

  try {
    await fs.writeFile(REPORT_PATH, reportContent, 'utf-8');
    Logger.success(`\n🎯 Sync completed! Report saved to: ${REPORT_PATH}`);
  } catch (err) {
    Logger.error(`\nFailed to save report: ${(err as Error).message}`);
  }
}
