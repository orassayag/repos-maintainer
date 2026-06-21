import fs from 'fs/promises';
import ora from 'ora';
import { Logger } from '../utils/logger.js';
import { Scanner, RepoScanResult } from '../utils/scanner.js';
import { Severity, formatIssuesForReport } from '../utils/issues.js';
import { isProjectExcluded } from '../utils/excludes.js';
import { settings } from '../settings.js';
import {
  readRepoList,
  RepoEntry,
  ensureAllReposArePresent,
} from '../utils/repoList.js';

const REPORT_PATH = 'C:\\Users\\Or Assayag\\Desktop\\SCAN_REPOS_REPORT.txt';

export async function scanReposCommand(): Promise<void> {
  Logger.setContext('ScanRepos');
  Logger.debug('Starting scanReposCommand');
  Logger.log('\n🔎 Scan Repos — Starting full repository scan...\n');

  // Ensure all GitHub repos are present locally and in list
  await ensureAllReposArePresent();

  // 1. Get all directories in PROJECTS_ROOT
  let projectDirs: string[] = [];
  try {
    Logger.debug(`Reading projects root: ${settings.PROJECTS_ROOT}`);
    const entries = await fs.readdir(settings.PROJECTS_ROOT, {
      withFileTypes: true,
    });
    projectDirs = entries
      .filter(
        (dirent) =>
          dirent.isDirectory() &&
          !dirent.name.startsWith('.') &&
          !isProjectExcluded(dirent.name)
      )
      .map((dirent) => dirent.name);
    Logger.debug(
      `Found ${projectDirs.length} non-excluded project directories`
    );
  } catch (err) {
    Logger.error(
      `Failed to read projects root: ${(err as Error).message}`,
      err
    );
    return;
  }

  if (projectDirs.length === 0) {
    Logger.warn(`No directories found in ${settings.PROJECTS_ROOT}`);
    Logger.error(`No directories found in ${settings.PROJECTS_ROOT}`);
    return;
  }

  // 2. Load existing repo list for URLs and metadata
  Logger.debug('Reading repo list...');
  const repoList = await readRepoList();
  const repoMap = new Map<string, RepoEntry>();
  for (const entry of repoList) {
    repoMap.set(entry.name.toLowerCase(), entry);
  }
  Logger.debug(`Loaded ${repoList.length} repos from list`);

  Logger.log(`📦 Found ${projectDirs.length} directories to scan.\n`);

  const results: RepoScanResult[] = [];
  const scanner = new Scanner();
  const allUnlistedBinaries = new Set<string>();

  const spinner = ora({
    text: 'Starting scan...',
    spinner: 'dots',
  }).start();

  for (let i = 0; i < projectDirs.length; i++) {
    const repoName = projectDirs[i];
    const repoEntry = repoMap.get(repoName.toLowerCase());
    const repoUrl =
      repoEntry?.url ||
      `https://github.com/${settings.AUTHOR_GITHUB}/${repoName}`;

    spinner.text = `Scanning [${i + 1}/${projectDirs.length}]: ${repoName}`;
    Logger.debug(`Scanning repo ${i + 1}/${projectDirs.length}: ${repoName}`, {
      repoUrl,
    });

    try {
      const result = await scanner.scanRepo({
        name: repoName,
        url: repoUrl,
        purpose: repoEntry?.purpose,
        structure: repoEntry?.structure,
        type: repoEntry?.type,
      });
      results.push(result);
      Logger.debug(`Scan finished for ${repoName}`, {
        issueCount: result.issues.length,
        maxSeverity: result.maxSeverity,
      });
      if (result.unlistedBinaries) {
        result.unlistedBinaries.forEach((b) => allUnlistedBinaries.add(b));
      }
    } catch (err) {
      Logger.error(`Scan failed for ${repoName}`, err);
      results.push({
        repoName,
        issues: [
          {
            severity: Severity.HIGH,
            message: `Scan failed: ${(err as Error).message}`,
          },
        ],
        maxSeverity: 1,
      });
    }
  }

  spinner.stop();

  // 3. Sort results by severity (1 -> 2 -> 3 -> 4 -> 0)
  // maxSeverity: 1 (High), 2 (Medium), 3 (Low), 4 (Very Low), 0 (None)
  const sortedResults = [...results].sort((a, b) => {
    // If one has no issues (maxSeverity 0), it goes to the bottom
    if (a.maxSeverity === 0 && b.maxSeverity === 0)
      return a.repoName.localeCompare(b.repoName);
    if (a.maxSeverity === 0) return 1;
    if (b.maxSeverity === 0) return -1;

    // Lower maxSeverity number means higher severity (1 is High, 3 is Low)
    if (a.maxSeverity !== b.maxSeverity) {
      return a.maxSeverity - b.maxSeverity;
    }

    // If same severity, sort alphabetically
    return a.repoName.localeCompare(b.repoName);
  });

  // 4. Generate Report
  let reportContent = `SCAN_REPOS_REPORT\n`;
  reportContent += `Date: ${new Date().toLocaleString()}\n`;
  reportContent += `==========================\n`;

  for (const result of sortedResults) {
    reportContent += `\n${result.repoName}\n`;

    if (result.issues.length > 0) {
      const severityOrder = [
        Severity.HIGH,
        Severity.MEDIUM,
        Severity.LOW,
        Severity.VERY_LOW,
      ];
      const issuesBySeverity: Record<Severity, string[]> = {
        [Severity.HIGH]: [],
        [Severity.MEDIUM]: [],
        [Severity.LOW]: [],
        [Severity.VERY_LOW]: [],
      };

      for (const issue of result.issues) {
        issuesBySeverity[issue.severity].push(issue.message);
      }

      for (const severity of severityOrder) {
        const issues = issuesBySeverity[severity];
        if (issues.length > 0) {
          reportContent += `\n${severity}:\n`;
          reportContent += formatIssuesForReport(issues);
        }
      }
    }
    reportContent += `\n==========================\n`;
  }

  try {
    await fs.writeFile(REPORT_PATH, reportContent, 'utf-8');
    Logger.success(`\n🎯 Scan completed! Report saved to: ${REPORT_PATH}`);
  } catch (err) {
    Logger.error(`\nFailed to save report: ${(err as Error).message}`);
  }
}
