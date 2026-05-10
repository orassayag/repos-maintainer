import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import latestVersion from 'latest-version';
import semver from 'semver';
import { getLocalRepoPath } from '../settings.js';
import { Severity, ISSUES, IssueKey } from './issues.js';
import {
  getExcludedPaths,
  isIssueExcluded,
  isKnipScanExcluded,
  getExcludedKnipPackages,
  getExcludedKnipPaths,
  isOutdatedScanExcluded,
} from './excludes.js';
import {
  parseGitHubUrl,
  getRepoMetadata,
  isRepoStarred,
  isRepoWatched,
  getRulesets,
  RepoMetadata,
} from '../github.js';
import { normalizeToTitle, stripAnsi } from './stringUtils.js';

export interface ScanIssue {
  severity: Severity;
  message: string;
}

export interface RepoScanResult {
  repoName: string;
  issues: ScanIssue[];
  maxSeverity: number; // 1, 2, 3, or 4 (0 if no issues)
}

export class Scanner {
  private scanIssues: ScanIssue[] = [];
  private currentRepoName: string = '';

  private logIssue(
    issueKey: IssueKey,
    params?: Record<string, string | number>
  ): void {
    if (isIssueExcluded(this.currentRepoName, issueKey)) {
      return;
    }

    const issueDef = ISSUES[issueKey];
    let message: string = issueDef.message;

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        message = message.replace(`{${key}}`, String(value));
      }
    }

    this.logToReport(message, issueDef.severity);
  }

  private async getAllFiles(
    dir: string,
    baseDir: string = dir
  ): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        const res = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') return [];
          return await this.getAllFiles(res, baseDir);
        } else {
          return [path.relative(baseDir, res)];
        }
      })
    );
    return files.flat();
  }

  async scanRepo(repo: { name: string; url: string }): Promise<RepoScanResult> {
    this.scanIssues = [];
    this.currentRepoName = repo.name;
    const repoPath = getLocalRepoPath(repo.name);
    const parsed = parseGitHubUrl(repo.url);
    const excludedPaths = getExcludedPaths(repo.name);

    // 1. Local existence
    try {
      await fs.access(repoPath);
    } catch {
      this.logIssue('PROJECT_NOT_FOUND', { repoPath });
      return this.getResult(repo.name);
    }

    // 2. Git sync
    const gitPath = path.join(repoPath, '.git');
    try {
      await fs.access(gitPath);
    } catch {
      this.logIssue('PROJECT_NOT_SYNCED');
    }

    // 3. File comparison with GitHub
    try {
      let status = execSync('git status --porcelain', {
        cwd: repoPath,
        stdio: 'pipe',
      }).toString();

      if (excludedPaths.length > 0) {
        status = status
          .split('\n')
          .filter((line) => {
            if (!line.trim()) return false;
            // git status --porcelain output: "XY path/to/file"
            // or "XY "path/with spaces/file""
            let filePath = line.substring(3).trim();
            if (filePath.startsWith('"') && filePath.endsWith('"')) {
              filePath = filePath.substring(1, filePath.length - 1);
            }
            return !excludedPaths.some(
              (excluded) =>
                filePath === excluded || filePath.startsWith(excluded + '/')
            );
          })
          .join('\n');
      }

      if (status.trim().length > 0) {
        this.logIssue('LOCAL_CHANGES', { status });
      }

      // Check if pushed to remote
      const branchStatus = execSync('git status -uno', {
        cwd: repoPath,
        stdio: 'pipe',
      }).toString();
      if (branchStatus.includes('Your branch is ahead of')) {
        this.logIssue('NOT_PUSHED');
      }
    } catch (err) {
      this.logIssue('GIT_STATUS_FAILED', {
        error: (err as Error).message,
      });
    }

    // 4. Template Scan
    const templatesDir = path.join(process.cwd(), 'src', 'templates');
    let templateFiles: string[] = [];
    try {
      templateFiles = await this.getAllFiles(templatesDir);
    } catch {
      // templates dir might not exist in some contexts (e.g. built app)
      // but in this project it should.
    }

    for (const file of templateFiles) {
      if (excludedPaths.includes(file)) continue;

      const targetFilePath = path.join(repoPath, file);
      try {
        await fs.access(targetFilePath);
        // Verify content for specific files
        await this.verifyFileContent(
          file,
          targetFilePath,
          path.join(templatesDir, file)
        );
      } catch {
        this.logIssue('MISSING_TEMPLATE_FILE', { file });
      }
    }

    // 5. INSTRUCTIONS.md deep scan
    if (!excludedPaths.includes('INSTRUCTIONS.md')) {
      await this.scanInstructionsFile(repoPath);
    }

    // 6. README.md deep scan
    if (!excludedPaths.includes('README.md')) {
      await this.scanReadmeFile(repoPath, repo.name);
    }

    // 7. package.json deep scan
    let githubMetadata: RepoMetadata | null = null;
    if (parsed) {
      try {
        githubMetadata = await getRepoMetadata(parsed.owner, parsed.repo);
      } catch {
        // Ignore metadata errors for now
      }
    }

    if (!excludedPaths.includes('package.json')) {
      await this.scanPackageJson(
        repoPath,
        repo.name,
        githubMetadata?.topics || []
      );
    }

    // 8. Formatter Scan
    this.scanFormatters(repoPath);

    // 9. Lint Scan (via npx if node_modules missing)
    try {
      this.scanLint(repoPath);
    } catch {
      // console.error('Lint Scan Error');
    }

    // 10. ESLint Config Scan
    this.scanEslintConfig(repoPath);

    // 11. Vitest Config Scan
    this.scanVitestConfig(repoPath);

    // 12. Test Scan (via npx if node_modules missing)
    try {
      this.scanTests(repoPath);
    } catch {
      // Ignore test scan errors
    }

    // 13. Knip Scan (Unused dependencies/exports)
    try {
      this.scanKnip(repoPath);
    } catch {
      // Ignore knip scan errors
    }

    // 14. GitHub Metadata Scan
    if (parsed) {
      try {
        await this.scanGitHubMetadata(
          parsed.owner,
          parsed.repo,
          githubMetadata
        );
      } catch {
        // console.error('Metadata Scan Error');
        // Ignore metadata errors in bulk scan to avoid stopping
      }
    }

    const result = this.getResult(repo.name);
    return result;
  }

  private scanKnip(repoPath: string): void {
    if (isKnipScanExcluded(this.currentRepoName)) return;

    const pkg = this.readPkg(repoPath);
    if (!pkg.name) return;

    const isPnpm = existsSync(path.join(repoPath, 'pnpm-lock.yaml'));
    const baseCommand = isPnpm ? 'pnpm dlx knip' : 'npx --yes knip';

    // Use --directory to point to the repo path and run from current directory
    const relativePath = path.relative(process.cwd(), repoPath);
    let command = `${baseCommand} --directory "${relativePath}"`;

    const excludedPaths = getExcludedKnipPaths(this.currentRepoName);
    if (excludedPaths.length > 0) {
      for (const p of excludedPaths) {
        command += ` --ignore "${p}"`;
      }
    }

    const result = this.runCmd(command, process.cwd());

    // Knip output parsing - focus on unused/unlisted items
    if (result.stdout.trim().length > 0) {
      const excludedPackages = getExcludedKnipPackages(this.currentRepoName);
      const cleanStdout = stripAnsi(result.stdout);
      const lines = cleanStdout.split('\n');
      const issues: string[] = [];
      let currentHeader = '';
      let categoryIssues: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const isHeader =
          trimmed.includes('Unused') ||
          trimmed.includes('Unlisted') ||
          trimmed.includes('Duplicate');

        if (isHeader) {
          // If we were already capturing, push the previous category's issues
          if (currentHeader && categoryIssues.length > 0) {
            issues.push(currentHeader);
            issues.push(...categoryIssues.map((i) => `  ${i}`));
          }
          currentHeader = trimmed;
          categoryIssues = [];
        } else {
          // Check if line contains any excluded package
          const isPkgExcluded = excludedPackages.some((pkgName) =>
            trimmed.includes(pkgName)
          );
          if (isPkgExcluded) continue;

          // Check if line contains any excluded path
          const isPathExcluded = excludedPaths.some((p) => {
            const normalizedPath = p.replace(/\\/g, '/');
            // Remove leading dash or spaces if present to check the path correctly
            const cleanTrimmed = trimmed.startsWith('-')
              ? trimmed.substring(1).trim()
              : trimmed;
            const normalizedTrimmed = cleanTrimmed.replace(/\\/g, '/');
            return (
              normalizedTrimmed === normalizedPath ||
              normalizedTrimmed.startsWith(normalizedPath + '/') ||
              normalizedTrimmed.includes('/' + normalizedPath + '/')
            );
          });
          if (isPathExcluded) continue;

          if (
            currentHeader &&
            (trimmed.startsWith('-') || line.startsWith(' '))
          ) {
            // Capture the specific item
            categoryIssues.push(trimmed);
          } else if (currentHeader && !isHeader && trimmed) {
            // If it's not a header and doesn't look like a list item,
            // but we have a header, it might be a detail line without a dash
            categoryIssues.push(trimmed);
          }
        }

        // Limit total lines to avoid massive reports
        if (issues.length + categoryIssues.length >= 40) break;
      }

      // Push the last category
      if (currentHeader && categoryIssues.length > 0) {
        issues.push(currentHeader);
        issues.push(...categoryIssues.map((i) => `  ${i}`));
      }

      if (issues.length > 0) {
        this.logIssue('KNIP_ISSUES', {
          issues: issues.map((i) => `  - ${i}`).join('\n'),
        });
      }
    } else if (
      result.combined.toLowerCase().includes('error') &&
      !result.combined.includes('No issues found')
    ) {
      this.logIssue('KNIP_COMMAND_FAILED', { command });
    }
  }

  private logToReport(
    message: string,
    severity: Severity = Severity.LOW
  ): void {
    this.scanIssues.push({ message, severity });
  }

  private getResult(repoName: string): RepoScanResult {
    let maxSeverity = 0;
    // Severity levels are: 1 - High, 2 - Medium, 3 - Low, 4 - Very Low
    if (this.scanIssues.some((i) => i.severity === Severity.HIGH))
      maxSeverity = 1;
    else if (this.scanIssues.some((i) => i.severity === Severity.MEDIUM))
      maxSeverity = 2;
    else if (this.scanIssues.some((i) => i.severity === Severity.LOW))
      maxSeverity = 3;
    else if (this.scanIssues.some((i) => i.severity === Severity.VERY_LOW))
      maxSeverity = 4;

    return {
      repoName,
      issues: [...this.scanIssues],
      maxSeverity,
    };
  }

  private async verifyFileContent(
    fileName: string,
    targetPath: string,
    templatePath: string
  ): Promise<void> {
    const targetContent = await fs.readFile(targetPath, 'utf-8');
    const templateContent = await fs.readFile(templatePath, 'utf-8');

    if (fileName === '.gitignore') {
      this.validateGitignore(targetContent, templateContent);
    } else if (
      fileName === 'CODE_OF_CONDUCT.md' ||
      fileName === 'SECURITY.md'
    ) {
      if (!targetContent.includes(templateContent.trim())) {
        this.logIssue('FILE_CONTENT_MISMATCH', { file: fileName });
      }
    } else if (fileName === 'LICENSE') {
      // Ignore year in LICENSE
      const targetNoYear = targetContent.replace(/\d{4}/g, 'YEAR');
      const templateNoYear = templateContent.replace(/\d{4}/g, 'YEAR');
      if (!targetNoYear.includes(templateNoYear.trim())) {
        this.logIssue('LICENSE_CONTENT_MISMATCH');
      }
    }
  }

  private validateGitignore(
    targetContent: string,
    templateContent: string
  ): void {
    const targetLines = new Set(
      targetContent
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
    );
    const templateLines = templateContent
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    const missingLines: string[] = [];
    for (const line of templateLines) {
      if (!targetLines.has(line)) {
        missingLines.push(line);
      }
    }

    if (missingLines.length > 0) {
      this.logIssue('GITIGNORE_MISSING_LINES', {
        lines: missingLines.map((l) => `  - ${l}`).join('\n'),
      });
    }
  }

  private async scanInstructionsFile(repoPath: string): Promise<void> {
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
          this.logIssue('INSTRUCTIONS_MISSING_SECTION', { section });
        }
      }
    } catch {
      // Already reported missing file
    }
  }

  private async scanReadmeFile(
    repoPath: string,
    repoName: string
  ): Promise<void> {
    const filePath = path.join(repoPath, 'README.md');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim() !== '');

      const expectedTitle = `# ${normalizeToTitle(repoName)}`;
      const actualTitle = lines[0]?.trim() || '';

      if (actualTitle !== expectedTitle) {
        this.logIssue('README_TITLE_MISMATCH', {
          expectedTitle,
          actualTitle,
        });
      }

      const description = lines[1]?.trim() || '';
      const descLen = description.length;
      if (descLen < 290 || descLen > 350) {
        this.logIssue('README_DESCRIPTION_LENGTH', {
          actualLen: descLen,
          min: 290,
          max: 350,
        });
      }

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
          this.logIssue('README_MISSING_SECTION', { section });
        }
      }
    } catch {
      // Already reported
    }
  }

  private async scanPackageJson(
    repoPath: string,
    repoName: string,
    githubTopics: string[] = []
  ): Promise<void> {
    const filePath = path.join(repoPath, 'package.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const pkg = JSON.parse(content);

      if (pkg.name !== repoName)
        this.logToReport(
          `package.json: "name" should be "${repoName}"`,
          Severity.MEDIUM
        );

      // Author Validation
      const expectedAuthor = {
        name: 'Or Assayag',
        email: 'orassayag@gmail.com',
        url: 'https://github.com/orassayag',
      };
      if (!pkg.author) {
        this.logIssue('PACKAGE_JSON_MISSING_AUTHOR');
      } else if (
        typeof pkg.author !== 'object' ||
        pkg.author.name !== expectedAuthor.name ||
        pkg.author.email !== expectedAuthor.email ||
        pkg.author.url !== expectedAuthor.url
      ) {
        this.logIssue('PACKAGE_JSON_AUTHOR_MISMATCH', {
          expectedAuthor: JSON.stringify(expectedAuthor, null, 2),
        });
      }

      if (pkg.license !== 'MIT') {
        this.logIssue('PACKAGE_JSON_LICENSE_MISMATCH');
      }

      const expectedRepoUrl = `git://github.com/orassayag/${repoName}.git`;
      if (
        !pkg.repository ||
        pkg.repository.type !== 'git' ||
        pkg.repository.url !== expectedRepoUrl
      ) {
        this.logIssue('PACKAGE_JSON_REPO_URL_MISMATCH', {
          expectedRepoUrl,
        });
      }

      // Homepage Validation
      const expectedHomepage = `https://github.com/orassayag/${repoName}#readme`;
      if (!pkg.homepage) {
        this.logIssue('PACKAGE_JSON_MISSING_HOMEPAGE');
      } else if (pkg.homepage !== expectedHomepage) {
        this.logIssue('PACKAGE_JSON_HOMEPAGE_MISMATCH', {
          expectedHomepage,
        });
      }

      // Bugs Validation
      const expectedBugsUrl = `https://github.com/orassayag/${repoName}/issues`;
      if (!pkg.bugs) {
        this.logIssue('PACKAGE_JSON_MISSING_BUGS');
      } else if (!pkg.bugs.url || pkg.bugs.url !== expectedBugsUrl) {
        this.logIssue('PACKAGE_JSON_BUGS_MISMATCH', {
          expectedBugsUrl,
        });
      }

      // Funding Validation
      const expectedFunding = {
        type: 'github',
        url: 'https://github.com/sponsors/orassayag',
      };
      if (!pkg.funding) {
        this.logIssue('PACKAGE_JSON_MISSING_FUNDING');
      } else if (
        typeof pkg.funding !== 'object' ||
        pkg.funding.type !== expectedFunding.type ||
        pkg.funding.url !== expectedFunding.url
      ) {
        this.logIssue('PACKAGE_JSON_FUNDING_MISMATCH');
      }

      // Engines Validation
      if (!pkg.engines) {
        this.logIssue('PACKAGE_JSON_MISSING_ENGINES');
      } else if (
        typeof pkg.engines !== 'object' ||
        Object.keys(pkg.engines).length === 0
      ) {
        this.logIssue('PACKAGE_JSON_ENGINES_MISMATCH');
      }

      const expectedContributor = {
        name: 'Or Assayag',
        email: 'orassayag@gmail.com',
        url: 'https://github.com/orassayag',
      };
      const hasContributor = pkg.contributors?.some(
        (c: { name: string; email: string; url: string }) =>
          c.name === expectedContributor.name &&
          c.email === expectedContributor.email &&
          c.url === expectedContributor.url
      );
      if (!hasContributor) {
        this.logIssue('PACKAGE_JSON_MISSING_CONTRIBUTOR');
      }

      if (!pkg.main) this.logIssue('PACKAGE_JSON_MISSING_MAIN');
      if (!pkg.type) this.logIssue('PACKAGE_JSON_MISSING_TYPE');
      if (!pkg.scripts) this.logIssue('PACKAGE_JSON_MISSING_SCRIPTS');
      if (!pkg.files || !Array.isArray(pkg.files) || pkg.files.length === 0) {
        this.logIssue('PACKAGE_JSON_MISSING_FILES');
      } else {
        const rootItems = (await fs.readdir(repoPath)).filter(
          (item) => item !== '.git' && item !== 'node_modules'
        );
        const sortedRootItems = [...rootItems].sort();
        const pkgFiles = pkg.files;

        const isIdentical =
          pkgFiles.length === rootItems.length &&
          pkgFiles.every((file: string) => rootItems.includes(file));

        if (!isIdentical) {
          this.logIssue('PACKAGE_JSON_FILES_NOT_IDENTICAL');
        } else {
          const isSorted = pkgFiles.every(
            (file: string, index: number) => file === sortedRootItems[index]
          );
          if (!isSorted) {
            this.logIssue('PACKAGE_JSON_FILES_NOT_SORTED');
          }
        }
      }
      const skipOutdated = isOutdatedScanExcluded(this.currentRepoName);

      if (!pkg.dependencies) {
        this.logIssue('PACKAGE_JSON_MISSING_DEPENDENCIES');
      } else if (!skipOutdated) {
        await this.checkDependenciesVersion(pkg.dependencies);
      }

      if (!pkg.devDependencies) {
        this.logIssue('PACKAGE_JSON_MISSING_DEV_DEPENDENCIES');
      } else if (!skipOutdated) {
        await this.checkDependenciesVersion(pkg.devDependencies);
      }

      const keywords = pkg.keywords || [];
      if (keywords.length < 8 || keywords.length > 20) {
        this.logIssue('PACKAGE_JSON_KEYWORDS_COUNT', {
          actualCount: keywords.length,
        });
      }

      // Keywords vs GitHub Topics Validation
      if (keywords.length > 0) {
        const sortedKeywords = [...keywords].sort();
        const sortedTopics = [...githubTopics].sort();

        const areEqual =
          sortedKeywords.length === sortedTopics.length &&
          sortedKeywords.every((kw, i) => kw === sortedTopics[i]);

        if (!areEqual) {
          this.logIssue('PACKAGE_JSON_KEYWORDS_MISMATCH', {
            expected: keywords.join(', '),
            found: githubTopics.join(', ') || 'none',
          });
        }
      }

      const descLen = pkg.description?.length || 0;
      if (descLen < 290 || descLen > 300) {
        this.logIssue('PACKAGE_JSON_DESCRIPTION_LENGTH', {
          actualLen: descLen,
        });
      }
    } catch {
      // Already reported
    }
  }

  private scanTests(repoPath: string): void {
    const pkg = this.readPkg(repoPath);
    if (!pkg.scripts?.test) return;

    const hasVitestConfig = existsSync(path.join(repoPath, 'vitest.config.ts'));
    if (!hasVitestConfig) return;

    // Run test command via npx
    const cmd = `npx --yes ${pkg.scripts.test}`;
    const result = this.runCmd(cmd, repoPath);

    if (
      result.combined.toLowerCase().includes('error') ||
      result.combined.toLowerCase().includes('failed')
    ) {
      // Strip ANSI codes and look for specific ERROR lines
      const cleanCombined = stripAnsi(result.combined);
      const issues = cleanCombined
        .split('\n')
        .filter(
          (line) =>
            line.includes('ERROR:') ||
            line.includes('error') ||
            line.includes('failed')
        )
        .slice(0, 10); // Limit to first 10 issues

      if (issues.length > 0) {
        this.logIssue('TEST_ISSUES', {
          issues: issues.map((i) => `  - ${i.trim()}`).join('\n'),
        });
      } else {
        this.logIssue('TEST_COMMAND_FAILED');
      }
    }
  }

  private scanLint(repoPath: string): void {
    const pkg = this.readPkg(repoPath);
    if (!pkg.scripts?.lint) return;

    const nodeModulesPath = path.join(repoPath, 'node_modules');
    if (existsSync(nodeModulesPath)) return;

    // Run lint command via npx
    const cmd = `npx --yes ${pkg.scripts.lint}`;
    const result = this.runCmd(cmd, repoPath);

    if (
      result.combined.toLowerCase().includes('error') ||
      result.combined.toLowerCase().includes('failed')
    ) {
      // Strip ANSI codes and check if it's a real lint issue
      const cleanCombined = stripAnsi(result.combined);
      const issues = cleanCombined
        .split('\n')
        .filter((line) => line.includes('error') || line.includes('warning'))
        .slice(0, 5); // Limit to first 5 issues

      if (issues.length > 0) {
        this.logIssue('LINT_ISSUES', {
          issues: issues.map((i) => `  - ${i.trim()}`).join('\n'),
        });
      } else {
        this.logIssue('LINT_COMMAND_FAILED');
      }
    }
  }

  private scanEslintConfig(repoPath: string): void {
    const hasLegacyConfig =
      existsSync(path.join(repoPath, 'eslintrc.json')) ||
      existsSync(path.join(repoPath, '.eslintrc.json'));
    const hasFlatConfig = existsSync(path.join(repoPath, 'eslint.config.mjs'));

    if (!hasLegacyConfig && !hasFlatConfig) {
      this.logIssue('ESLINT_CONFIG_MISSING');
    } else if (hasLegacyConfig && !hasFlatConfig) {
      this.logIssue('ESLINT_LEGACY_CONFIG');
    }
  }

  private scanVitestConfig(repoPath: string): void {
    const hasVitestConfig = existsSync(path.join(repoPath, 'vitest.config.ts'));
    if (!hasVitestConfig) {
      this.logIssue('VITEST_CONFIG_MISSING');
    }
  }

  private async checkDependenciesVersion(
    dependencies: Record<string, string>
  ): Promise<void> {
    const packages = Object.keys(dependencies);
    // Use Promise.all to check versions in parallel for better performance
    await Promise.all(
      packages.map(async (pkgName) => {
        try {
          const currentVersionRange = dependencies[pkgName];
          const latest = await latestVersion(pkgName);

          // Get the minimum version that satisfies the range in package.json
          const minCurrent = semver.minVersion(currentVersionRange)?.version;

          if (minCurrent && semver.gt(latest, minCurrent)) {
            this.logIssue('DEPENDENCY_OUTDATED', {
              name: pkgName,
              current: currentVersionRange,
              latest,
            });
          }
        } catch {
          // Ignore errors like package not found or network issues
        }
      })
    );
  }

  private async scanGitHubMetadata(
    owner: string,
    repo: string,
    metadata?: RepoMetadata | null
  ): Promise<void> {
    const data = metadata || (await getRepoMetadata(owner, repo));
    if (!data) return;

    if (data.homepage !== 'https://linkedin.com/in/orassayag') {
      this.logIssue('GITHUB_HOMEPAGE_MISMATCH', {
        actual: data.homepage || 'none',
      });
    }

    const descLen = data.description?.length || 0;
    if (descLen < 340 || descLen > 350) {
      this.logIssue('GITHUB_DESCRIPTION_LENGTH', { actual: descLen });
    }

    const isStarred = await isRepoStarred(owner, repo);
    if (!isStarred) {
      this.logIssue('GITHUB_STAR_MISSING');
    }

    const isWatched = await isRepoWatched(owner, repo);
    if (!isWatched) {
      this.logIssue('GITHUB_WATCH_MISSING');
    }

    const rulesets = await getRulesets(owner, repo);
    if (rulesets.length === 0) {
      this.logIssue('GITHUB_NO_RULESETS');
    } else {
      const requiredRulesets = ['Protect main branch'];
      for (const name of requiredRulesets) {
        const ruleset = rulesets.find((r) => r.name === name);
        if (!ruleset) {
          this.logIssue('GITHUB_RULESET_MISSING', { rulesetName: name });
        } else if (!ruleset.enforcement) {
          this.logIssue('GITHUB_RULESET_DISABLED', { rulesetName: name });
        } else if (ruleset.enforcement !== 'active') {
          this.logIssue('GITHUB_RULESET_MISCONFIGURED', {
            rulesetName: name,
            expected: 'active',
          });
        }
      }
    }
  }

  private scanFormatters(repoPath: string): void {
    const formatters = [
      {
        name: 'Prettier',
        detect: (dir: string): boolean => {
          const pkg = this.readPkg(dir);
          return (
            existsSync(path.join(dir, '.prettierrc')) ||
            existsSync(path.join(dir, '.prettierrc.json')) ||
            existsSync(path.join(dir, '.prettierrc.js')) ||
            existsSync(path.join(dir, '.prettierrc.yaml')) ||
            existsSync(path.join(dir, '.prettierrc.yml')) ||
            existsSync(path.join(dir, 'prettier.config.js')) ||
            this.hasDep(pkg, 'prettier')
          );
        },
        check: (dir: string): string[] => {
          const bin = this.resolveRunner(dir, 'prettier');
          const r = this.runCmd(`${bin} --check . --log-level warn`, dir);
          return this.parsePrettierCheck(r.combined);
        },
      },
      {
        name: 'ESLint',
        detect: (dir: string): boolean => {
          const pkg = this.readPkg(dir);
          return (
            existsSync(path.join(dir, '.eslintrc')) ||
            existsSync(path.join(dir, '.eslintrc.js')) ||
            existsSync(path.join(dir, '.eslintrc.json')) ||
            existsSync(path.join(dir, 'eslint.config.js')) ||
            existsSync(path.join(dir, 'eslint.config.mjs')) ||
            this.hasDep(pkg, 'eslint')
          );
        },
        check: (dir: string): string[] => {
          const bin = this.resolveRunner(dir, 'eslint');
          // Try without --ext first (for flat config), fallback to --ext for legacy
          let r = this.runCmd(`${bin} --fix-dry-run --format json .`, dir);
          if (r.combined.includes("Invalid option '--ext'")) {
            // Already tried without --ext, if it still fails with that error, something else is wrong
          } else if (r.combined.includes('No files matching the pattern')) {
            // Try with extensions for legacy
            r = this.runCmd(
              `${bin} --fix-dry-run --format json . --ext .js,.jsx,.ts,.tsx,.mjs,.cjs`,
              dir
            );
          }

          try {
            const results = JSON.parse(r.stdout) as Array<{
              filePath: string;
              output?: string;
            }>;
            return results
              .filter((f) => f.output !== undefined)
              .map((f) => path.relative(dir, f.filePath));
          } catch {
            return this.parseEslintOutput(r.combined, dir);
          }
        },
      },
      {
        name: 'Biome',
        detect: (dir: string): boolean =>
          existsSync(path.join(dir, 'biome.json')) ||
          existsSync(path.join(dir, 'biome.jsonc')),
        check: (dir: string): string[] => {
          const bin = this.resolveRunner(dir, '@biomejs/biome');
          const r = this.runCmd(`${bin} format .`, dir);
          return this.parseBiomeOutput(r.combined, dir);
        },
      },
      {
        name: 'Stylelint',
        detect: (dir: string): boolean => {
          const pkg = this.readPkg(dir);
          return (
            existsSync(path.join(dir, '.stylelintrc')) ||
            existsSync(path.join(dir, '.stylelintrc.js')) ||
            existsSync(path.join(dir, '.stylelintrc.json')) ||
            existsSync(path.join(dir, 'stylelint.config.js')) ||
            this.hasDep(pkg, 'stylelint')
          );
        },
        check: (dir: string): string[] => {
          const bin = this.resolveRunner(dir, 'stylelint');
          const r = this.runCmd(
            `${bin} "**/*.{css,scss,less}" --formatter json`,
            dir
          );
          try {
            const results = JSON.parse(r.stdout) as Array<{
              source: string;
              warnings: Array<{ fixable?: boolean }>;
            }>;
            return results
              .filter((f) => f.warnings.some((w) => w.fixable))
              .map((f) => path.relative(dir, f.source));
          } catch {
            return [];
          }
        },
      },
      {
        name: 'rustfmt',
        detect: (dir: string): boolean =>
          existsSync(path.join(dir, 'Cargo.toml')),
        check: (dir: string): string[] => {
          const r = this.runCmd('cargo fmt --check', dir);
          const changed: string[] = [];
          for (const line of r.combined.split('\n')) {
            const m = line.match(/^Diff in (.+) at line/);
            if (m) changed.push(path.relative(dir, m[1] as string));
          }
          return [...new Set(changed)];
        },
      },
      {
        name: 'gofmt',
        detect: (dir: string): boolean => existsSync(path.join(dir, 'go.mod')),
        check: (dir: string): string[] => {
          const r = this.runCmd('gofmt -l .', dir);
          return r.stdout.trim().split('\n').filter(Boolean);
        },
      },
      {
        name: 'Black',
        detect: (dir: string): boolean => {
          if (!existsSync(path.join(dir, 'pyproject.toml'))) return false;
          try {
            return readFileSync(
              path.join(dir, 'pyproject.toml'),
              'utf-8'
            ).includes('[tool.black]');
          } catch {
            return false;
          }
        },
        check: (dir: string): string[] => {
          const r = this.runCmd('black --check .', dir);
          const changed: string[] = [];
          for (const line of r.combined.split('\n')) {
            const m = line.match(/^would reformat (.+)$/);
            if (m) changed.push(path.relative(dir, m[1]!.trim()));
          }
          return changed;
        },
      },
    ];

    for (const fmt of formatters) {
      if (fmt.detect(repoPath)) {
        try {
          const unformatted = fmt.check(repoPath);
          if (unformatted.length > 0) {
            this.logIssue('FORMATTER_UNFORMATTED', {
              formatter: fmt.name,
              count: unformatted.length,
              files: unformatted.map((f: string) => `  - ${f}`).join('\n'),
            });
          }
        } catch (_err) {
          // Ignore formatter errors
        }
      }
    }
  }

  private readPkg(dir: string): Record<string, any> {
    try {
      const pkgPath = path.join(dir, 'package.json');
      return JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      return {};
    }
  }

  private hasDep(pkg: Record<string, any>, name: string): boolean {
    return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
  }

  private resolveRunner(dir: string, pkgName: string): string {
    const binName = pkgName.startsWith('@') ? pkgName.split('/')[1] : pkgName;
    const localBin = path.join(dir, 'node_modules', '.bin', binName);
    if (existsSync(localBin)) return `"${localBin}"`;
    return `npx --yes ${pkgName}`;
  }

  private runCmd(
    cmd: string,
    cwd: string
  ): { stdout: string; combined: string } {
    const result = spawnSync(cmd, {
      cwd,
      shell: true,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    const stdout = (result.stdout as string) || '';
    const stderr = (result.stderr as string) || '';
    return { stdout, combined: stdout + stderr };
  }

  private parsePrettierCheck(output: string): string[] {
    const files: string[] = [];
    const cleanOutput = stripAnsi(output);
    for (const line of cleanOutput.split(/\r?\n/)) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      const m = trimmedLine.match(/\[warn\]\s+(.+)$/);
      if (m && m[1] && !m[1].includes('Code style issues')) {
        const filePath = m[1].trim();
        // Skip pnpm-lock.yaml (regardless to any path level)
        if (
          filePath === 'pnpm-lock.yaml' ||
          filePath.endsWith('/pnpm-lock.yaml') ||
          filePath.endsWith('\\pnpm-lock.yaml')
        ) {
          continue;
        }
        files.push(filePath);
      }
    }
    return files;
  }

  private parseEslintOutput(output: string, repoDir: string): string[] {
    const files = new Set<string>();
    const cleanOutput = stripAnsi(output);
    for (const line of cleanOutput.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(' ') || line.startsWith(' ')) continue;
      if (trimmed.match(/^([A-Za-z]:\\|\/)/)) {
        const rel = path.relative(repoDir, trimmed);
        // Skip coverage folder (regardless to any path level)
        if (
          rel.split(path.sep).includes('coverage') ||
          rel.split('/').includes('coverage') ||
          rel.split('\\').includes('coverage')
        ) {
          continue;
        }
        if (!rel.startsWith('..') && existsSync(trimmed)) {
          files.add(rel);
        }
      }
    }
    return [...files];
  }

  private parseBiomeOutput(output: string, repoDir: string): string[] {
    const files = new Set<string>();
    const cleanOutput = output.replace(/\x1B\[[0-9;]*[JKmsu]/g, '');
    for (const line of cleanOutput.split(/\r?\n/)) {
      const trimmed = line.trim();
      const m = trimmed.match(/^([\w./\\-]+\.(js|ts|jsx|tsx|json|css|scss))/);
      if (m) {
        const candidate = m[1];
        const full = path.resolve(repoDir, candidate);
        if (existsSync(full)) files.add(candidate);
      }
    }
    return [...files];
  }
}
