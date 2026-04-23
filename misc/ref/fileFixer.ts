import fs from 'fs/promises';
import path from 'path';
import { settings } from '../settings';

export async function ensureTemplateFile(repoPath: string, templateName: string): Promise<boolean> {
  const destPath = path.join(repoPath, templateName);
  const templatePath = path.join(settings.TEMPLATES_DIR, templateName);

  try {
    await fs.access(destPath);
    // File exists - check policy
    const policy = settings.OVERWRITE_POLICY[templateName.replace('.md', '').toUpperCase() as any] || 'if-missing';
    if (policy === 'always') {
      await fs.copyFile(templatePath, destPath);
      console.log(`🔄 Updated ${templateName}`);
      return true;
    }
    return false;
  } catch {
    // File missing → copy template
    await fs.copyFile(templatePath, destPath);
    console.log(`✅ Created ${templateName}`);
    return true;
  }
}