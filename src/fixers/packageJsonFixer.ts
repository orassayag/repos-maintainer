import fs from 'fs/promises';
import path from 'path';
import { settings } from '../settings.js';

/**
 * Ensures package.json has the correct author and contributors fields.
 * Idempotent — won't duplicate if already correct.
 * Returns true if changes were made.
 */
export async function fixPackageJson(repoPath: string): Promise<boolean> {
  const pkgPath = path.join(repoPath, 'package.json');

  try {
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);

    let changed = false;

    // Ensure author field
    const expectedAuthor = `${settings.AUTHOR_NAME} <${settings.AUTHOR_EMAIL}>`;
    if (!pkg.author || pkg.author !== expectedAuthor) {
      pkg.author = expectedAuthor;
      changed = true;
    }

    // Ensure contributors array
    const expectedContributor = {
      name: settings.AUTHOR_NAME,
      email: settings.AUTHOR_EMAIL,
      url: `https://github.com/${settings.AUTHOR_GITHUB}`,
    };

    if (!pkg.contributors || !Array.isArray(pkg.contributors)) {
      pkg.contributors = [expectedContributor];
      changed = true;
    } else {
      const hasContributor = pkg.contributors.some(
        (c: Record<string, string>) => c.email === settings.AUTHOR_EMAIL,
      );
      if (!hasContributor) {
        pkg.contributors.push(expectedContributor);
        changed = true;
      }
    }

    if (changed) {
      if (settings.DRY_RUN) {
        console.log('🔍 [DRY RUN] Would fix package.json author/contributors');
        return false;
      }
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
      console.log('✅ Fixed package.json: author/contributors');
      return true;
    }

    return false;
  } catch (err) {
    console.warn(`⚠️  Could not fix package.json: ${(err as Error).message}`);
    return false;
  }
}
