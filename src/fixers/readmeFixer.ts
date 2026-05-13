import fs from 'fs/promises';
import path from 'path';
import { settings } from '../settings.js';
import { Logger } from '../utils/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts a section from markdown content starting with ## SectionName.
 * Continues until the next ## header or end of file.
 */
function extractSection(content: string, sectionName: string): string | null {
  const lines = content.split('\n');
  const sectionHeader = `## ${sectionName}`;
  const startIndex = lines.findIndex(
    (line) => line.trim().toLowerCase() === sectionHeader.toLowerCase()
  );

  if (startIndex === -1) {
    return null;
  }

  let endIndex = lines.findIndex(
    (line, index) => index > startIndex && line.startsWith('## ')
  );
  if (endIndex === -1) endIndex = lines.length;

  const result = lines.slice(startIndex, endIndex).join('\n').trim();
  return result;
}

/**
 * Ensures the README.md has License, Author, and Acknowledgments sections.
 * If missing or different from the template, updates them.
 */
export async function fixReadme(repoPath: string): Promise<boolean> {
  const readmePath = path.join(repoPath, 'README.md');
  const templatePath = path.join(settings.TEMPLATES_DIR, 'README.md');

  try {
    // Check if README.md exists
    try {
      await fs.access(readmePath);
    } catch {
      return false; // Skip if file doesn't exist
    }

    const [content, templateContent] = await Promise.all([
      fs.readFile(readmePath, 'utf-8'),
      fs.readFile(templatePath, 'utf-8'),
    ]);

    let updatedContent = content;
    let changed = false;

    const sectionsToSync = ['License', 'Author', 'Acknowledgments'];

    for (const sectionName of sectionsToSync) {
      const templateSection = extractSection(templateContent, sectionName);
      if (!templateSection) {
        continue;
      }

      const currentSection = extractSection(updatedContent, sectionName);

      if (currentSection) {
        if (currentSection !== templateSection) {
          // Replace existing section
          updatedContent = updatedContent.replace(
            currentSection,
            templateSection
          );
          changed = true;
        }
      } else {
        // Append missing section
        updatedContent =
          updatedContent.trimEnd() + '\n\n' + templateSection + '\n';
        changed = true;
      }
    }

    if (changed) {
      if (settings.DRY_RUN) {
        Logger.log(
          '🔍 [DRY RUN] Would update documentation sections in README.md'
        );
        return false;
      }
      await fs.writeFile(readmePath, updatedContent, 'utf-8');
      return true;
    }

    return false;
  } catch (err) {
    Logger.error(`Could not fix README.md: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Ensures the INSTRUCTIONS.md has the Author section at the bottom.
 * If missing or different from the template, updates it.
 */
export async function fixInstructions(repoPath: string): Promise<boolean> {
  const instructionsPath = path.join(repoPath, 'INSTRUCTIONS.md');
  const templatePath = path.join(settings.TEMPLATES_DIR, 'INSTRUCTIONS.md');

  try {
    // Check if INSTRUCTIONS.md exists
    try {
      await fs.access(instructionsPath);
    } catch {
      return false; // Skip if file doesn't exist
    }

    const [content, templateContent] = await Promise.all([
      fs.readFile(instructionsPath, 'utf-8'),
      fs.readFile(templatePath, 'utf-8'),
    ]);

    const templateAuthorSection = extractSection(templateContent, 'Author');
    if (!templateAuthorSection) return false;

    const currentAuthorSection = extractSection(content, 'Author');

    let updatedContent = content;
    let changed = false;

    if (currentAuthorSection) {
      if (currentAuthorSection !== templateAuthorSection) {
        updatedContent = content.replace(
          currentAuthorSection,
          templateAuthorSection
        );
        changed = true;
      }
    } else {
      updatedContent =
        content.trimEnd() + '\n\n' + templateAuthorSection + '\n';
      changed = true;
    }

    if (changed) {
      if (settings.DRY_RUN) {
        Logger.log(
          '🔍 [DRY RUN] Would update Author section in INSTRUCTIONS.md'
        );
        return false;
      }
      await fs.writeFile(instructionsPath, updatedContent, 'utf-8');
      return true;
    }

    return false;
  } catch (err) {
    Logger.error(`Could not fix INSTRUCTIONS.md: ${(err as Error).message}`);
    return false;
  }
}
