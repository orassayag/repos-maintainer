import path from 'path';
import { settings } from '../settings.js';
import { ensureRepoCloned, commitAndPush, runGitClean } from '../utils/git.js';
import { ensureTemplateFile } from '../utils/fileFixer.js';
import { parseGitHubUrl, starRepo, watchRepo } from '../github.js';
import { addOrUpdateRepoInList } from '../utils/repoList.js';
import { Logger } from '../utils/logger.js';

import { fixPackageJson } from './packageJsonFixer.js';
import { fixReadme } from './readmeFixer.js';
import { fixMetadata } from './metadataFixer.js';
import { fixRulesets } from './rulesetsFixer.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StandardizeResult {
  repoName: string;
  success: boolean;
  changes: string[];
  errors: string[];
}

// Standard template files to ensure
const TEMPLATE_FILES = [
  'LICENSE',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  '.gitignore',
];

// ─────────────────────────────────────────────────────────────────────────────
// Main standardization orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs ALL standardization steps on a single repo.
 * Continues on individual step failures — never stops early.
 */
export async function standardizeRepo(repoUrl: string): Promise<StandardizeResult> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    return { repoName: 'unknown', success: false, changes: [], errors: ['Invalid GitHub URL'] };
  }

  const { owner, repo: repoName } = parsed;
  const localPath = path.join(settings.PROJECTS_ROOT, repoName);
  const changes: string[] = [];
  const errors: string[] = [];

  Logger.section(`🔄 Standardizing: ${owner}/${repoName}`);

  // ── Step 1: Git (clone/pull) ───────────────────────────────────────────
  try {
    const cloned = await ensureRepoCloned(repoUrl, repoName);
    if (cloned) {
      changes.push('Git: Cloned / pulled successfully');
    } else {
      errors.push('Git: Remote mismatch or clone failed');
    }
  } catch (err) {
    const msg = `Git: ${(err as Error).message}`;
    errors.push(msg);
    Logger.error(msg);
  }

  // ── Step 2: Update repo list ───────────────────────────────────────────
  try {
    await addOrUpdateRepoInList(repoName);
    changes.push('Repo list: Updated');
  } catch (err) {
    const msg = `Repo list: ${(err as Error).message}`;
    errors.push(msg);
    Logger.error(msg);
  }

  // ── Step 3: package.json ───────────────────────────────────────────────
  try {
    const pkgChanged = await fixPackageJson(localPath);
    if (pkgChanged) changes.push('package.json: Fixed author/contributors');
  } catch (err) {
    const msg = `package.json: ${(err as Error).message}`;
    errors.push(msg);
    Logger.error(msg);
  }

  // ── Step 4: README.md ─────────────────────────────────────────────────
  try {
    const readmeChanged = await fixReadme(localPath);
    if (readmeChanged) changes.push('README.md: Added Author/License section');
  } catch (err) {
    const msg = `README.md: ${(err as Error).message}`;
    errors.push(msg);
    Logger.error(msg);
  }

  // ── Step 5: Standard files from templates ──────────────────────────────
  for (const file of TEMPLATE_FILES) {
    try {
      const created = await ensureTemplateFile(localPath, file);
      if (created) changes.push(`${file}: Created/updated`);
    } catch (err) {
      const msg = `${file}: ${(err as Error).message}`;
      errors.push(msg);
      Logger.error(msg);
    }
  }

  // ── Step 6: Metadata (GitHub API) ──────────────────────────────────────
  try {
    const metadataChanges = await fixMetadata(owner, repoName);
    changes.push(...metadataChanges.map(c => `Metadata: ${c}`));
  } catch (err) {
    const msg = `Metadata: ${(err as Error).message}`;
    errors.push(msg);
    Logger.error(msg);
  }

  // ── Step 7: Rulesets ───────────────────────────────────────────────────
  try {
    const rulesetChanged = await fixRulesets(owner, repoName);
    if (rulesetChanged) changes.push('Rulesets: Applied/updated');
  } catch (err) {
    const msg = `Rulesets: ${(err as Error).message}`;
    errors.push(msg);
    Logger.error(msg);
  }

  // ── Step 8: Star & Watch ───────────────────────────────────────────────
  try {
    if (!settings.DRY_RUN) {
      await starRepo(owner, repoName);
      await watchRepo(owner, repoName);
      changes.push('GitHub: Starred & watched');
      Logger.success('GitHub: Starred & watched');
    } else {
      Logger.info('[DRY RUN] Would star & watch repo');
    }
  } catch (err) {
    Logger.warn(`Star/watch failed: ${(err as Error).message}`);
  }

  // ── Step 9: Git clean (if enabled) ─────────────────────────────────────
  if (settings.GIT_CLEAN_ENABLED) {
    try {
      await runGitClean(localPath);
      changes.push('Git: Cleaned (gc + reflog)');
    } catch (err) {
      const msg = `Git clean: ${(err as Error).message}`;
      errors.push(msg);
      Logger.error(msg);
    }
  }

  // ── Step 10: Commit & Push ─────────────────────────────────────────────
  if (!settings.DRY_RUN) {
    try {
      const committed = await commitAndPush(localPath);
      if (committed) changes.push('Git: Committed & pushed');
    } catch (err) {
      const msg = `Git commit: ${(err as Error).message}`;
      errors.push(msg);
      Logger.error(msg);
    }
  }

  const success = errors.length === 0;
  if (success) {
    Logger.success(`Finished standardizing ${repoName} (${changes.length} changes)`);
  } else {
    Logger.warn(`Finished standardizing ${repoName} with ${errors.length} errors`);
  }

  return { repoName, success, changes, errors };
}
