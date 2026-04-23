import fs from 'fs/promises';
import path from 'path';
import { settings } from '../settings';

export async function fixPackageJson(repoPath: string): Promise<boolean> {
  const pkgPath = path.join(repoPath, 'package.json');

  try {
    const content = await fs.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);

    let changed = false;

    // Ensure author
    if (!pkg.author || pkg.author !== `${settings.AUTHOR_NAME} <${settings.AUTHOR_EMAIL}>`) {
      pkg.author = `${settings.AUTHOR_NAME} <${settings.AUTHOR_EMAIL}>`;
      changed = true;
    }

    // Ensure contributors
    const expectedContributor = {
      name: settings.AUTHOR_NAME,
      email: settings.AUTHOR_EMAIL,
      url: `https://github.com/${settings.AUTHOR_GITHUB}`
    };

    if (!pkg.contributors || !Array.isArray(pkg.contributors)) {
      pkg.contributors = [expectedContributor];
      changed = true;
    } else if (!pkg.contributors.some((c: any) => c.email === settings.AUTHOR_EMAIL)) {
      pkg.contributors.push(expectedContributor);
      changed = true;
    }

    if (changed) {
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
      return true;
    }

    return false;
  } catch (err) {
    console.warn(`⚠️  Could not fix package.json: ${(err as Error).message}`);
    return false;
  }
}