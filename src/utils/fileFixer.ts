import fs from 'fs/promises';
import path from 'path';
import { settings } from '../settings.js';
import { Logger } from './logger.js';

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

  await fs.writeFile(destPath, content, 'utf-8');

  if (!silent) {
    const action = fileExists ? 'Updated' : 'Created';
    Logger.success(`${action}: ${templateName}`);
  }
  return true;
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
