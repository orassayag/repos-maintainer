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
  getExcludedKnipPackages,
  getExcludedKnipPaths,
  isKnipScanExcluded,
  isKnipUnusedDepsExcluded,
  isOutdatedScanExcluded,
  isLegacyProject,
  isGithubHomepageWarningExcluded,
  getExcludedImportValidationPaths,
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
import {
  isTypeScriptProject,
  isDotNetOrWindowsProject,
} from './projectType.js';

import {
  extractReadmeDescription,
  validateGitHubDescription,
  validatePackageDescription,
  validateReadmeDescription,
  validateKeywords,
} from './description.js';

export interface ScanIssue {
  severity: Severity;
  message: string;
}

export interface RepoScanResult {
  repoName: string;
  issues: ScanIssue[];
  maxSeverity: number; // 1, 2, 3, or 4 (0 if no issues)
  unlistedBinaries?: string[];
}

const INDEX_NAMES = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'index.mjs',
  'index.cjs',
];

const IMPORT_RE =
  /(?:^|\s)(?:import|export)\s+(?:(?:type\s+)?(?:[\w*{},\s]+)\s+from\s+|)['"]([^'"]+)['"]/gm;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

export class Scanner {
  private scanIssues: ScanIssue[] = [];
  private currentRepoName: string = '';
  private foundUnlistedBinaries: string[] = [];

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

