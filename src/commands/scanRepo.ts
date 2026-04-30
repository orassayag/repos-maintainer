import { input } from '../utils/prompts.js';
import { readRepoList } from '../utils/repoList.js';
import { Logger } from '../utils/logger.js';
import { parseGitHubUrl } from '../github.js';
import { Scanner, Severity } from '../utils/scanner.js';
import Enquirer from 'enquirer';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const REPORT_PATH = path.join(os.homedir(), 'Desktop', 'SCAN_REPOS_REPORT.txt');

export async function scanRepoCommand(): Promise<void> {
  Logger.log('\nScan Repo:');
  Logger.log('==========\n');

  const repoList = await readRepoList();
  if (repoList.length === 0) {
    Logger.error('No repos found in the list. Please add a repo first.');
    return;
  }

  let selectedRepo: { name: string; url: string } | null = null;

  while (!selectedRepo) {
    // 1. Get Repo Selection
    const repoNameOrUrl = await input({
      message: 'Enter the repo name or the repo URL:',
      validate: (val): string | boolean =>
        val.trim() ? true : 'Repo name or URL is required',
    });

    // Try exact match
    const parsedInput = parseGitHubUrl(repoNameOrUrl);
    const inputName = parsedInput
      ? parsedInput.repo
      : repoNameOrUrl.toLowerCase();

    for (const entry of repoList) {
      const [name, url] = entry.includes(':')
        ? entry.split(':').map((s) => s.trim())
        : [entry.trim(), ''];

      if (name.toLowerCase() === inputName || url === repoNameOrUrl) {
        selectedRepo = { name, url };
        break;
      }
    }

    if (!selectedRepo) {
      // Try similar match (fuzzy)
      const suggestions = repoList.filter((entry) => {
        const name = entry.includes(':')
          ? entry.split(':')[0].trim()
          : entry.trim();
        return name.toLowerCase().includes(inputName);
      });

      if (suggestions.length > 0) {
        try {
          const { AutoComplete } = Enquirer as any;
          const prompt = new AutoComplete({
            name: 'repo',
            message: 'Repo not found. Did you mean one of these?',
            choices: suggestions.map((s) =>
              s.includes(':') ? s.split(':')[0].trim() : s.trim()
            ),
          });

          const selectedName = (await prompt.run()) as string;
          const entry = repoList.find(
            (s) =>
              (s.includes(':') ? s.split(':')[0].trim() : s.trim()) ===
              selectedName
          );
          if (entry) {
            const [name, url] = entry.includes(':')
              ? entry.split(':').map((s) => s.trim())
              : [entry.trim(), ''];
            selectedRepo = { name, url };
          }
        } catch (_e) {
          // User might have escaped AutoComplete, loop will continue to ask input
        }
      }
    }

    if (!selectedRepo) {
      Logger.error('Repo not found in the list. Please try again.');
    }
  }

  Logger.log(`\n🔍 Starting scan for ${selectedRepo.name}...\n`);

  const scanner = new Scanner();

  try {
    const result = await scanner.scanRepo(selectedRepo);

    // 2. Initialize Report
    let reportContent = `SCAN REPORT - ${selectedRepo.name}\n`;
    reportContent += `Date: ${new Date().toLocaleString()}\n`;
    reportContent += `========================================\n`;

    if (result.issues.length === 0) {
      reportContent += `✨ No issues found! The repository follows all standards.\n`;
    } else {
      // Sort and Group issues by severity (High -> Medium -> Low)
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
          reportContent += `\n${severity}:\n`;
          for (const message of issues) {
            reportContent += `-${message}\n`;
          }
        }
      }
    }

    await fs.writeFile(REPORT_PATH, reportContent, 'utf-8');
    Logger.success(`Scan completed! Report saved to: ${REPORT_PATH}`);
  } catch (err) {
    Logger.error(`Scan failed: ${(err as Error).message}`);
  }
}
