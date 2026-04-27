import { input } from '../utils/prompts.js';
import { readRepoList } from '../utils/repoList.js';
import { Logger } from '../utils/logger.js';
import {
  getRepoMetadata,
  getRulesets,
  isRepoStarred,
  isRepoWatched,
  parseGitHubUrl,
} from '../github.js';
import { normalizeToTitle } from '../utils/stringUtils.js';
import { getLocalRepoPath } from '../settings.js';
import Enquirer from 'enquirer';
import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';

const REPORT_PATH = 'C:\\Users\\Or Assayag\\Desktop\\SCAN_REPORT.txt';

enum Severity {
  HIGH = '1 - High - Most critical - Fix ASAP',
  MEDIUM = '2 - Medium - Need to be addressed',
  LOW = '3 - Low - Fix when have time, nice to have',
}

interface ScanIssue {
  severity: Severity;
  message: string;
}

let scanIssues: ScanIssue[] = [];

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

  // Reset issues for new scan
  scanIssues = [];

  try {
    await performScan(selectedRepo);

    // 2. Initialize Report
    await fs.writeFile(
      REPORT_PATH,
      `SCAN REPORT - ${selectedRepo.name}\n`,
      'utf-8'
    );
    await fs.appendFile(
      REPORT_PATH,
      `Date: ${new Date().toLocaleString()}\n`,
      'utf-8'
    );
    await fs.appendFile(
      REPORT_PATH,
      `========================================\n`,
      'utf-8'
    );

    if (scanIssues.length === 0) {
      await fs.appendFile(
        REPORT_PATH,
        `✨ No issues found! The repository follows all standards.\n`,
        'utf-8'
      );
    } else {
      // Sort and Group issues by severity (High -> Medium -> Low)
      const severityOrder = [Severity.HIGH, Severity.MEDIUM, Severity.LOW];
      const issuesBySeverity: Record<Severity, string[]> = {
        [Severity.HIGH]: [],
        [Severity.MEDIUM]: [],
        [Severity.LOW]: [],
      };

      for (const issue of scanIssues) {
        issuesBySeverity[issue.severity].push(issue.message);
      }

      for (const severity of severityOrder) {
        const issues = issuesBySeverity[severity];
        if (issues.length > 0) {
          await fs.appendFile(REPORT_PATH, `\n${severity}:\n`, 'utf-8');
          for (const message of issues) {
            await fs.appendFile(REPORT_PATH, `-${message}\n`, 'utf-8');
          }
        }
      }
    }

    Logger.success(`Scan completed! Report saved to: ${REPORT_PATH}`);
  } catch (err) {
    Logger.error(`Scan failed: ${(err as Error).message}`);
  }
}

function logToReport(message: string, severity: Severity = Severity.LOW): void {
  scanIssues.push({ message, severity });
}

async function performScan(repo: { name: string; url: string }): Promise<void> {
  const repoPath = getLocalRepoPath(repo.name);
  const parsed = parseGitHubUrl(repo.url);

  // 3.1 Local existence
  try {
    await fs.access(repoPath);
  } catch {
    logToReport(`Project NOT found locally at ${repoPath}`, Severity.HIGH);
    return; // Stop if not found locally
  }

  // 3.2 Git sync
  const gitPath = path.join(repoPath, '.git');
  try {
    await fs.access(gitPath);
  } catch {
    logToReport(
      `Project is NOT synced with git (.git folder missing)`,
      Severity.HIGH
    );
  }

  // 3.3 File comparison with GitHub
  try {
    const status = execSync('git status --porcelain', {
      cwd: repoPath,
      stdio: 'pipe',
    }).toString();
    if (status.trim().length > 0) {
      logToReport(
        `Project files are NOT equal to GitHub (local changes found):\n${status}`,
        Severity.HIGH
      );
    }

    // Check if pushed to remote
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
      stdio: 'pipe',
    })
      .toString()
      .trim();
    const remoteStatus = execSync(`git status -sb`, {
      cwd: repoPath,
      stdio: 'pipe',
    }).toString();
    if (remoteStatus.includes('[ahead ') || remoteStatus.includes('[behind ')) {
      logToReport(
        `Project is NOT in sync with remote branch (${branch}): ${remoteStatus.split('\n')[0]}`,
        Severity.HIGH
      );
    }
  } catch (err) {
    logToReport(
      `Failed to run git status: ${(err as Error).message}`,
      Severity.HIGH
    );
  }

  // 4. Template Scan
  const templatesDir = path.join(process.cwd(), 'src', 'templates');
  const templateFiles = await fs.readdir(templatesDir);

  for (const file of templateFiles) {
    const targetFilePath = path.join(repoPath, file);
    try {
      await fs.access(targetFilePath);
      // Verify content for specific files
      await verifyFileContent(
        file,
        targetFilePath,
        path.join(templatesDir, file)
      );
    } catch {
      logToReport(`Missing template file: ${file}`, Severity.MEDIUM);
    }
  }

  // 5. INSTRUCTIONS.md deep scan
  await scanInstructionsFile(repoPath);

  // 6. README.md deep scan
  await scanReadmeFile(repoPath, repo.name);

  // 7. package.json deep scan
  await scanPackageJson(repoPath, repo.name);

  // 8. GitHub Metadata Scan
  if (parsed) {
    await scanGitHubMetadata(parsed.owner, parsed.repo);
  }
}

