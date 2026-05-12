import fs from 'fs/promises';
import path from 'path';

/**
 * Detects if a project is TypeScript-based.
 * A project is considered TypeScript-based if:
 * 1. It has a tsconfig.json file.
 * 2. It has any .ts or .tsx files (excluding node_modules and .git).
 * 3. It has 'typescript' in its package.json dependencies or devDependencies.
 */
export async function isTypeScriptProject(repoPath: string): Promise<boolean> {
  // 1. Check for tsconfig.json
  try {
    await fs.access(path.join(repoPath, 'tsconfig.json'));
    return true;
  } catch {
    // Continue
  }

  // 2. Check package.json for typescript dependency
  try {
    const pkgContent = await fs.readFile(
      path.join(repoPath, 'package.json'),
      'utf-8'
    );
    const pkg = JSON.parse(pkgContent);
    if (
      (pkg.dependencies && pkg.dependencies.typescript) ||
      (pkg.devDependencies && pkg.devDependencies.typescript)
    ) {
      return true;
    }
  } catch {
    // Continue
  }

  // 3. Check for .ts/.tsx files
  return await hasTypeScriptFiles(repoPath);
}

async function hasTypeScriptFiles(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const res = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'dist'
        )
          continue;
        if (await hasTypeScriptFiles(res)) return true;
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        // Special case: ignore src/index.ts if it's empty, as it might have been created by us
        if (entry.name === 'index.ts' && dir.endsWith('src')) {
          const stats = await fs.stat(res);
          if (stats.size === 0) continue;
        }
        return true;
      }
    }
  } catch {
    // Ignore errors
  }
  return false;
}
