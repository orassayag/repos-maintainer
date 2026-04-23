import * as fs from 'fs';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  id: string;
  severity: IssueSeverity;
  message: string;
  line?: number;
}

export interface ValidationResult {
  repoPath: string;
  readmePath: string;
  isValid: boolean;
  issues: ValidationIssue[];
  stats: ReadmeStats;
}

export interface ReadmeStats {
  totalLines: number;
  nonEmptyLines: number;
  sections: string[];
  codeBlockCount: number;
  linkCount: number;
}

/**
 * Context passed to every check function.
 * Having a single context object makes it trivial to add new checks
 * without touching the runner or other checks.
 */
export interface CheckContext {
  content: string;
  lines: string[];
  repoDir: string;
  readmePath: string; // absolute path to the README file itself
  readmeDir: string;  // directory containing the README; use this to resolve relative links
}

/**
 * A check is any function that accepts a CheckContext and returns
 * zero or more ValidationIssues (or null/undefined for "no issue").
 */
export type Check = (
  ctx: CheckContext
) => ValidationIssue | ValidationIssue[] | null | undefined;

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_LINES = 20;

const REQUIRED_SECTIONS: Array<{ label: string; patterns: string[] }> = [
  {
    label: 'Title (H1)',
    patterns: ['^# '],
  },
  {
    label: 'Installation / Getting Started',
    patterns: ['install', 'getting started', 'setup', 'quick start'],
  },
  {
    label: 'Usage',
    patterns: ['usage', 'how to use', 'running', 'run'],
  },
  {
    label: 'License',
    patterns: ['license', 'licensing'],
  },
];

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bTODO\b/g,
  /\[your[- _]?\w+\]/gi,
  /\bplaceholder\b/gi,
  /<your[- _]?\w+>/gi,
  /INSERT_\w+/g,
  /CHANGE_ME/g,
  /FILL_IN/g,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Finds the README file in a given repo directory (async).
 * Uses `isFile()` to guard against directories named "README.md".
 */
async function findReadme(repoDir: string): Promise<string | null> {
  const candidates = ['README.md', 'readme.md', 'Readme.md', 'README', 'README.txt'];
  for (const name of candidates) {
    const full = path.join(repoDir, name);
    try {
      const stat = await fs.promises.stat(full);
      if (stat.isFile()) return full;
    } catch {
      // file doesn't exist — try next candidate
    }
  }
  return null;
}

/**
 * Returns the line numbers (1-based) of all ``` fence lines.
 * Used by multiple checks so it lives here as a shared utility.
 */
function getFenceLines(lines: string[]): number[] {
  return lines.reduce<number[]>((acc, line, i) => {
    if (/^```/.test(line.trim())) acc.push(i + 1);
    return acc;
  }, []);
}

/**
 * Builds a Set of line numbers (1-based) that are inside a code block.
 * Used to avoid false positives in checks that scan prose content.
 */
function buildCodeBlockLineSet(fenceLineNumbers: number[]): Set<number> {
  const inside = new Set<number>();
  // fences come in pairs: open, close, open, close ...
  // if count is odd the last block is unclosed — we still skip those lines
  for (let i = 0; i + 1 < fenceLineNumbers.length; i += 2) {
    const open = fenceLineNumbers[i];
    const close = fenceLineNumbers[i + 1];
    for (let ln = open; ln <= close; ln++) inside.add(ln);
  }
  return inside;
}

/**
 * Converts a heading string to a GitHub-compatible anchor slug.
 *
 * GitHub's algorithm:
 *   1. Lowercase everything
 *   2. Strip all characters that are not letters, digits, spaces, or hyphens
 *      (this also removes underscores, matching GitHub's behaviour)
 *   3. Replace spaces with hyphens
 *
 * Example: "What's New?" → "whats-new"
 */
function headingToSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // strip punctuation; keeps letters, digits, _, spaces, hyphens
    .replace(/_/g, '')        // GitHub strips underscores too
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Builds the set of all valid anchor slugs present in the document.
 * Headings inside code blocks are excluded.
 */
function buildHeadingSlugSet(lines: string[], insideCodeBlock: Set<number>): Set<string> {
  return new Set(
    lines
      .map((l, i) => ({ text: l, lineNo: i + 1 }))
      .filter(({ lineNo, text }) => !insideCodeBlock.has(lineNo) && /^#{1,6}\s/.test(text))
      .map(({ text }) => headingToSlug(text.replace(/^#{1,6}\s+/, '')))
  );
}

// ─── Individual checks ────────────────────────────────────────────────────────

function checkMinimumLength({ lines }: CheckContext): ValidationIssue | null {
  const nonEmpty = lines.filter((l) => l.trim().length > 0).length;
  if (nonEmpty < MIN_LINES) {
    return {
      id: 'readme_too_short',
      severity: 'error',
      message: `README is too short — only ${nonEmpty} non-empty lines (minimum: ${MIN_LINES}).`,
    };
  }
  return null;
}

function checkRequiredSections({ lines }: CheckContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const fenceLines = getFenceLines(lines);
  const insideCodeBlock = buildCodeBlockLineSet(fenceLines);

  // Only consider lines that are actual markdown headings outside code blocks
  const headingLines = lines
    .map((l, i) => ({ text: l, lineNo: i + 1 }))
    .filter(({ lineNo, text }) => !insideCodeBlock.has(lineNo) && /^#{1,6}\s/.test(text))
    .map(({ text }) => text.toLowerCase());

  for (const { label, patterns } of REQUIRED_SECTIONS) {
    const found = patterns.some((p) => {
      if (p.startsWith('^')) {
        return headingLines.some((h) => new RegExp(p).test(h));
      }
      return headingLines.some((h) => h.includes(p));
    });

    if (!found) {
      issues.push({
        id: `missing_section_${label.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        severity: 'error',
        message: `Missing required section: "${label}".`,
      });
    }
  }

  return issues;
}

