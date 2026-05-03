import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { getLocalRepoPath } from '../settings.js';
import {
  parseGitHubUrl,
  getRepoMetadata,
  isRepoStarred,
  isRepoWatched,
  getRulesets,
} from '../github.js';
import { normalizeToTitle } from './stringUtils.js';

export enum Severity {
  HIGH = '1 - High - Most critical - Fix ASAP',
  MEDIUM = '2 - Medium - Need to be addressed',
  LOW = '3 - Low - Fix when have time, nice to have',
  VERY_LOW = '4 - Very Low - Minor issues',
}

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

  async scanRepo(repo: { name: string; url: string }): Promise<RepoScanResult> {
    this.scanIssues = [];
    const repoPath = getLocalRepoPath(repo.name);
    const parsed = parseGitHubUrl(repo.url);

    // 1. Local existence
    try {
      await fs.access(repoPath);
    } catch {
      this.logToReport(
        `Project NOT found locally at ${repoPath}`,
        Severity.HIGH
      );
      return this.getResult(repo.name);
    }

    // 2. Git sync
    const gitPath = path.join(repoPath, '.git');
    try {
      await fs.access(gitPath);
    } catch {
      this.logToReport(
        `Project is NOT synced with git (.git folder missing)`,
        Severity.HIGH
      );
    }

    // 3. File comparison with GitHub
    try {
      const status = execSync('git status --porcelain', {
        cwd: repoPath,
        stdio: 'pipe',
      }).toString();
      if (status.trim().length > 0) {
        this.logToReport(
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
      if (
        remoteStatus.includes('[ahead ') ||
        remoteStatus.includes('[behind ')
      ) {
        this.logToReport(
          `Project is NOT in sync with remote branch (${branch}): ${remoteStatus.split('\n')[0]}`,
          Severity.HIGH
        );
      }
    } catch (err) {
      this.logToReport(
        `Failed to run git status: ${(err as Error).message}`,
        Severity.HIGH
      );
    }

    // 4. Template Scan
    const templatesDir = path.join(process.cwd(), 'src', 'templates');
    let templateFiles: string[] = [];
    try {
      templateFiles = await fs.readdir(templatesDir);
    } catch {
      // templates dir might not exist in some contexts (e.g. built app)
      // but in this project it should.
    }

    for (const file of templateFiles) {
      if (file === 'node_modules') continue;
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
        this.logToReport(`Missing template file: ${file}`, Severity.MEDIUM);
      }
    }

    // 5. INSTRUCTIONS.md deep scan
    await this.scanInstructionsFile(repoPath);

    // 6. README.md deep scan
    await this.scanReadmeFile(repoPath, repo.name);

    // 7. package.json deep scan
    await this.scanPackageJson(repoPath, repo.name);

    // 8. Formatter Scan
    this.scanFormatters(repoPath);

    // 9. GitHub Metadata Scan
    if (parsed) {
      try {
        await this.scanGitHubMetadata(parsed.owner, parsed.repo);
      } catch {
        // Ignore metadata errors in bulk scan to avoid stopping
      }
    }

    const result = this.getResult(repo.name);
    return result;
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
        this.logToReport(
          `${fileName} content is incomplete or doesn't match template.`,
          severity
        );
      }
    } else if (fileName === 'LICENSE') {
      // Ignore year in LICENSE
      const targetNoYear = targetContent.replace(/\d{4}/g, 'YEAR');
      const templateNoYear = templateContent.replace(/\d{4}/g, 'YEAR');
      if (!targetNoYear.includes(templateNoYear.trim())) {
        this.logToReport(
          `LICENSE content is incomplete or doesn't match template.`,
          Severity.MEDIUM
        );
      }
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
          this.logToReport(
            `INSTRUCTIONS.md: Missing section "${section}"`,
            Severity.LOW
          );
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
        this.logToReport(
          `README.md: First section should be similar to "${expectedTitle}" (found "${actualTitle}")`,
          Severity.LOW
        );
      }

      const description = lines[1]?.trim() || '';
      const descLen = description.length;
      if (descLen < 120 || descLen > 350) {
        this.logToReport(
          `README.md: Description length is ${descLen} (expected 120-350 chars)`,
          Severity.LOW
        );
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
          this.logToReport(
            `README.md: Missing section "${section}"`,
            Severity.LOW
          );
        }
      }
    } catch {
      // Already reported
    }
  }

  private async scanPackageJson(
    repoPath: string,
    repoName: string
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
        this.logToReport(`package.json: Missing "author" key`, Severity.MEDIUM);
      } else if (
        typeof pkg.author !== 'object' ||
        pkg.author.name !== expectedAuthor.name ||
        pkg.author.email !== expectedAuthor.email ||
        pkg.author.url !== expectedAuthor.url
      ) {
        this.logToReport(
          `package.json: "author" should be ${JSON.stringify(expectedAuthor, null, 2)}`,
          Severity.MEDIUM
        );
      }

      if (pkg.license !== 'MIT')
        this.logToReport(
          `package.json: "license" should be "MIT"`,
          Severity.MEDIUM
        );

      const expectedRepoUrl = `git://github.com/orassayag/${repoName}.git`;
      if (
        !pkg.repository ||
        pkg.repository.type !== 'git' ||
        pkg.repository.url !== expectedRepoUrl
      ) {
        this.logToReport(
          `package.json: "repository" should be { "type": "git", "url": "${expectedRepoUrl}" }`,
          Severity.MEDIUM
        );
      }

      // Homepage Validation
      const expectedHomepage = `https://github.com/orassayag/${repoName}#readme`;
      if (!pkg.homepage) {
        this.logToReport(
          `package.json: Missing "homepage" key`,
          Severity.MEDIUM
        );
      } else if (pkg.homepage !== expectedHomepage) {
        this.logToReport(
          `package.json: "homepage" should be "${expectedHomepage}"`,
          Severity.MEDIUM
        );
      }

      // Bugs Validation
      const expectedBugsUrl = `https://github.com/orassayag/${repoName}/issues`;
      if (!pkg.bugs) {
        this.logToReport(`package.json: Missing "bugs" key`, Severity.MEDIUM);
      } else if (!pkg.bugs.url || pkg.bugs.url !== expectedBugsUrl) {
        this.logToReport(
          `package.json: "bugs" should be { "url": "${expectedBugsUrl}" }`,
          Severity.MEDIUM
        );
      }

      // Funding Validation
      const expectedFunding = {
        type: 'github',
        url: 'https://github.com/sponsors/orassayag',
      };
      if (!pkg.funding) {
        this.logToReport(
          `package.json: Missing "funding" key`,
          Severity.MEDIUM
        );
      } else if (
        typeof pkg.funding !== 'object' ||
        pkg.funding.type !== expectedFunding.type ||
        pkg.funding.url !== expectedFunding.url
      ) {
        this.logToReport(
          `package.json: "funding" should be ${JSON.stringify(expectedFunding, null, 2)}`,
          Severity.MEDIUM
        );
      }

      // Engines Validation
      if (!pkg.engines) {
        this.logToReport(
          `package.json: Missing "engines" key`,
          Severity.MEDIUM
        );
      } else if (
        typeof pkg.engines !== 'object' ||
        Object.keys(pkg.engines).length === 0
      ) {
        this.logToReport(
          `package.json: "engines" should contain node and npm/pnpm versions`,
          Severity.MEDIUM
        );
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
      if (!hasContributor)
        this.logToReport(
          `package.json: Missing or incorrect "contributors" entry for Or Assayag`,
          Severity.MEDIUM
        );

      if (!pkg.main)
        this.logToReport(`package.json: Missing "main" field`, Severity.MEDIUM);
      if (!pkg.type)
        this.logToReport(`package.json: Missing "type" field`, Severity.MEDIUM);
      if (!pkg.scripts)
        this.logToReport(
          `package.json: Missing "scripts" section`,
          Severity.MEDIUM
        );
      if (!pkg.files || !Array.isArray(pkg.files) || pkg.files.length === 0)
        this.logToReport(
          `package.json: Missing or empty "files" section`,
          Severity.MEDIUM
        );
      if (!pkg.dependencies)
        this.logToReport(
          `package.json: Missing "dependencies" section`,
          Severity.MEDIUM
        );
      if (!pkg.devDependencies)
        this.logToReport(
          `package.json: Missing "devDependencies" section`,
          Severity.MEDIUM
        );

      const keywords = pkg.keywords || [];
      if (keywords.length < 8 || keywords.length > 20) {
        this.logToReport(
          `package.json: Keywords count is ${keywords.length} (expected 8-20 unique items)`,
          Severity.MEDIUM
        );
      }

      const descLen = pkg.description?.length || 0;
      if (descLen < 120 || descLen > 300) {
        this.logToReport(
          `package.json: Description length is ${descLen} (expected 120-300 chars)`,
          Severity.MEDIUM
        );
      }
    } catch {
      // Already reported
    }
  }

  private async scanGitHubMetadata(owner: string, repo: string): Promise<void> {
    const metadata = await getRepoMetadata(owner, repo);
    if (!metadata) return;

    if (metadata.homepage !== 'https://linkedin.com/in/orassayag') {
      this.logToReport(
        `GitHub: Homepage should be "https://linkedin.com/in/orassayag" (found "${metadata.homepage}")`,
        Severity.LOW
      );
    }

    const descLen = metadata.description?.length || 0;
    if (descLen < 340 || descLen > 350) {
      this.logToReport(
        `GitHub: Description length should be 340-350 chars (current: ${descLen})`,
        Severity.LOW
      );
    }

    const isStarred = await isRepoStarred(owner, repo);
    if (!isStarred) {
      this.logToReport(
        `GitHub: Repository is NOT starred by you`,
        Severity.HIGH
      );
    }

    const isWatched = await isRepoWatched(owner, repo);
    if (!isWatched) {
      this.logToReport(
        `GitHub: Repository is NOT watched by you`,
        Severity.HIGH
      );
    }

    const rulesets = await getRulesets(owner, repo);
    if (rulesets.length === 0) {
      this.logToReport(
        `GitHub: No rulesets found for the repository`,
        Severity.LOW
      );
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
            this.logToReport(
              `${fmt.name}: ${unformatted.length} file(s) unformatted:\n${unformatted.map((f: string) => `  - ${f}`).join('\n')}`,
              Severity.LOW
            );
          }
        } catch (_err) {
          // Ignore formatter errors
        }
      }
    }
  }

  private readPkg(dir: string): Record<string, any> {
    try {
      return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'));
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
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    return { stdout, combined: stdout + stderr };
  }

  private parsePrettierCheck(output: string): string[] {
    const files: string[] = [];
    const cleanOutput = output.replace(/\x1B\[[0-9;]*[JKmsu]/g, '');
    for (const line of cleanOutput.split(/\r?\n/)) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      const m = trimmedLine.match(/\[warn\]\s+(.+)$/);
      if (m && m[1] && !m[1].includes('Code style issues')) {
        files.push(m[1].trim());
      }
    }
    return files;
  }

  private parseEslintOutput(output: string, repoDir: string): string[] {
    const files = new Set<string>();
    const cleanOutput = output.replace(/\x1B\[[0-9;]*[JKmsu]/g, '');
    for (const line of cleanOutput.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(' ') || line.startsWith(' ')) continue;
      if (trimmed.match(/^([A-Za-z]:\\|\/)/)) {
        const rel = path.relative(repoDir, trimmed);
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