  async scanRepo(repo: {
    name: string;
    url: string;
    purpose?: string;
    structure?: string;
    type?: string;
  }): Promise<RepoScanResult> {
    this.scanIssues = [];
    this.foundUnlistedBinaries = [];
    this.currentRepoName = repo.name;
    const repoPath = getLocalRepoPath(repo.name);
    const parsed = parseGitHubUrl(repo.url);
    const excludedPaths = getExcludedPaths(repo.name);

    const isTraining = repo.purpose === 'training';
    const isMulti = repo.structure === 'multi';
    const isActive = repo.type === 'active';

    const isDotNet = await isDotNetOrWindowsProject(repoPath);

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

    const hasTsFiles = await isTypeScriptProject(repoPath);

    for (const rawFile of templateFiles) {
      // Normalize path to use forward slashes for consistent comparison
      const file = rawFile.replace(/\\/g, '/');

      if (excludedPaths.includes(file)) continue;

      // Skip TypeScript template files if no .ts files are found
      const tsTemplateFiles = [
        'tsconfig.json',
        'tsconfig.node.json',
        'vitest.config.ts',
        'eslint.config.mjs',
      ];
      if (tsTemplateFiles.includes(file) && !hasTsFiles) {
        continue;
      }

      // Skip package.json and eslint.config.mjs if it's a training repo
      if (
        (file === 'package.json' || file === 'eslint.config.mjs') &&
        (isTraining || isMulti)
      ) {
        continue;
      }

      // Only for the "active" type project we need to write this issue on the report, otherwise ignore it (on legacy projects)
      // ONLY FOR SPECIFIC "src/index.ts" and ".npmrc", keep the other logic of the validations on template files
      if ((file === 'src/index.ts' || file === '.npmrc') && !isActive) {
        continue;
      }

      const targetFilePath = path.join(repoPath, file);
      try {
        await fs.access(targetFilePath);
        // Verify content for specific files
        await this.verifyFileContent(
          file,
          targetFilePath,
          path.join(templatesDir, rawFile)
        );

        // Requirement: If package.json is detected in a .NET legacy project, report it
        if (file === 'package.json' && isDotNet) {
          this.logToReport('package.json: Detected in .NET legacy project');
        }
      } catch {
        // Requirement: Skip "Missing template file: package.json" for .NET legacy projects
        if (file === 'package.json' && isDotNet) {
          continue;
        }
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

    // 6.1. All MD files duplicate title scan
    if (!isTraining) {
      await this.scanMdDuplicates(repoPath, excludedPaths);
    }

    // 7. package.json deep scan
    let githubMetadata: RepoMetadata | null = null;
    let metadataError: string | null = null;
    if (parsed) {
      try {
        githubMetadata = await getRepoMetadata(parsed.owner, parsed.repo);
      } catch (err) {
        metadataError = (err as Error).message;
        this.logIssue('GITHUB_METADATA_FETCH_FAILED', { error: metadataError });
      }
    }

    const isLegacy = isLegacyProject(this.currentRepoName);

    if (!isTraining) {
      if (isMulti) {
        const pkgPaths = await this.findMultiPackageJsonPaths(repoPath);
        if (pkgPaths.length === 0) {
          this.logIssue('MISSING_TEMPLATE_FILE', {
            file: 'package.json (Missing in all sub-projects)',
          });
        }
        for (const pkgPath of pkgPaths) {
          const relativePkgPath = path.relative(repoPath, pkgPath);
          if (excludedPaths.includes(relativePkgPath)) continue;

          await this.scanPackageJson(
            path.dirname(pkgPath),
            repo.name,
            githubMetadata ? githubMetadata.topics : null,
            relativePkgPath,
            isActive,
            isLegacy
          );
          this.scanPackageJsonSorting(path.dirname(pkgPath), relativePkgPath);
        }
      } else if (!excludedPaths.includes('package.json')) {
        await this.scanPackageJson(
          repoPath,
          repo.name,
          githubMetadata ? githubMetadata.topics : null,
          'package.json',
          isActive,
          isLegacy
        );
        this.scanPackageJsonSorting(repoPath);
      }
    }

    const skipPrettifyAndKnip = isDotNet;

    // 8. Formatter Scan
    if (!skipPrettifyAndKnip) {
      this.scanFormatters(repoPath);
    }

    // 8.1. tsconfig.json types validation (for active repos only)
    if (isActive && hasTsFiles && !excludedPaths.includes('tsconfig.json')) {
      await this.scanTsConfig(repoPath);
    }

    // 9. Lint Scan (via npx if node_modules missing)
    try {
      this.scanLint(repoPath);
    } catch {
      // console.error('Lint Scan Error');
    }

    // 10. ESLint Config Scan
    if (isMulti && !isTraining) {
      const pkgPaths = await this.findMultiPackageJsonPaths(repoPath);
      for (const pkgPath of pkgPaths) {
        this.scanEslintConfig(path.dirname(pkgPath), isTraining, isDotNet);
      }
    } else {
      this.scanEslintConfig(repoPath, isTraining, isDotNet);
    }

    // 11. VSCode Settings Scan
    this.scanVsCodeSettings(repoPath);

    // 13. Test Scan (via npx if node_modules missing)
    try {
      this.scanTests(repoPath, hasTsFiles, skipPrettifyAndKnip);
    } catch {
      // Ignore test scan errors
    }

    // 14. Knip Scan (Unused dependencies/exports)
    if (!skipPrettifyAndKnip) {
      try {
        if (isMulti && !isTraining) {
          const pkgPaths = await this.findMultiPackageJsonPaths(repoPath);
          for (const pkgPath of pkgPaths) {
            this.scanKnip(path.dirname(pkgPath));
          }
        } else {
          this.scanKnip(repoPath);
        }
      } catch {
        // Ignore knip scan errors
      }
    }

    // 14.1. Invalid Import Scan (for active repos only)
    if (isActive) {
      try {
        await this.scanInvalidImports(repoPath);
      } catch {
        // Ignore import scan errors
      }
    }

    // 15. GitHub Metadata Scan
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

    const rootPath = getLocalRepoPath(this.currentRepoName);
    const relativePathToRoot = path.relative(rootPath, repoPath);
    const prefix =
      relativePathToRoot && relativePathToRoot !== '.'
        ? `${relativePathToRoot}: `
        : '';

    const isPnpm = existsSync(path.join(repoPath, 'pnpm-lock.yaml'));
    const baseCommand = isPnpm ? 'pnpm dlx knip' : 'npx --yes knip';

    // Use --directory to point to the repo path and run from current directory
    const relativePath = path.relative(process.cwd(), repoPath);
    let command = `${baseCommand} --directory "${relativePath}"`;

    if (isKnipUnusedDepsExcluded(this.currentRepoName)) {
      command += ' --no-dependencies';
    }

    const knipExcludedPaths = getExcludedKnipPaths(this.currentRepoName);
    const globalExcludedPaths = getExcludedPaths(this.currentRepoName);
    const allExcludedPaths = [
      ...new Set([...knipExcludedPaths, ...globalExcludedPaths]),
    ];

    if (allExcludedPaths.length > 0) {
      for (const p of allExcludedPaths) {
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
      const isLegacy = isLegacyProject(this.currentRepoName);

      const pushCategory = (): void => {
        if (currentHeader && categoryIssues.length > 0) {
          let shouldSkipCategory = false;
          // For Legacy projects, skip "Unused dependencies" if they only contain "Unresolved imports"
          // Also skip "Unresolved imports" category entirely for Legacy projects
          if (isLegacy) {
            if (currentHeader.includes('Unused dependencies')) {
              const hasOnlyUnresolvedImports = categoryIssues.every((i) =>
                i.includes('Unresolved imports')
              );
              if (hasOnlyUnresolvedImports) {
                shouldSkipCategory = true;
              }
            } else if (currentHeader.includes('Unresolved imports')) {
              shouldSkipCategory = true;
            }
          }

          if (!shouldSkipCategory) {
            issues.push(currentHeader);
            issues.push(...categoryIssues.map((i) => `  ${i}`));
          }
        }
      };

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const isHeader =
          (trimmed.includes('Unused') ||
            trimmed.includes('Unlisted') ||
            trimmed.includes('Unresolved') ||
            trimmed.includes('Duplicate')) &&
          !trimmed.startsWith('-');

        if (isHeader) {
          pushCategory();
          currentHeader = trimmed;
          categoryIssues = [];
        } else {
          // Check if line contains any excluded package
          const isPkgExcluded = excludedPackages.some((pkgName) =>
            trimmed.includes(pkgName)
          );
          if (isPkgExcluded) continue;

          // If this is an unlisted binary, collect it
          if (currentHeader.includes('Unlisted binaries')) {
            // Usually looks like "- taskkill  package.json" or "  taskkill  package.json"
            const binaryMatch = trimmed.match(/^(?:-\s+)?([^\s]+)/);
            if (binaryMatch) {
              this.foundUnlistedBinaries.push(binaryMatch[1]);
            }
          }

          // Check if line contains any excluded path
          const isPathExcluded = allExcludedPaths.some((p) => {
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

      pushCategory();

      if (issues.length > 0) {
        this.logIssue('KNIP_ISSUES', {
          prefix,
          issues: issues.map((i) => `  - ${i}`).join('\n'),
        });
      }
    } else if (
      result.combined.toLowerCase().includes('error') &&
      !result.combined.includes('No issues found')
    ) {
      this.logIssue('KNIP_COMMAND_FAILED', { prefix, command });
    }
  }

  private async scanInvalidImports(repoPath: string): Promise<void> {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    const files = await this.getAllFiles(repoPath);
    const excludedImportPaths = getExcludedImportValidationPaths();

    const targetFiles = files.filter((f) => {
      if (!extensions.includes(path.extname(f))) return false;

      // Check if file is in an excluded path
      const isExcluded = excludedImportPaths.some(
        (excluded) => f === excluded || f.startsWith(excluded + path.sep)
      );
      return !isExcluded;
    });

    for (const relPath of targetFiles) {
      const filePath = path.join(repoPath, relPath);
      // Skip index files themselves
      if (INDEX_NAMES.includes(path.basename(filePath))) continue;

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const violations: number[] = [];

        const check = (match: RegExpExecArray, importPath: string): void => {
          if (!importPath.startsWith('.') && !importPath.startsWith('..'))
            return;

          const fileDir = path.dirname(filePath);
          const bare = this.stripExtension(importPath, extensions);
          const base = path.basename(bare);

          if (base === 'index') return;

          const abs = path.resolve(fileDir, bare);

          // Check if it's a direct file import
          let isDirect = false;
          try {
            readFileSync(abs); // Check if file exists (sync is easier here)
            isDirect = true;
          } catch {
            // Not found as is, try with extensions
            for (const ext of extensions) {
              try {
                readFileSync(abs + ext);
                isDirect = true;
                break;
              } catch {
                /* ignore */
              }
            }
          }

          if (!isDirect) return;

          // Check if the directory has an index file
          const importedDir = path.dirname(abs);
          const hasIndex = INDEX_NAMES.some((name) =>
            existsSync(path.join(importedDir, name))
          );

          if (hasIndex) {
            // Find line number
            const offset = match.index ?? 0;
            let acc = 0;
            for (let i = 0; i < lines.length; i++) {
              if (acc + lines[i].length + 1 > offset) {
                violations.push(i + 1);
                break;
              }
              acc += lines[i].length + 1;
            }
          }
        };

        let m: RegExpExecArray | null;
        IMPORT_RE.lastIndex = 0;
        while ((m = IMPORT_RE.exec(content)) !== null) {
          check(m, m[1]);
        }
        REQUIRE_RE.lastIndex = 0;
        while ((m = REQUIRE_RE.exec(content)) !== null) {
          check(m, m[1]);
        }

        if (violations.length > 0) {
          this.logIssue('INVALID_IMPORT', {
            file: relPath,
            lines: [...new Set(violations)].join(', '),
          });
        }
      } catch {
        /* ignore file read errors */
      }
    }
  }

  private stripExtension(p: string, exts: string[]): string {
    for (const ext of exts) {
      if (p.endsWith(ext)) return p.slice(0, -ext.length);
    }
    return p;
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
      unlistedBinaries: [...new Set(this.foundUnlistedBinaries)],
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
    } else if (fileName === '.npmrc') {
      if (!targetContent.includes('minimum-release-age=0')) {
        this.logIssue('FILE_CONTENT_MISMATCH', { file: fileName });
      }
    } else if (
      fileName === 'CODE_OF_CONDUCT.md' ||
      fileName === 'SECURITY.md'
    ) {
      if (!targetContent.includes(templateContent.trim())) {
        this.logIssue('FILE_CONTENT_MISMATCH', { file: fileName });
      }
    } else if (fileName === 'LICENSE') {
      // Ignore year in LICENSE. Target has 4-digit year or range, template has #YEAR#
      const yearRegex = /\d{4}(-\d{4})?/g;
      const targetNoYear = targetContent.replace(yearRegex, 'YEAR');
      const templateNoYear = templateContent.replace(/#YEAR#/g, 'YEAR');
      if (targetNoYear.trim() !== templateNoYear.trim()) {
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

      const description = extractReadmeDescription(content);
      const validationResult = validateReadmeDescription(description);

      if (validationResult !== true) {
        this.logIssue('README_DESCRIPTION_LENGTH', {
          actualLen: description.length,
          min: 500,
          max: 600,
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

      // Check for emoji bullet points in Features section
      const featuresMatch = content.match(
        /#+ Features\s+([\s\S]*?)(?:\n#+|$)/i
      );
      if (featuresMatch) {
        const featuresContent = featuresMatch[1].trim();
        const featureLines = featuresContent
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l !== '');

        // Find the first list in the features section
        const listItems = featureLines.filter((l) => l.startsWith('-'));

        if (listItems.length > 0) {
          const allHaveEmojis = listItems.every((line) =>
            /\p{Emoji_Presentation}|\p{Extended_Pictographic}/u.test(line)
          );
          if (!allHaveEmojis) {
            this.logIssue('README_FEATURES_EMOJIS');
          }
        } else {
          this.logIssue('README_FEATURES_EMOJIS');
        }
      }
    } catch {
      // Already reported
    }
  }

  private async scanTsConfig(repoPath: string): Promise<void> {
    const tsconfigPath = path.join(repoPath, 'tsconfig.json');
    try {
      const content = await fs.readFile(tsconfigPath, 'utf-8');
      const tsconfig = JSON.parse(content);
      const types = tsconfig.compilerOptions?.types;

      const expectedTypes = ['node', 'vitest'];
      const isIdentical =
        Array.isArray(types) &&
        types.length === expectedTypes.length &&
        types.every((t, i) => t === expectedTypes[i]);

      if (!isIdentical) {
        this.logIssue('TSCONFIG_TYPES_MISMATCH', { file: 'tsconfig.json' });
      }
    } catch {
      // If it fails to read or parse, it's likely already caught by MISSING_TEMPLATE_FILE
      // or it's just invalid JSON, which we don't handle specifically here.
    }
  }

  private async scanPackageJson(
    repoPath: string,
    repoName: string,
    githubTopics: string[] | null = null,
    relativePath: string = 'package.json',
    isActive: boolean = true,
    isLegacy: boolean = false
  ): Promise<void> {
    const filePath = path.join(repoPath, 'package.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const pkg = JSON.parse(content);

      let expectedName = repoName;
      if (relativePath !== 'package.json') {
        const folderName = path.basename(repoPath);
        expectedName = `${repoName}-${folderName}`;
      }

      if (pkg.name !== expectedName && pkg.name !== repoName)
        this.logToReport(
          `${relativePath}: "name" should be "${expectedName}"`,
          Severity.MEDIUM
        );

      if (pkg.private === true) {
        this.logIssue('PACKAGE_JSON_PRIVATE', { file: relativePath });
      }

      // Author Validation
      const expectedAuthor = {
        name: 'Or Assayag',
        email: 'orassayag@gmail.com',
        url: 'https://github.com/orassayag',
      };
      if (!pkg.author) {
        this.logIssue('PACKAGE_JSON_MISSING_AUTHOR', { file: relativePath });
      } else if (
        typeof pkg.author !== 'object' ||
        pkg.author.name !== expectedAuthor.name ||
        pkg.author.email !== expectedAuthor.email ||
        pkg.author.url !== expectedAuthor.url
      ) {
        this.logIssue('PACKAGE_JSON_AUTHOR_MISMATCH', {
          file: relativePath,
          expectedAuthor: JSON.stringify(expectedAuthor, null, 2),
        });
      }

      if (pkg.license !== 'MIT') {
        this.logIssue('PACKAGE_JSON_LICENSE_MISMATCH', { file: relativePath });
      }

      const expectedRepoUrl = `git://github.com/orassayag/${repoName}.git`;
      if (
        !pkg.repository ||
        pkg.repository.type !== 'git' ||
        pkg.repository.url !== expectedRepoUrl
      ) {
        this.logIssue('PACKAGE_JSON_REPO_URL_MISMATCH', {
          file: relativePath,
          expectedRepoUrl,
        });
      }

      // Homepage Validation
      const expectedHomepage = `https://github.com/orassayag/${repoName}#readme`;
      if (!pkg.homepage) {
        this.logIssue('PACKAGE_JSON_MISSING_HOMEPAGE', { file: relativePath });
      } else if (pkg.homepage !== expectedHomepage) {
        this.logIssue('PACKAGE_JSON_HOMEPAGE_MISMATCH', {
          file: relativePath,
          expectedHomepage,
        });
      }

      // Bugs Validation
      const expectedBugsUrl = `https://github.com/orassayag/${repoName}/issues`;
      if (!pkg.bugs) {
        this.logIssue('PACKAGE_JSON_MISSING_BUGS', { file: relativePath });
      } else if (!pkg.bugs.url || pkg.bugs.url !== expectedBugsUrl) {
        this.logIssue('PACKAGE_JSON_BUGS_MISMATCH', {
          file: relativePath,
          expectedBugsUrl,
        });
      }

      // Funding Validation
      const expectedFunding = {
        type: 'github',
        url: 'https://github.com/sponsors/orassayag',
      };
      if (!pkg.funding) {
        this.logIssue('PACKAGE_JSON_MISSING_FUNDING', { file: relativePath });
      } else if (
        typeof pkg.funding !== 'object' ||
        pkg.funding.type !== expectedFunding.type ||
        pkg.funding.url !== expectedFunding.url
      ) {
        this.logIssue('PACKAGE_JSON_FUNDING_MISMATCH', { file: relativePath });
      }

      // Engines Validation
      if (isActive) {
        if (!pkg.engines) {
          this.logIssue('PACKAGE_JSON_MISSING_ENGINES', { file: relativePath });
        } else if (
          typeof pkg.engines !== 'object' ||
          Object.keys(pkg.engines).length === 0
        ) {
          this.logIssue('PACKAGE_JSON_ENGINES_MISMATCH', {
            file: relativePath,
          });
        }
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
        this.logIssue('PACKAGE_JSON_MISSING_CONTRIBUTOR', {
          file: relativePath,
        });
      }

      if (!pkg.main || pkg.main.trim() === '') {
        this.logIssue('PACKAGE_JSON_MISSING_MAIN', { file: relativePath });
      } else {
        // Normalize to forward slashes for consistent check
        const normalizedMain = pkg.main.replace(/\\/g, '/');
        // Strict check: if the file doesn't exist, it's invalid.
        try {
          await fs.access(path.join(repoPath, normalizedMain));
        } catch {
          this.logIssue('PACKAGE_JSON_INVALID_MAIN', {
            file: relativePath,
            path: pkg.main,
          });
        }
      }
      if (isActive || isLegacy) {
        if (!pkg.type)
          this.logIssue('PACKAGE_JSON_MISSING_TYPE', { file: relativePath });
        if (!pkg.scripts)
          this.logIssue('PACKAGE_JSON_MISSING_SCRIPTS', { file: relativePath });
      }

      // START OF TEMPORARY SCAN LOGIC
      // TODO: This logic is temporary and should be removed once the script migration is complete.
      // If the "start:live" script exists in package.json, log a warning with severity level 1.
      if (pkg.scripts && pkg.scripts['start:live']) {
        this.logToReport(
          `${relativePath}: Possible invalid scripts`,
          Severity.HIGH
        );
      }
      // END OF TEMPORARY SCAN LOGIC

      if (!pkg.files || !Array.isArray(pkg.files) || pkg.files.length === 0) {
        this.logIssue('PACKAGE_JSON_MISSING_FILES', { file: relativePath });
      } else {
        const rootEntries = await fs.readdir(repoPath, { withFileTypes: true });
        const rootItems = rootEntries
          .filter(
            (e) =>
              e.name !== '.git' &&
              e.name !== 'node_modules' &&
              e.name !== 'coverage'
          )
          .map((e) => e.name);

        const sortedRootItems = [...rootEntries]
          .filter(
            (e) =>
              e.name !== '.git' &&
              e.name !== 'node_modules' &&
              e.name !== 'coverage'
          )
          .sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1;
            if (!a.isDirectory() && b.isDirectory()) return 1;
            return a.name.localeCompare(b.name, undefined, {
              numeric: true,
              sensitivity: 'base',
            });
          })
          .map((e) => e.name);

        const pkgFiles = pkg.files;

        const isIdentical =
          pkgFiles.length === rootItems.length &&
          pkgFiles.every((file: string) => rootItems.includes(file));

        if (!isIdentical) {
          const missing = rootItems
            .filter((f: string) => !pkgFiles.includes(f))
            .join(', ');
          const extra = pkgFiles
            .filter((f: string) => !rootItems.includes(f))
            .join(', ');

          this.logIssue('PACKAGE_JSON_FILES_NOT_IDENTICAL', {
            file: relativePath,
            missing: missing || 'none',
            extra: extra || 'none',
          });
        } else {
          const isSorted = pkgFiles.every(
            (file: string, index: number) => file === sortedRootItems[index]
          );
          if (!isSorted) {
            this.logIssue('PACKAGE_JSON_FILES_NOT_SORTED', {
              file: relativePath,
            });
          }
        }
      }
      const skipOutdated = isOutdatedScanExcluded(this.currentRepoName);

      if (isActive || isLegacy) {
        if (!pkg.dependencies) {
          this.logIssue('PACKAGE_JSON_MISSING_DEPENDENCIES', {
            file: relativePath,
          });
        } else if (!skipOutdated) {
          await this.checkDependenciesVersion(pkg.dependencies);
        }

        if (!pkg.devDependencies) {
          this.logIssue('PACKAGE_JSON_MISSING_DEV_DEPENDENCIES', {
            file: relativePath,
          });
        } else if (!skipOutdated) {
          await this.checkDependenciesVersion(pkg.devDependencies);
        }
      }

      const keywords = pkg.keywords || [];
      const keywordsValidation = validateKeywords(keywords);
      if (keywordsValidation !== true) {
        this.logIssue('PACKAGE_JSON_KEYWORDS_COUNT', {
          file: relativePath,
          actualCount: keywords.length,
        });
      }

      // Keywords vs GitHub Topics Validation
      if (keywords.length > 0 && githubTopics !== null) {
        const sortedKeywords = [...keywords].sort();
        const sortedTopics = [...githubTopics].sort();

        const areEqual =
          sortedKeywords.length === sortedTopics.length &&
          sortedKeywords.every((kw, i) => kw === sortedTopics[i]);

        if (!areEqual) {
          this.logIssue('PACKAGE_JSON_KEYWORDS_MISMATCH', {
            file: relativePath,
            expected: keywords.join(', '),
            found: githubTopics.join(', ') || 'none',
          });
        }
      }

      const pkgDesc = pkg.description || '';
      const pkgDescValidation = validatePackageDescription(pkgDesc);
      if (pkgDescValidation !== true) {
        this.logIssue('PACKAGE_JSON_DESCRIPTION_LENGTH', {
          file: relativePath,
          actualLen: pkgDesc.length,
          min: 290,
          max: 300,
        });
      }
    } catch {
      // Already reported
    }
  }

  private scanPackageJsonSorting(
    repoPath: string,
    relativePath: string = 'package.json'
  ): void {
    const pkgPath = path.join(repoPath, 'package.json');
    if (!existsSync(pkgPath)) return;

    try {
      const result = this.runCmd(
        'npx --yes sort-package-json --check',
        repoPath
      );
      if (result.combined.includes('is not sorted')) {
        this.logIssue('PACKAGE_JSON_UNSORTED', { file: relativePath });
      }
    } catch {
      // Ignore errors
    }
  }

  public async findMultiPackageJsonPaths(repoPath: string): Promise<string[]> {
    const pkgPaths: string[] = [];

    // 1. Check root-level folders
    const entries = await fs.readdir(repoPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const pkgPath = path.join(repoPath, entry.name, 'package.json');
        if (existsSync(pkgPath)) {
          pkgPaths.push(pkgPath);
        }
      }
    }

    // 2. If none found, check inside "src" folder
    if (pkgPaths.length === 0) {
      const srcPath = path.join(repoPath, 'src');
      if (existsSync(srcPath)) {
        const srcEntries = await fs.readdir(srcPath, { withFileTypes: true });
        for (const entry of srcEntries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const pkgPath = path.join(srcPath, entry.name, 'package.json');
            if (existsSync(pkgPath)) {
              pkgPaths.push(pkgPath);
            }
          }
        }
      }
    }

    return pkgPaths;
  }

  private scanTests(
    repoPath: string,
    isTypeScript: boolean,
    skipVitestConfigCheck = false
  ): void {
    const pkg = this.readPkg(repoPath);
    if (!pkg.scripts?.test) return;

    const hasVitestConfig = existsSync(path.join(repoPath, 'vitest.config.ts'));
    if (!hasVitestConfig) {
      if (!skipVitestConfigCheck && isTypeScript) {
        this.logIssue('VITEST_CONFIG_MISSING');
      }
      return;
    }

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
      const excludedPaths = getExcludedPaths(this.currentRepoName);

      const issues = cleanCombined
        .split('\n')
        .filter((line) => {
          const isIssue = line.includes('error') || line.includes('warning');
          if (!isIssue) return false;

          if (excludedPaths.length > 0) {
            const isExcluded = excludedPaths.some(
              (p) =>
                line.includes(p + '/') ||
                line.includes(p + '\\') ||
                line.includes(' ' + p + ':') ||
                line.includes(' ' + p + ' ')
            );
            if (isExcluded) return false;
          }
          return true;
        })
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

  private scanEslintConfig(
    repoPath: string,
    isTraining: boolean,
    isDotNet: boolean = false
  ): void {
    const legacyFiles = [
      'eslintrc.json',
      '.eslintrc.json',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.yaml',
      '.eslintrc.yml',
      '.eslintrc',
    ];
    const hasLegacyConfig = legacyFiles.some((file) =>
      existsSync(path.join(repoPath, file))
    );
    const hasFlatConfig = existsSync(path.join(repoPath, 'eslint.config.mjs'));

    const relativePath = path.relative(
      getLocalRepoPath(this.currentRepoName),
      repoPath
    );
    const prefix =
      relativePath && relativePath !== '.' ? `${relativePath}: ` : '';

    if (!hasLegacyConfig && !hasFlatConfig) {
      if (!isTraining && !isDotNet) {
        this.logIssue('ESLINT_CONFIG_MISSING', { prefix });
      }
    } else if (hasLegacyConfig && !hasFlatConfig) {
      // If project is Legacy, we don't care about migrating to flat config
      if (!isLegacyProject(this.currentRepoName)) {
        this.logIssue('ESLINT_LEGACY_CONFIG', { prefix });
      }
    }

    // If flat config exists, check for required packages
    if (hasFlatConfig) {
      const pkg = this.readPkg(repoPath);
      const requiredPackages = ['eslint-config-prettier', 'typescript-eslint'];
      const missing = requiredPackages.filter((p) => !this.hasDep(pkg, p));

      if (missing.length > 0) {
        this.logIssue('ESLINT_FLAT_CONFIG_MISSING_PACKAGES', {
          prefix,
          packages: missing.join(', '),
        });
      }
    }
  }

  private scanVsCodeSettings(repoPath: string): void {
    const settingsPath = path.join(repoPath, '.vscode', 'settings.json');
    if (existsSync(settingsPath)) {
      try {
        const content = readFileSync(settingsPath, 'utf-8');
        const settings = JSON.parse(content);
        if (!settings['cSpell.ignorePaths']) {
          this.logIssue('VSCODE_SETTINGS_MISSING_CSPELL_IGNORE_PATHS');
        }
      } catch {
        // If JSON is malformed, we might want to log it, but for now just ignore
      }
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

    if (
      data.homepage !== 'https://linkedin.com/in/orassayag' &&
      !isGithubHomepageWarningExcluded(this.currentRepoName)
    ) {
      this.logIssue('GITHUB_HOMEPAGE_MISMATCH', {
        actual: data.homepage || 'none',
      });
    }

    const githubDesc = data.description || '';
    const githubDescValidation = validateGitHubDescription(githubDesc);
    if (githubDescValidation !== true) {
      this.logIssue('GITHUB_DESCRIPTION_LENGTH', { actual: githubDesc.length });
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
          const r = this.runCmd(`${bin} --check .`, dir);
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
              .map((f) => path.relative(dir, f.filePath))
              .filter((rel) => {
                // Skip coverage folder (regardless to any path level)
                const parts = rel.split(/[\\/]/);
                return !parts.includes('coverage');
              });
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
          let unformatted = fmt.check(repoPath);

          // Filter excluded paths
          const excludedPaths = getExcludedPaths(this.currentRepoName);
          if (excludedPaths.length > 0) {
            unformatted = unformatted.filter((file) => {
              return !excludedPaths.some(
                (excluded) =>
                  file === excluded ||
                  file.startsWith(excluded + '/') ||
                  file.startsWith(excluded + '\\')
              );
            });
          }

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
        const excludedFiles = [
          'pnpm-lock.yaml',
          'pnpm-workspace.yaml',
          'package-lock.json',
        ];

        const isExcluded = excludedFiles.some(
          (excluded) =>
            filePath === excluded ||
            filePath.endsWith(`/${excluded}`) ||
            filePath.endsWith(`\\${excluded}`)
        );

        if (isExcluded) {
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

  private async scanMdDuplicates(
    repoPath: string,
    excludedPaths: string[]
  ): Promise<void> {
    const files = await this.getAllFiles(repoPath);
    const mdFiles = files.filter((f) => {
      const lowerF = f.toLowerCase();
      if (!lowerF.endsWith('.md')) return false;

      // Skip common ignored directories that might not be caught by getAllFiles
      const parts = f.split(/[\\/]/);
      const ignoredDirs = ['node_modules', '.git', 'dist', 'build', 'coverage'];
      if (parts.some((part) => ignoredDirs.includes(part))) return false;

      return !excludedPaths.some((p) => f === p || f.startsWith(p + '/'));
    });

    for (const relPath of mdFiles) {
      const filePath = path.join(repoPath, relPath);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const headings = this.parseMdHeadings(content);
        const duplicates = this.findMdDuplicates(headings);

        for (const dup of duplicates) {
          this.logIssue('DUPLICATE_MD_TITLE', {
            file: relPath,
            title: dup.text,
            level: dup.level,
            lines: dup.lines.join(', '),
          });
        }
      } catch {
        // Ignore file read errors
      }
    }
  }

  private parseMdHeadings(content: string): {
    line: number;
    level: number;
    text: string;
  }[] {
    const headings: { line: number; level: number; text: string }[] = [];
    const lines = content.split('\n');

    let inFencedBlock = false;
    let fenceChar = '';

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];

      // Track fenced code blocks so we skip headings inside them
      const fenceMatch = raw.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        if (!inFencedBlock) {
          inFencedBlock = true;
          fenceChar = fenceMatch[1][0];
        } else if (
          raw
            .trimEnd()
            .split('')
            .every((c) => c === fenceChar)
        ) {
          inFencedBlock = false;
          fenceChar = '';
        }
        continue;
      }

      if (inFencedBlock) continue;

      // ATX heading: optional leading spaces (up to 3), 1-6 #, at least one space
      const match = raw.match(/^#{1,6}(?=\s)/);
      if (!match) continue;

      const level = match[0].length;
      // Strip optional trailing hashes and whitespace
      const text = raw
        .slice(level)
        .trim()
        .replace(/\s+#+\s*$/, '')
        .trim();

      if (text.length === 0) continue; // skip blank headings

      headings.push({ line: i + 1, level, text });
    }

    return headings;
  }

  private findMdDuplicates(
    headings: { line: number; level: number; text: string }[]
  ): { level: number; text: string; lines: number[] }[] {
    const index = new Map<
      string,
      { text: string; level: number; lines: number[] }
    >();

    for (const h of headings) {
      const key = `${h.level}:${h.text.toLowerCase()}`;

      if (!index.has(key)) {
        index.set(key, { text: h.text, level: h.level, lines: [] });
      }
      index.get(key)!.lines.push(h.line);
    }

    const duplicates: { level: number; text: string; lines: number[] }[] = [];
    for (const entry of index.values()) {
      if (entry.lines.length > 1) {
        duplicates.push({
          level: entry.level,
          text: entry.text,
          lines: entry.lines,
        });
      }
    }

    // Sort by first occurrence for deterministic output
    duplicates.sort((a, b) => a.lines[0] - b.lines[0]);

    return duplicates;
  }
}