function checkUnclosedCodeBlocks({ lines }: CheckContext): ValidationIssue | null {
  const fenceLineNumbers = getFenceLines(lines);

  if (fenceLineNumbers.length % 2 !== 0) {
    const lastFenceLine = fenceLineNumbers[fenceLineNumbers.length - 1];
    return {
      id: 'unclosed_code_block',
      severity: 'error',
      message: `Unclosed code block — odd number of \`\`\` fences (${fenceLineNumbers.length}).`,
      line: lastFenceLine,
    };
  }
  return null;
}

/**
 * Unified link and anchor checker. Handles three cases:
 *
 *   1. Pure anchor  [text](#anchor)        → validates against headings in this file
 *   2. Relative file  [text](./path/file)  → checks filesystem existence
 *   3. File + anchor  [text](file#anchor)  → checks file existence; anchor skipped
 *
 * Severity stays 'warning' throughout — a broken link doesn't make the README's
 * core content invalid the way a missing License section does.
 */
function checkLinksAndAnchors({ content, lines, readmeDir }: CheckContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const fenceLines = getFenceLines(lines);
  const insideCodeBlock = buildCodeBlockLineSet(fenceLines);
  const headingSlugs = buildHeadingSlugSet(lines, insideCodeBlock);

  // Captures the full target, excluding external URLs and mailto links
  const linkRegex = /\[.*?\]\(((?!https?:\/\/|mailto:)[^)?]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(content)) !== null) {
    const rawTarget = match[1].trim();

    // Skip links that appear inside code blocks — they're examples, not real links
    const matchLineNumber = content.slice(0, match.index).split('\n').length;
    if (insideCodeBlock.has(matchLineNumber)) continue;

    const hashIdx = rawTarget.indexOf('#');

    const filePart   = hashIdx === -1 ? rawTarget : rawTarget.slice(0, hashIdx);
    const anchorPart = hashIdx === -1 ? null       : rawTarget.slice(hashIdx + 1);

    if (!filePart && anchorPart !== null) {
      // Case 1: pure anchor link — e.g. [see setup](#setup)
      // Must slugify the anchor the same way we slugify headings, otherwise
      // anchors with punctuation (e.g. #what's-new) will never match.
      const normalizedAnchor = headingToSlug(anchorPart);
      if (!headingSlugs.has(normalizedAnchor)) {
        issues.push({
          id: `broken_anchor_${normalizedAnchor}_${match.index}`,
          severity: 'warning',
          message: `Internal anchor "#${anchorPart}" does not match any heading in this file.`,
        });
      }
    } else if (filePart) {
      // Case 2 & 3: relative file link (anchor portion, if any, is ignored here)
      const fullPath = path.resolve(readmeDir, filePart);
      if (!fs.existsSync(fullPath)) {
        issues.push({
          id: `broken_relative_link_${filePart.replace(/[^a-z0-9]/gi, '_')}_${match.index}`,
          severity: 'warning',
          message: `Broken relative link: "${filePart}" does not exist.`,
        });
      }
    }
  }

  return issues;
}

