import fs from 'fs/promises';
import path from 'path';
import { settings } from '../settings.js';
import { Logger } from './logger.js';
import { isTypeScriptProject } from './projectType.js';

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

  // Replace placeholders
  const currentYear = new Date().getFullYear().toString();
  const repoName = path.basename(repoPath);

  content = content.replace(/#YEAR#/g, currentYear);
  content = content.replace(/#REPO-NAME#/g, repoName);
  content = content.replace(/#PROJECT_NAME#/g, repoName); // Keep support for old placeholder just in case

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
  templateFiles: string[]
): Promise<string[]> {
  const changes: string[] = [];
  const hasTsFiles = await isTypeScriptProject(repoPath);
  const tsTemplateFiles = [
    'tsconfig.json',
    'tsconfig.node.json',
    'vitest.config.ts',
  ];

  for (const file of templateFiles) {
    const isTsFile = tsTemplateFiles.includes(file);
    const destPath = path.join(repoPath, file);

    // Special logic for ESLint config: copy if missing AND no legacy config exists
    if (file === 'eslint.config.mjs') {
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

    // Skip TypeScript template files if no .ts files are found
    if (isTsFile && !hasTsFiles) {
      // If the file exists but it's a JS project, we might want to remove it
      // if it was previously added by us.
      try {
        await fs.access(destPath);
        // Only remove if it's a standard config file that shouldn't be in a JS project
        if (
          ['tsconfig.json', 'tsconfig.node.json', 'vitest.config.ts'].includes(
            file
          )
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

    const destLines = new Set(
      destContent
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
      if (!destLines.has(line)) {
        missingLines.push(line);
      }
    }

    if (missingLines.length > 0) {
      const newSection = `\n# Others:\n${missingLines.join('\n')}\n`;
      await fs.appendFile(destPath, newSection, 'utf-8');
      return `Added ${missingLines.length} missing lines to .gitignore`;
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
