import fs from 'fs/promises';
import path from 'path';

/**
 * Detects if a project is TypeScript-based.
 * A project is considered TypeScript-based if:
 * 1. It has 'typescript' in its package.json dependencies or devDependencies.
 * 2. It has any .ts or .tsx files (excluding node_modules, .git, and config files).
 * 3. It has a tsconfig.json file AND does NOT have an index.js in src or root.
 */
export async function isTypeScriptProject(repoPath: string): Promise<boolean> {
  // 1. Check package.json for typescript dependency (Strongest signal)
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

    // If it has a main file pointing to .js, it's likely JS
    if (pkg.main && pkg.main.endsWith('.js')) {
      // If no typescript dependency, it's almost certainly JS
      if (!pkg.devDependencies?.typescript && !pkg.dependencies?.typescript) {
        // We still check for .ts files just in case, but prioritize JS entry points
        const hasJsEntry = await hasJavaScriptEntryPoints(repoPath);
        if (hasJsEntry) {
          const hasTsSource = await hasTypeScriptFiles(repoPath);
          if (!hasTsSource) return false;
        }
      }
    }
  } catch {
    // Continue
  }

  // 2. Check for actual .ts/.tsx files (excluding config files)
  const hasTs = await hasTypeScriptFiles(repoPath);
  if (hasTs) return true;

  // 3. Check for tsconfig.json as a fallback, but only if no index.js exists
  // (to avoid circular detection if we incorrectly added tsconfig.json before)
  try {
    await fs.access(path.join(repoPath, 'tsconfig.json'));

    // If we have tsconfig.json, check if we have JS entry points which would suggest it's actually JS
    const hasJsEntry = await hasJavaScriptEntryPoints(repoPath);
    if (!hasJsEntry) {
      return true;
    }
  } catch {
    // Continue
  }

  return false;
}

async function hasJavaScriptEntryPoints(repoPath: string): Promise<boolean> {
  const entryPoints = [
    'index.js',
    'src/index.js',
    'main.js',
    'src/main.js',
    'app.js',
    'src/app.js',
  ];

  for (const entry of entryPoints) {
    try {
      await fs.access(path.join(repoPath, entry));
      return true;
    } catch {
      // Continue
    }
  }
  return false;
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
          entry.name === 'dist' ||
          entry.name === 'misc'
        )
          continue;
        if (await hasTypeScriptFiles(res)) return true;
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        // Ignore config files that we might have added
        const configFiles = [
          'tsconfig.json',
          'tsconfig.node.json',
          'vitest.config.ts',
          'vite.config.ts',
          'eslint.config.ts',
        ];
        if (configFiles.includes(entry.name)) continue;

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