function checkEmptySections({ lines }: CheckContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('##')) continue;

    const sectionLines = lines.slice(i + 1);
    const nextHeadingIdx = sectionLines.findIndex((l) => /^#{1,6}\s/.test(l.trim()));
    const body = nextHeadingIdx === -1 ? sectionLines : sectionLines.slice(0, nextHeadingIdx);

    const hasContent = body.some((l) => {
      const t = l.trim();
      return t.length > 0 && t !== '```';
    });

    if (!hasContent) {
      issues.push({
        id: `empty_section_line_${i + 1}`,
        severity: 'warning',
        message: `Section "${line}" appears to be empty.`,
        line: i + 1,
      });
    }
  }

  return issues;
}

function checkPlaceholders({ content, lines }: CheckContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  // Pre-compute code block lines so we don't flag intentional placeholders
  // in code examples (e.g. `INSERT_YOUR_TOKEN` in a shell snippet)
  const insideCodeBlock = buildCodeBlockLineSet(getFenceLines(lines));

  for (const pattern of PLACEHOLDER_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
      const lineNumber = content.slice(0, match.index).split('\n').length;

      // Skip placeholders inside code blocks — they're intentional examples
      if (insideCodeBlock.has(lineNumber)) continue;

      const token = match[0];
      const key = `${token}::${lineNumber}`;

      if (seen.has(key)) continue;
      seen.add(key);

      issues.push({
        id: `placeholder_${token.toLowerCase().replace(/[^a-z0-9]/g, '_')}_line_${lineNumber}`,
        severity: 'warning',
        message: `Unfilled placeholder found: "${token}".`,
        line: lineNumber,
      });
    }
  }

  return issues;
}

function checkMissingDescription({ lines }: CheckContext): ValidationIssue | null {
  const firstH1 = lines.findIndex((l) => /^# /.test(l));
  if (firstH1 === -1) return null;

  const linesAfterH1 = lines.slice(firstH1 + 1).map((l) => l.trim()).filter(Boolean);
  const firstContent = linesAfterH1[0] ?? '';

  if (firstContent.startsWith('#')) {
    return {
      id: 'missing_description',
      severity: 'warning',
      message: 'No description found directly under the H1 title.',
    };
  }
  return null;
}

function checkAuthorOrContact({ content }: CheckContext): ValidationIssue | null {
  const lower = content.toLowerCase();
  const hasContact =
    lower.includes('## author') ||
    lower.includes('## contact') ||
    lower.includes('## support') ||
    lower.includes('## maintainer') ||
    /https?:\/\/(github\.com|linkedin\.com|twitter\.com)/.test(lower);

  if (!hasContact) {
    return {
      id: 'missing_author_contact',
      severity: 'info',
      message: 'No author or contact information found.',
    };
  }
  return null;
}

// ─── Check pipeline ───────────────────────────────────────────────────────────

/**
 * The ordered list of all checks.
 * To add a new check: write a function with signature `(ctx: CheckContext) => ...`
 * and drop it here. Nothing else needs to change.
 */
const CHECKS: Check[] = [
  checkMinimumLength,
  checkRequiredSections,
  checkUnclosedCodeBlocks,
  checkLinksAndAnchors,   // unified: covers both broken relative links and dead anchors
  checkEmptySections,
  checkPlaceholders,
  checkMissingDescription,
  checkAuthorOrContact,
];

function runChecks(ctx: CheckContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const check of CHECKS) {
    const result = check(ctx);
    if (!result) continue;
    if (Array.isArray(result)) issues.push(...result);
    else issues.push(result);
  }

  return issues;
}

// ─── Stats collector ──────────────────────────────────────────────────────────

