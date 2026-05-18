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
  // 1. Check for JS entry points first. If index.js/main.js exists, it's likely JS.
  const hasJsEntry = await hasJavaScriptEntryPoints(repoPath);

  // 2. Check package.json
  let hasTsDep = false;
  try {
    const pkgContent = await fs.readFile(
      path.join(repoPath, 'package.json'),
      'utf-8'
    );
    const pkg = JSON.parse(pkgContent);
    hasTsDep = !!(
      (pkg.dependencies && pkg.dependencies.typescript) ||
      (pkg.devDependencies && pkg.devDependencies.typescript)
    );

    // If it has a main file pointing to .js and NO typescript dependency, it's definitely JS
    if (pkg.main && pkg.main.endsWith('.js') && !hasTsDep) {
      return false;
    }
  } catch {
    // No package.json
  }

  // 3. Check for actual .ts/.tsx files (excluding config files)
  const hasTs = await hasTypeScriptFiles(repoPath);

  // If it has TS files AND no JS entry point, it's definitely TS
  if (hasTs && !hasJsEntry) return true;

  // If it has TS files AND JS entry point, it's TS only if it has a TS dependency
  if (hasTs && hasJsEntry) {
    return hasTsDep;
  }

  // 4. Fallback: Check for tsconfig.json, but only if no index.js exists
  try {
    await fs.access(path.join(repoPath, 'tsconfig.json'));
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