async function verifyFileContent(
  fileName: string,
  targetPath: string,
  templatePath: string
): Promise<void> {
  const targetContent = await fs.readFile(targetPath, 'utf-8');
  const templateContent = await fs.readFile(templatePath, 'utf-8');

  if (
    fileName === '.gitignore' ||
    fileName === 'CHANGELOG.md' ||
    fileName === 'CODE_OF_CONDUCT.md' ||
    fileName === 'SECURITY.md' ||
    fileName === 'INSTRUCTIONS.md'
  ) {
    if (!targetContent.includes(templateContent.trim())) {
      const severity = fileName.endsWith('.md')
        ? Severity.LOW
        : Severity.MEDIUM;
      logToReport(
        `${fileName} content is incomplete or doesn't match template.`,
        severity
      );
    }
  } else if (fileName === 'LICENSE') {
    // Ignore year in LICENSE
    const targetNoYear = targetContent.replace(/\d{4}/g, 'YEAR');
    const templateNoYear = templateContent.replace(/\d{4}/g, 'YEAR');
    if (!targetNoYear.includes(templateNoYear.trim())) {
      logToReport(
        `LICENSE content is incomplete or doesn't match template.`,
        Severity.MEDIUM
      );
    }
  }
}

async function scanInstructionsFile(repoPath: string): Promise<void> {
  const filePath = path.join(repoPath, 'INSTRUCTIONS.md');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const requiredSections = [
      'Setup and Usage Instructions',
      'Table of Contents',
      'Prerequisites',
      'System Requirements',
      'Initial Setup',
      'Install Dependencies',
      'Available Commands',
      'Development Commands',
      'Running Scripts',
      'Troubleshooting',
      'Extending the Application',
      'Best Practices',
      'Documentation',
      'External Resources',
      'Author',
      'Last Updated',
      'Version',
    ];

    for (const section of requiredSections) {
      if (!content.includes(section)) {
        logToReport(
          `INSTRUCTIONS.md: Missing section "${section}"`,
          Severity.LOW
        );
      }
    }
  } catch {
    // Already reported missing file in performScan
  }
}

async function scanReadmeFile(
  repoPath: string,
  repoName: string
): Promise<void> {
  const filePath = path.join(repoPath, 'README.md');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim() !== '');

    // 6.2 First section must be repo name (normalized)
    const expectedTitle = `# ${normalizeToTitle(repoName)}`;
    const actualTitle = lines[0].trim();

    if (actualTitle !== expectedTitle) {
      logToReport(
        `README.md: First section should be similar to "${expectedTitle}" (found "${actualTitle}")`,
        Severity.LOW
      );
    }

    // 6.3 Description check
    const description = lines[1]?.trim() || '';
    const descLen = description.length;
    // Assuming it should follow package.json description rules (120-300) or GitHub (340-350)
    if (descLen < 120 || descLen > 350) {
      logToReport(
        `README.md: Description length is ${descLen} (expected 120-350 chars)`,
        Severity.LOW
      );
    }

    // 6.3 Required sections
    const requiredSections = [
      'Features',
      'Core Capabilities',
      'Technical Excellence',
      'Developer Experience',
      'Getting Started',
      'Prerequisites',
      'Installation',
      'Configuration',
      'Usage',
      'Available Scripts',
      'Best Practices',
      'Development',
      'Architecture Principles',
      'Architecture',
      'Directory Structure',
      'Design Patterns',
      'Contributing',
      'License',
      'Support',
      'Author',
      'Acknowledgments',
    ];

    for (const section of requiredSections) {
      if (!content.includes(section)) {
        logToReport(`README.md: Missing section "${section}"`, Severity.LOW);
      }
    }
  } catch {
    // Already reported
  }
}

