import fs from 'fs/promises';
import path from 'path';
import { settings } from '../settings.js';

/**
 * Ensures a standard file exists in the repo based on overwrite policy.
 * - 'always': overwrite even if the file exists
 * - 'if-missing': only create if the file doesn't exist
 *
 * For LICENSE files, replaces the #YEAR# placeholder with the current year.
 * For CONTRIBUTING.md, replaces #PROJECT_NAME# with the repo folder name.
 *
 * Returns true if a file was created or updated.
 */
export async function ensureTemplateFile(
  repoPath: string,
  templateName: string,
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
    console.warn(`⚠️  Template not found: ${templatePath}`);
    return false;
  }

  // Replace placeholders
  const currentYear = new Date().getFullYear().toString();
  const repoName = path.basename(repoPath);

  content = content.replace(/#YEAR#/g, currentYear);
  content = content.replace(/#PROJECT_NAME#/g, repoName);

  // For CHANGELOG.md — never overwrite (content is repo-specific)
  if (templateName === 'CHANGELOG.md' && fileExists) {
    return false;
  }

  if (settings.DRY_RUN) {
    const action = fileExists ? 'Would update' : 'Would create';
    console.log(`🔍 [DRY RUN] ${action}: ${templateName}`);
    return false;
  }

  await fs.writeFile(destPath, content, 'utf-8');

  const action = fileExists ? '🔄 Updated' : '✅ Created';
  console.log(`${action}: ${templateName}`);
  return true;
}
