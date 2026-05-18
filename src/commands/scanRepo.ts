import { Logger } from '../utils/logger.js';
import { Scanner } from '../utils/scanner.js';
import { Severity } from '../utils/issues.js';
import { selectRepo } from '../utils/repoSelector.js';
import fs from 'fs/promises';
import { handleUnlistedBinaries } from '../utils/knipExcluder.js';

const REPORT_PATH = 'C:\\Users\\Or Assayag\\Desktop\\SCAN_REPOS_REPORT.txt';

export async function scanRepoCommand(repo?: {
  name: string;
  url: string;
}): Promise<{ name: string; url: string } | null> {
  try {
    Logger.log('\nScan Repo:');
    Logger.log('==========\n');

    const selectedRepo = repo || (await selectRepo());
    if (!selectedRepo) return null;

    Logger.log(`\n🔍 Starting scan for ${selectedRepo.name}...\n`);

    const scanner = new Scanner();
    const result = await scanner.scanRepo(selectedRepo);

    // 2. Initialize Report
    let reportContent = `SCAN REPORT - ${selectedRepo.name}\n`;
    reportContent += `Date: ${new Date().toLocaleString()}\n`;
    reportContent += `========================================\n`;

    if (result.issues.length === 0) {
      reportContent += `✨ No issues found! The repository follows all standards.\n`;
    } else {
      // Sort and Group issues by severity (High -> Medium -> Low -> Very Low)
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
          reportContent += `\n${severity}:\n\n`;
          for (const message of issues) {
            reportContent += `-${message.trim()}\n`;
          }
        }
      }
    }

    await fs.writeFile(REPORT_PATH, reportContent, 'utf-8');
    Logger.success(`Scan completed! Report saved to: ${REPORT_PATH}`);

    if (result.unlistedBinaries && result.unlistedBinaries.length > 0) {
      await handleUnlistedBinaries(result.unlistedBinaries);
    }

    return selectedRepo;
  } catch (err) {
    Logger.error(`Scan failed: ${(err as Error).message}`);
    return null;
  }
}