async function scanPackageJson(
  repoPath: string,
  repoName: string
): Promise<void> {
  const filePath = path.join(repoPath, 'package.json');
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const pkg = JSON.parse(content) as {
      name?: string;
      author?: string;
      license?: string;
      repository?: { type?: string; url?: string };
      contributors?: Array<{ name?: string; email?: string; url?: string }>;
      main?: string;
      type?: string;
      scripts?: Record<string, string>;
      files?: string[];
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      keywords?: string[];
      description?: string;
    };

    if (pkg.name !== repoName)
      logToReport(
        `package.json: "name" should be "${repoName}"`,
        Severity.MEDIUM
      );
    if (pkg.author !== 'Or Assayag <orassayag@gmail.com>')
      logToReport(
        `package.json: "author" should be "Or Assayag <orassayag@gmail.com>"`,
        Severity.MEDIUM
      );
    if (pkg.license !== 'MIT')
      logToReport(`package.json: "license" should be "MIT"`, Severity.MEDIUM);

    // Check repository format
    const expectedRepoUrl = `git://github.com/orassayag/${repoName}.git`;
    if (
      !pkg.repository ||
      pkg.repository.type !== 'git' ||
      pkg.repository.url !== expectedRepoUrl
    ) {
      logToReport(
        `package.json: "repository" should be { "type": "git", "url": "${expectedRepoUrl}" }`,
        Severity.MEDIUM
      );
    }

    // Check contributors
    const expectedContributor = {
      name: 'Or Assayag',
      email: 'orassayag@gmail.com',
      url: 'https://github.com/orassayag',
    };
    const hasContributor = pkg.contributors?.some(
      (c) =>
        c.name === expectedContributor.name &&
        c.email === expectedContributor.email &&
        c.url === expectedContributor.url
    );
    if (!hasContributor)
      logToReport(
        `package.json: Missing or incorrect "contributors" entry for Or Assayag`,
        Severity.MEDIUM
      );

    // Basic existence checks
    if (!pkg.main)
      logToReport(`package.json: Missing "main" field`, Severity.MEDIUM);
    if (!pkg.type)
      logToReport(`package.json: Missing "type" field`, Severity.MEDIUM);
    if (!pkg.scripts)
      logToReport(`package.json: Missing "scripts" section`, Severity.MEDIUM);
    if (!pkg.files || !Array.isArray(pkg.files) || pkg.files.length === 0)
      logToReport(
        `package.json: Missing or empty "files" section`,
        Severity.MEDIUM
      );
    if (!pkg.dependencies)
      logToReport(
        `package.json: Missing "dependencies" section`,
        Severity.MEDIUM
      );
    if (!pkg.devDependencies)
      logToReport(
        `package.json: Missing "devDependencies" section`,
        Severity.MEDIUM
      );

    // 7.6 Keywords check
    const keywords = pkg.keywords || [];
    if (keywords.length < 8 || keywords.length > 20) {
      logToReport(
        `package.json: Keywords count is ${keywords.length} (expected 8-20 unique items)`,
        Severity.MEDIUM
      );
    }

    // 7.4 Description length check
    const descLen = pkg.description?.length || 0;
    if (descLen < 120 || descLen > 300) {
      logToReport(
        `package.json: Description length is ${descLen} (expected 120-300 chars)`,
        Severity.MEDIUM
      );
    }
  } catch {
    // Already reported
  }
}

async function scanGitHubMetadata(owner: string, repo: string): Promise<void> {
  try {
    const metadata = await getRepoMetadata(owner, repo);
    if (!metadata) {
      logToReport(`GitHub: Could not fetch metadata for ${owner}/${repo}`);
      return;
    }

    if (metadata.homepage !== 'https://linkedin.com/in/orassayag') {
      logToReport(
        `GitHub: Homepage should be "https://linkedin.com/in/orassayag" (found "${metadata.homepage}")`
      );
    }

    // Description length check
    const descLen = metadata.description?.length || 0;
    if (descLen < 340 || descLen > 350) {
      logToReport(
        `GitHub: Description length should be 340-350 chars (current: ${descLen})`
      );
    }

    // Stars and Watches check
    const isStarred = await isRepoStarred(owner, repo);
    if (!isStarred) {
      logToReport(`GitHub: Repository is NOT starred by you`);
    }

    const isWatched = await isRepoWatched(owner, repo);
    if (!isWatched) {
      logToReport(`GitHub: Repository is NOT watched by you`);
    }

    // Rulesets check
    const rulesets = await getRulesets(owner, repo);
    if (rulesets.length === 0) {
      logToReport(`GitHub: No rulesets found for the repository`);
    }
  } catch (err) {
    logToReport(`GitHub: Error fetching metadata: ${(err as Error).message}`);
  }
}