function collectStats(content: string, lines: string[]): ReadmeStats {
  const sections = lines.filter((l) => /^#{1,6}\s/.test(l.trim())).map((l) => l.trim());
  const fenceCount = lines.filter((l) => /^```/.test(l.trim())).length;
  const linkCount = (content.match(/\[.*?\]\(.*?\)/g) ?? []).length;

  return {
    totalLines: lines.length,
    nonEmptyLines: lines.filter((l) => l.trim().length > 0).length,
    sections,
    codeBlockCount: Math.floor(fenceCount / 2),
    linkCount,
  };
}

// ─── Repo discovery ───────────────────────────────────────────────────────────

/**
 * Recursively finds every directory under `rootDir` that contains a `.git`
 * folder — i.e. actual git repositories.
 *
 * Stops descending into a directory once a `.git` folder is found, so nested
 * repos (submodules) are each reported individually rather than swallowed by
 * their parent.
 *
 * Usage:
 *   const repos = await findAllGitRepos('/Users/me/Projects');
 *   await validateAllReadmes(repos);
 */
export async function findAllGitRepos(rootDir: string): Promise<string[]> {
  const repos: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // permission error or unreadable dir — skip silently
    }

    const hasGit = entries.some((e) => e.name === '.git' && e.isDirectory());
    if (hasGit) {
      repos.push(dir);
      return; // don't recurse into the repo itself
    }

    for (const entry of entries) {
      // Skip hidden directories (node_modules, .cache, etc.)
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(path.join(dir, entry.name));
      }
    }
  }

  await walk(rootDir);
  return repos;
}

// ─── Main validator ───────────────────────────────────────────────────────────

/**
 * Validates the README of a single repository directory.
 */
export async function validateReadme(repoDir: string): Promise<ValidationResult> {
  const readmePath = await findReadme(repoDir);

  if (!readmePath) {
    return {
      repoPath: repoDir,
      readmePath: '',
      isValid: false,
      issues: [
        {
          id: 'readme_missing',
          severity: 'error',
          message: 'No README file found in the repository root.',
        },
      ],
      stats: { totalLines: 0, nonEmptyLines: 0, sections: [], codeBlockCount: 0, linkCount: 0 },
    };
  }

  let content: string;
  try {
    content = await fs.promises.readFile(readmePath, 'utf8');
  } catch (err) {
    return {
      repoPath: repoDir,
      readmePath,
      isValid: false,
      issues: [{
        id: 'readme_read_error',
        severity: 'error',
        message: `Cannot read README: ${(err as Error).message}`,
      }],
      stats: { totalLines: 0, nonEmptyLines: 0, sections: [], codeBlockCount: 0, linkCount: 0 },
    };
  }
  const lines = content.split('\n');
  const readmeDir = path.dirname(readmePath);

  const ctx: CheckContext = { content, lines, repoDir, readmePath, readmeDir };
  const issues = runChecks(ctx);
  const stats = collectStats(content, lines);
  const isValid = issues.every((i) => i.severity !== 'error');

  return { repoPath: repoDir, readmePath, isValid, issues, stats };
}

/**
 * Validates README files across multiple repositories in parallel
 * and prints a formatted report.
 */
export async function validateAllReadmes(repoDirs: string[]): Promise<void> {
  // All repo validations run concurrently — I/O no longer blocks on each other
  const results = await Promise.all(repoDirs.map(validateReadme));

  const totalRepos = results.length;
  const validRepos = results.filter((r) => r.isValid).length;
  const invalidRepos = totalRepos - validRepos;

  console.log('\n' + '═'.repeat(60));
  console.log('  📋  README Validator Report');
  console.log('═'.repeat(60));
  console.log(`  Repos scanned : ${totalRepos}`);
  console.log(`  ✅ Valid       : ${validRepos}`);
  console.log(`  ❌ Invalid     : ${invalidRepos}`);
  console.log('═'.repeat(60) + '\n');

  for (const result of results) {
    const repoName = path.basename(result.repoPath);
    const statusIcon = result.isValid ? '✅' : '❌';

    console.log(`${statusIcon}  ${repoName}`);
    if (result.readmePath) {
      console.log(`   📄 ${result.readmePath}`);
    }

    if (result.issues.length === 0) {
      console.log('   No issues found.\n');
      continue;
    }

    const errors   = result.issues.filter((i) => i.severity === 'error');
    const warnings = result.issues.filter((i) => i.severity === 'warning');
    const infos    = result.issues.filter((i) => i.severity === 'info');

    const printGroup = (label: string, icon: string, items: ValidationIssue[]) => {
      if (items.length === 0) return;
      console.log(`\n   ${icon}  ${label} (${items.length})`);
      for (const issue of items) {
        const lineHint = issue.line != null ? ` [line ${issue.line}]` : '';
        console.log(`      • ${issue.message}${lineHint}`);
      }
    };

    printGroup('Errors',   '🔴', errors);
    printGroup('Warnings', '🟡', warnings);
    printGroup('Info',     '🔵', infos);

    console.log(
      `\n   📊 Stats: ${result.stats.nonEmptyLines} lines · ` +
      `${result.stats.sections.length} sections · ` +
      `${result.stats.codeBlockCount} code blocks · ` +
      `${result.stats.linkCount} links`
    );
    console.log();
  }

  console.log('═'.repeat(60) + '\n');
}
