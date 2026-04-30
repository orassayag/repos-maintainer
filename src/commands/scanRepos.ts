import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ora from 'ora';
import { Logger } from '../utils/logger.js';
import { Scanner, RepoScanResult, Severity } from '../utils/scanner.js';
import { settings } from '../settings.js';
import { readRepoList } from '../utils/repoList.js';

const REPORT_PATH = path.join(os.homedir(), 'Desktop', 'SCAN_REPOS_REPORT.txt');

export async function scanReposCommand(): Promise<void> {
  Logger.log('\n🔎 Scan Repos — Starting full repository scan...\n');

  // 1. Get all directories in PROJECTS_ROOT
  let projectDirs: string[] = [];
  try {
    const entries = await fs.readdir(settings.PROJECTS_ROOT, {
      withFileTypes: true,
    });
    projectDirs = entries
      .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'))
      .map((dirent) => dirent.name);
  } catch (err) {
    Logger.error(`Failed to read projects root: ${(err as Error).message}`);
    return;
  }

  if (projectDirs.length === 0) {
    Logger.error(`No directories found in ${settings.PROJECTS_ROOT}`);
    return;
  }

  // 2. Load existing repo list for URLs
  const repoList = await readRepoList();
  const repoMap = new Map<string, string>();
  for (const entry of repoList) {
    if (entry.includes(':')) {
      const [name, ...urlParts] = entry.split(':');
      repoMap.set(name.trim().toLowerCase(), urlParts.join(':').trim());
    } else {
      repoMap.set(
        entry.trim().toLowerCase(),
        `https://github.com/${settings.AUTHOR_GITHUB}/${entry.trim()}`
      );
    }
  }

  Logger.log(`📦 Found ${projectDirs.length} directories to scan.\n`);

  const results: RepoScanResult[] = [];
  const scanner = new Scanner();

  const spinner = ora({
    text: 'Starting scan...',
    spinner: 'dots',
  }).start();

  for (let i = 0; i < projectDirs.length; i++) {
    const repoName = projectDirs[i];
    const repoUrl =
      repoMap.get(repoName.toLowerCase()) ||
      `https://github.com/${settings.AUTHOR_GITHUB}/${repoName}`;

    spinner.text = `Scanning [${i + 1}/${projectDirs.length}]: ${repoName}`;

    try {
      const result = await scanner.scanRepo({ name: repoName, url: repoUrl });
      results.push(result);
    } catch (err) {
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

  // 3. Sort results by severity (1 -> 2 -> 3 -> 0)
  // maxSeverity: 1 (High), 2 (Medium), 3 (Low), 0 (None)
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
  let reportContent = `SCAN REPORT \n \n`;
  reportContent += `Date: ${new Date().toLocaleString()} \n \n`;
  reportContent += `========================== \n`;

  for (const result of sortedResults) {
    reportContent += ` \n ${result.repoName} \n`;

    if (result.issues.length > 0) {
      const severityOrder = [Severity.HIGH, Severity.MEDIUM, Severity.LOW];
      const issuesBySeverity: Record<Severity, string[]> = {
        [Severity.HIGH]: [],
        [Severity.MEDIUM]: [],
        [Severity.LOW]: [],
      };

      for (const issue of result.issues) {
        issuesBySeverity[issue.severity].push(issue.message);
      }

      for (const severity of severityOrder) {
        const issues = issuesBySeverity[severity];
        if (issues.length > 0) {
          reportContent += ` \n ${severity}: \n \n`;
          for (const message of issues) {
            reportContent += ` -${message} \n`;
          }
        }
      }
    }
    reportContent += ` \n ========================== \n`;
  }

  try {
    await fs.writeFile(REPORT_PATH, reportContent, 'utf-8');
    Logger.success(`\n🎯 Scan completed! Report saved to: ${REPORT_PATH}`);
  } catch (err) {
    Logger.error(`\nFailed to save report: ${(err as Error).message}`);
  }
}
