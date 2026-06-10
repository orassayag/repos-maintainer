import fs from 'fs/promises';
import path from 'path';
import { minimatch } from 'minimatch';
import { settings } from '../settings.js';
import { Logger } from './logger.js';
import { isTypeScriptProject } from './projectType.js';

interface GitignoreSection {
  /** The raw comment header, e.g. "# Distribution", or null for a headerless block. */
  header: string | null;
  entries: string[];
}

/**
 * Splits a .gitignore file into sections.
 * A new section starts whenever a comment line (# …) is encountered.
 * Blank lines are ignored (they don't create sections or entries).
 */
function parseGitignore(content: string): GitignoreSection[] {
  const lines = content.split(/\r?\n/);
  const sections: GitignoreSection[] = [];
  let current: GitignoreSection = { header: null, entries: [] };

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith('#')) {
      if (current.header !== null || current.entries.length > 0) {
        sections.push(current);
      }
      current = { header: line, entries: [] };
    } else if (line !== '') {
      current.entries.push(line);
    }
  }

  if (current.header !== null || current.entries.length > 0) {
    sections.push(current);
  }

  return sections;
}

/**
 * Strips a leading "!" or "/" and a trailing "/" so patterns can be
 * compared by their core path component.
 */
function normalizeGitignorePattern(entry: string): string {
  return entry.replace(/^!/, '').replace(/^\//, '').replace(/\/$/, '');
}

/**
 * True if `targetEntry` "belongs" to a section containing `sectionEntries`:
 *   1. Normalized base match with any section entry.
 *   2. A section entry used as a glob covers the target (e.g. *.log* → *.log).
 *   3. The target used as a glob covers a section entry (reverse check).
 */
function entryBelongsToSection(
  targetEntry: string,
  sectionEntries: string[]
): boolean {
  const normalizedTarget = normalizeGitignorePattern(targetEntry);

  for (const templateEntry of sectionEntries) {
    const normalizedTemplate = normalizeGitignorePattern(templateEntry);

    if (normalizedTarget === normalizedTemplate) return true;

    try {
      if (
        minimatch(normalizedTarget, normalizedTemplate, {
          dot: true,
          matchBase: true,
        })
      )
        return true;
      if (
        minimatch(normalizedTemplate, normalizedTarget, {
          dot: true,
          matchBase: true,
        })
      )
        return true;
    } catch {
      // minimatch can throw on malformed patterns – skip
    }
  }

  return false;
}

/**
 * Merges a template .gitignore into a target .gitignore.
 */
function mergeGitignore(
  templateContent: string,
  targetContent: string
): string {
  const templateSections = parseGitignore(templateContent);
  const targetSections = parseGitignore(targetContent);

  // Flat list of all target entries with their source section header
  const allTargetEntries: Array<{
    entry: string;
    sourceHeader: string | null;
  }> = [];
  for (const s of targetSections) {
    for (const e of s.entries) {
      allTargetEntries.push({ entry: e, sourceHeader: s.header });
    }
  }

  // Check if a target entry is an exact duplicate of ANY template entry.
  function isDuplicateOfTemplate(targetEntry: string): boolean {
    for (const section of templateSections) {
      for (const te of section.entries) {
        if (targetEntry === te) return true;
      }
    }
    return false;
  }

  // --- Assign each target entry to a template section (or Others) -----------
  const assignedEntries = new Set<string>();
  const sectionExtras: string[][] = templateSections.map(() => []);

  for (const { entry } of allTargetEntries) {
    if (isDuplicateOfTemplate(entry)) {
      assignedEntries.add(entry);
      continue;
    }
    for (let i = 0; i < templateSections.length; i++) {
      if (entryBelongsToSection(entry, templateSections[i].entries)) {
        sectionExtras[i].push(entry);
        assignedEntries.add(entry);
        break;
      }
    }
  }

  // --- Collect Others entries (no matching template section) ----------------
  const othersHeaderlessEntries: string[] = [];
  const othersCustomSections: GitignoreSection[] = [];

  const othersMap = new Map<string | null, string[]>();
  for (const { entry, sourceHeader } of allTargetEntries) {
    if (assignedEntries.has(entry)) continue;
    if (!othersMap.has(sourceHeader)) othersMap.set(sourceHeader, []);
    othersMap.get(sourceHeader)!.push(entry);
  }
  for (const [header, entries] of othersMap) {
    if (header === null) othersHeaderlessEntries.push(...entries);
    else othersCustomSections.push({ header, entries });
  }

  // --- Render output --------------------------------------------------------
  const output: string[] = [];

  for (let i = 0; i < templateSections.length; i++) {
    const { header, entries } = templateSections[i];
    const extras = [...sectionExtras[i]];

    if (header) output.push(header);

    for (const templateEntry of entries) {
      output.push(templateEntry);

      // Interleave: extras with the same normalized base go directly after
      // this template entry (e.g. "dist/" immediately after "dist")
      const inlined: string[] = [];
      const leftover: string[] = [];

      for (const extra of extras) {
        if (
          normalizeGitignorePattern(extra) ===
          normalizeGitignorePattern(templateEntry)
        ) {
          inlined.push(extra);
        } else {
          leftover.push(extra);
        }
      }

      if (inlined.length > 0) output.push(...inlined);
      extras.length = 0;
      extras.push(...leftover);
    }

    // Remaining extras (glob-matched, no direct base partner) go at section end
    if (extras.length > 0) output.push(...extras);

    output.push(''); // blank line between sections
  }

  // --- Others block ---------------------------------------------------------
  const hasOthers =
    othersHeaderlessEntries.length > 0 || othersCustomSections.length > 0;

  if (hasOthers) {
    output.push('# Others:');

    if (othersHeaderlessEntries.length > 0) {
      output.push(...othersHeaderlessEntries);
      output.push('');
    }

    for (const section of othersCustomSections) {
      if (section.header) output.push(section.header);
      output.push(...section.entries);
      output.push('');
    }
  }

  return output.join('\n');
}

/**
 * Ensures a standard file exists in the repo based on overwrite policy.
 * - 'always': overwrite even if the file exists
 * - 'if-missing': only create if the file doesn't exist
 *
 * For LICENSE files, replaces the #YEAR# placeholder with the current year.
 * For CONTRIBUTING.md, replaces #REPO-NAME# with the repo folder name.
 *
 * Returns true if a file was created or updated.
 */
export async function ensureTemplateFile(
  repoPath: string,
  templateName: string,
  silent: boolean = false
): Promise<boolean> {
  const destPath = path.join(repoPath, templateName);
  const templatePath = path.join(settings.TEMPLATES_DIR, templateName);

  // Determine overwrite policy
  const policy = settings.OVERWRITE_POLICY[templateName] || 'if-missing';

  let fileExists = false;
  try {
    await fs.access(destPath);
    fileExists = true;
  } catch {
    // File doesn't exist
  }

  if (fileExists && policy === 'if-missing') {
    return false; // File exists and policy says don't overwrite
  }

  // Read template
  let content: string;
  try {
    content = await fs.readFile(templatePath, 'utf-8');
  } catch {
    Logger.warn(`Template not found: ${templatePath}`);
    return false;
  }

  // Replace placeholders - skip for CODE_OF_CONDUCT.md and SECURITY.md
  if (templateName !== 'CODE_OF_CONDUCT.md' && templateName !== 'SECURITY.md') {
    const currentYear = new Date().getFullYear().toString();
    const repoName = path.basename(repoPath);

    content = content.replace(/#YEAR#/g, currentYear);
    content = content.replace(/#REPO-NAME#/g, repoName);
    content = content.replace(/#PROJECT_NAME#/g, repoName); // Keep support for old placeholder just in case
    content = content.replace(/#AUTHOR_EMAIL#/g, settings.AUTHOR_EMAIL);
  }

  // For CHANGELOG.md — never overwrite (content is repo-specific)
  if (templateName === 'CHANGELOG.md' && fileExists) {
    return false;
  }

  if (settings.DRY_RUN) {
    const action = fileExists ? 'Would update' : 'Would create';
    Logger.info(`[DRY RUN] ${action}: ${templateName}`);
    return false;
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(destPath);
  await fs.mkdir(parentDir, { recursive: true });

  await fs.writeFile(destPath, content, 'utf-8');

  if (!silent) {
    const action = fileExists ? 'Updated' : 'Created';
    Logger.success(`${action}: ${templateName}`);
  }
  return true;
}

/**
 * Syncs standard template files in the repo based on the user's logic.
 * 1. .gitignore: copy if missing, or append missing lines in a new section.
 * 2. LICENSE: handle missing, mismatching, and year extraction.
 * 3. Other files: copy if missing.
 */
export async function syncTemplateFiles(
  repoPath: string,
  templateFiles: string[],
  isTraining: boolean = false,
  isActive: boolean = true
): Promise<string[]> {
  const changes: string[] = [];
  const hasTsFiles = await isTypeScriptProject(repoPath);
  const tsTemplateFiles = [
    'tsconfig.json',
    'tsconfig.node.json',
    'vitest.config.ts',
    'eslint.config.mjs',
    'src/index.ts',
  ];

  for (const file of templateFiles) {
    const isTsFile = tsTemplateFiles.includes(file);
    const destPath = path.join(repoPath, file);

    // Skip .npmrc if project is NOT active
    if (file === '.npmrc' && !isActive) {
      continue;
    }

    // Skip TypeScript template files if no .ts files are found
    if (isTsFile && !hasTsFiles) {
      // If the file exists but it's a JS project, we might want to remove it
      // if it was previously added by us.
      try {
        await fs.access(destPath);
        // Only remove if it's a standard config file that shouldn't be in a JS project
        if (
          [
            'tsconfig.json',
            'tsconfig.node.json',
            'vitest.config.ts',
            'eslint.config.mjs',
          ].includes(file)
        ) {
          if (!settings.DRY_RUN) {
            await fs.unlink(destPath);
            changes.push(
              `Removed TypeScript-only file from JavaScript project: ${file}`
            );
          } else {
            changes.push(
              `[DRY RUN] Would remove TypeScript-only file from JavaScript project: ${file}`
            );
          }
        }
      } catch {
        // File doesn't exist, which is fine
      }
      continue;
    }

    // Special logic for ESLint config: copy if missing AND no legacy config exists
    if (file === 'eslint.config.mjs') {
      if (isTraining) continue;

      const hasLegacyConfig =
        (await fs
          .access(path.join(repoPath, 'eslintrc.json'))
          .then(() => true)
          .catch(() => false)) ||
        (await fs
          .access(path.join(repoPath, '.eslintrc.json'))
          .then(() => true)
          .catch(() => false));

      let configExists = false;
      try {
        await fs.access(destPath);
        configExists = true;
      } catch {
        // Not found
      }

      if (!configExists && !hasLegacyConfig) {
        const created = await ensureTemplateFile(repoPath, file, true);
        if (created) {
          changes.push(`Created missing ESLint config: ${file}`);
        }
      }
      continue;
    }

    const templatePath = path.join(settings.TEMPLATES_DIR, file);

    let fileExists = false;
    try {
      await fs.access(destPath);
      fileExists = true;
    } catch {
      // File doesn't exist
    }

    if (file === '.gitignore') {
      const gitignoreChange = await syncGitignore(destPath, templatePath);
      if (gitignoreChange) changes.push(gitignoreChange);
      continue;
    }

    if (file === 'LICENSE') {
      const licenseChange = await syncLicense(destPath, templatePath);
      if (licenseChange) changes.push(licenseChange);
      continue;
    }

    if (
      file === 'CODE_OF_CONDUCT.md' ||
      file === 'SECURITY.md' ||
      file === 'CONTRIBUTING.md'
    ) {
      const mdChange = await syncMarkdownFile(repoPath, file, templatePath);
      if (mdChange) changes.push(mdChange);
      continue;
    }

    if (file === '.vscode/settings.json') {
      const settingsChange = await syncVsCodeSettings(destPath, templatePath);
      if (settingsChange) changes.push(settingsChange);
      continue;
    }

    if (file === 'tsconfig.json') {
      const tsconfigChange = await syncTsConfigTypes(destPath);
      if (tsconfigChange) changes.push(tsconfigChange);
      continue;
    }

    if (file === '.npmrc') {
      const npmrcChange = await syncNpmrc(destPath, templatePath);
      if (npmrcChange) changes.push(npmrcChange);
      continue;
    }

    // Default logic for other files: copy if missing
    if (!fileExists) {
      const created = await ensureTemplateFile(repoPath, file, true);
      if (created) {
        changes.push(`Created missing file: ${file}`);
      }
    }
  }

  return changes;
}

async function syncTsConfigTypes(destPath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(destPath, 'utf-8');
    const tsconfig = JSON.parse(content);

    const expectedTypes = ['node', 'vitest'];
    const currentTypes = tsconfig.compilerOptions?.types;

    const isIdentical =
      Array.isArray(currentTypes) &&
      currentTypes.length === expectedTypes.length &&
      currentTypes.every((t: string, i: number) => t === expectedTypes[i]);

    const hasJest =
      Array.isArray(currentTypes) && currentTypes.includes('jest');

    if (!isIdentical && !hasJest) {
      if (!tsconfig.compilerOptions) {
        tsconfig.compilerOptions = {};
      }
      tsconfig.compilerOptions.types = expectedTypes;

      if (!settings.DRY_RUN) {
        await fs.writeFile(
          destPath,
          JSON.stringify(tsconfig, null, 2) + '\n',
          'utf-8'
        );
        return 'Updated tsconfig.json types to ["node", "vitest"]';
      } else {
        return '[DRY RUN] Would update tsconfig.json types to ["node", "vitest"]';
      }
    }
  } catch (err) {
    Logger.error(
      `Failed to sync tsconfig.json types: ${(err as Error).message}`
    );
  }
  return null;
}

async function syncNpmrc(
  destPath: string,
  templatePath: string
): Promise<string | null> {
  try {
    const templateContent = await fs.readFile(templatePath, 'utf-8');
    const requiredLine = 'minimum-release-age=0';

    let destContent: string;
    try {
      destContent = await fs.readFile(destPath, 'utf-8');
    } catch {
      // .npmrc doesn't exist, create it from template
      if (!settings.DRY_RUN) {
        await fs.writeFile(destPath, templateContent, 'utf-8');
        return 'Created missing .npmrc from template';
      } else {
        return '[DRY RUN] Would create missing .npmrc from template';
      }
    }

    // Check if it has the required line with the correct value
    // We check for the exact line to ensure no other value is set for this key
    const lines = destContent.split('\n').map((l) => l.trim());
    const hasCorrectLine = lines.some((l) => l === requiredLine);

    if (!hasCorrectLine) {
      if (!settings.DRY_RUN) {
        // If it has a different value for minimum-release-age, or doesn't have it at all,
        // the user said "override it and put the value: minimum-release-age=0".
        // To be safe and clean, we'll just overwrite with the template content
        // since the template only contains this one line.
        await fs.writeFile(destPath, templateContent, 'utf-8');
        return 'Updated .npmrc to include minimum-release-age=0';
      } else {
        return '[DRY RUN] Would update .npmrc to include minimum-release-age=0';
      }
    }
  } catch (err) {
    Logger.error(`Failed to sync .npmrc: ${(err as Error).message}`);
  }
  return null;
}

async function syncGitignore(
  destPath: string,
  templatePath: string
): Promise<string | null> {
  try {
    const templateContent = await fs.readFile(templatePath, 'utf-8');

    let destContent: string;
    try {
      destContent = await fs.readFile(destPath, 'utf-8');
    } catch {
      // .gitignore doesn't exist, just copy it
      await fs.writeFile(destPath, templateContent, 'utf-8');
      return 'Created missing .gitignore';
    }

    const mergedContent = mergeGitignore(templateContent, destContent);

    if (mergedContent.trim() !== destContent.trim()) {
      await fs.writeFile(destPath, mergedContent, 'utf-8');
      return 'Merged and updated .gitignore';
    }
  } catch (err) {
    Logger.error(`Failed to sync .gitignore: ${(err as Error).message}`);
  }
  return null;
}

async function syncLicense(
  destPath: string,
  templatePath: string
): Promise<string | null> {
  try {
    const templateContent = await fs.readFile(templatePath, 'utf-8');
    const currentYear = new Date().getFullYear().toString();

    let destContent: string;
    try {
      destContent = await fs.readFile(destPath, 'utf-8');
    } catch {
      // LICENSE doesn't exist, create it with current year
      const content = templateContent.replace(/#YEAR#/g, currentYear);
      await fs.writeFile(destPath, content, 'utf-8');
      return 'Created missing LICENSE';
    }

    // LICENSE exists, check if it matches template (ignoring year)
    // We look for any year pattern (YYYY or YYYY-YYYY)
    const yearRegex = /\d{4}(-\d{4})?/g;
    const targetNoYear = destContent.replace(yearRegex, 'YEAR');
    const templateNoYear = templateContent.replace(/#YEAR#/g, 'YEAR');

    if (targetNoYear.trim() !== templateNoYear.trim()) {
      // Mismatch found, need to update
      const yearMatch = destContent.match(yearRegex);
      if (yearMatch) {
        const existingYear = yearMatch[0];
        const content = templateContent.replace(/#YEAR#/g, existingYear);
        await fs.writeFile(destPath, content, 'utf-8');
        return `Updated LICENSE (preserved year: ${existingYear})`;
      } else {
        return "Unable to update the LICENSE file since it doesn't contain a year";
      }
    }
  } catch (err) {
    Logger.error(`Failed to sync LICENSE: ${(err as Error).message}`);
  }
  return null;
}

async function syncVsCodeSettings(
  destPath: string,
  templatePath: string
): Promise<string | null> {
  try {
    const templateContent = await fs.readFile(templatePath, 'utf-8');
    const templateJson = JSON.parse(templateContent);

    let destContent: string;
    try {
      destContent = await fs.readFile(destPath, 'utf-8');
    } catch {
      // .vscode/settings.json doesn't exist, just copy it
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.writeFile(destPath, templateContent, 'utf-8');
      return 'Created missing .vscode/settings.json';
    }

    const destJson = JSON.parse(destContent);
    let changed = false;

    // Check if cSpell.ignorePaths exists
    if (!destJson['cSpell.ignorePaths'] && templateJson['cSpell.ignorePaths']) {
      // If cSpell.words exists, we want to insert cSpell.ignorePaths after it for better organization
      if (destJson['cSpell.words']) {
        const entries = Object.entries(destJson);
        const wordsIndex = entries.findIndex(([key]) => key === 'cSpell.words');

        const newEntries: [string, any][] = [];
        for (let i = 0; i <= wordsIndex; i++) {
          newEntries.push(entries[i]);
        }
        newEntries.push([
          'cSpell.ignorePaths',
          templateJson['cSpell.ignorePaths'],
        ]);
        for (let i = wordsIndex + 1; i < entries.length; i++) {
          newEntries.push(entries[i]);
        }

        const newJson = Object.fromEntries(newEntries);
        await fs.writeFile(
          destPath,
          JSON.stringify(newJson, null, 2) + '\n',
          'utf-8'
        );
      } else {
        destJson['cSpell.ignorePaths'] = templateJson['cSpell.ignorePaths'];
        await fs.writeFile(
          destPath,
          JSON.stringify(destJson, null, 2) + '\n',
          'utf-8'
        );
      }
      changed = true;
    }

    if (changed) {
      return 'Updated .vscode/settings.json: Added missing cSpell.ignorePaths';
    }
  } catch (err) {
    Logger.error(
      `Failed to sync .vscode/settings.json: ${(err as Error).message}`
    );
  }
  return null;
}

/**
 * Reads the CHANGELOG.md file and returns the first non-empty line
 * to be used as a commit message.
 */
export async function getChangelogCommitMessage(
  repoPath: string
): Promise<string | null> {
  try {
    const changelogPath = path.join(repoPath, 'CHANGELOG.md');
    const content = await fs.readFile(changelogPath, 'utf-8');
    const lines = content.split('\n');

    const addedIndex = lines.findIndex((line) => line.trim() === '### Added');
    if (addedIndex !== -1) {
      for (let i = addedIndex + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('- ')) {
          return line.replace(/^-\s*/, '').trim();
        }
        // If we hit another header before finding a list item, stop looking
        if (line.startsWith('#')) break;
      }
    }
  } catch {
    // File not found or other error
  }
  return null;
}

/**
 * Syncs a markdown file by comparing it with the template.
 * Replaces if incomplete (contains placeholders) or doesn't match the template.
 */
async function syncMarkdownFile(
  repoPath: string,
  file: string,
  templatePath: string
): Promise<string | null> {
  try {
    const destPath = path.join(repoPath, file);
    const templateContent = await fs.readFile(templatePath, 'utf-8');

    // For CODE_OF_CONDUCT.md and SECURITY.md, use exact template without placeholders
    let processedTemplate: string;
    if (file === 'CODE_OF_CONDUCT.md' || file === 'SECURITY.md') {
      processedTemplate = templateContent;
    } else {
      const currentYear = new Date().getFullYear().toString();
      const repoName = path.basename(repoPath);
      processedTemplate = templateContent
        .replace(/#YEAR#/g, currentYear)
        .replace(/#REPO-NAME#/g, repoName)
        .replace(/#PROJECT_NAME#/g, repoName)
        .replace(/#AUTHOR_EMAIL#/g, settings.AUTHOR_EMAIL);
    }

    let destContent: string;
    try {
      destContent = await fs.readFile(destPath, 'utf-8');
    } catch {
      // File doesn't exist, create it
      if (!settings.DRY_RUN) {
        const parentDir = path.dirname(destPath);
        await fs.mkdir(parentDir, { recursive: true });
        await fs.writeFile(destPath, processedTemplate, 'utf-8');
        return `Created missing ${file}`;
      } else {
        return `[DRY RUN] Would create missing ${file}`;
      }
    }

    // For CODE_OF_CONDUCT.md and SECURITY.md: check with super robust normalization (ignore all whitespace differences)
    const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();
    let isMismatch = false;
    if (file === 'CODE_OF_CONDUCT.md' || file === 'SECURITY.md') {
      isMismatch = normalize(destContent) !== normalize(processedTemplate);
    } else {
      // Check if incomplete (contains placeholders)
      const placeholders = [
        '#YEAR#',
        '#REPO-NAME#',
        '#PROJECT_NAME#',
        '#AUTHOR_EMAIL#',
        '[INSERT YOUR EMAIL ADDRESS HERE]',
        'security@yourproject.org',
      ];
      const isIncomplete = placeholders.some((p) => destContent.includes(p));

      // Check if doesn't match template (ignoring minor whitespace)
      const normalizeTrim = (s: string): string =>
        s.replace(/\r\n/g, '\n').trim();
      isMismatch =
        isIncomplete ||
        normalizeTrim(destContent) !== normalizeTrim(processedTemplate);
    }

    if (isMismatch) {
      if (!settings.DRY_RUN) {
        await fs.writeFile(destPath, processedTemplate, 'utf-8');
        return `Updated ${file}`;
      } else {
        return `[DRY RUN] Would update ${file}`;
      }
    }
  } catch (err) {
    Logger.error(`Failed to sync ${file}: ${(err as Error).message}`);
  }
  return null;
}
