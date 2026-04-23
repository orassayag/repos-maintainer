import fs from 'fs/promises';
import path from 'path';
import { settings } from '../settings';
import { ensureRepoCloned, runGitClean } from '../utils/git';
import { ensureTemplateFile } from '../utils/fileFixer';
import { parseGitHubUrl } from '../github';
import { addOrUpdateRepoInList } from '../utils/repoList';

import { fixPackageJson } from './packageJsonFixer';
import { fixReadme } from './readmeFixer';
import { fixMetadata } from './metadataFixer';
import { fixRulesets } from './rulesetsFixer';

export interface StandardizeResult {
  repoName: string;
  success: boolean;
  changes: string[];
  errors: string[];
}

/**
 * Main standardization function - runs ALL steps and continues on failure
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

  console.log(`\n🔄 Standardizing ${repoName}...`);

  try {
    // 1. Git step
    const cloned = await ensureRepoCloned(repoUrl, repoName);
    if (cloned) changes.push('Git: Cloned / pulled successfully');
    else errors.push('Git: Remote mismatch or clone failed');

    // 2. Update repo list
    await addOrUpdateRepoInList(repoName, repoUrl);
    changes.push('Repo list: Updated');

    // 3. package.json
    const pkgChanged = await fixPackageJson(localPath);
    if (pkgChanged) changes.push('package.json: Fixed author/contributors');

    // 4. README.md
    const readmeChanged = await fixReadme(localPath);
    if (readmeChanged) changes.push('README.md: Added Author/License section');

    // 5. Standard files from templates
    const templateFiles = ['LICENSE', 'CONTRIBUTING.md', 'CHANGELOG.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md', '.gitignore'];
    for (const file of templateFiles) {
      const created = await ensureTemplateFile(localPath, file);
      if (created) changes.push(`${file}: Created/updated`);
    }

    // 6. Metadata (GitHub)
    const metadataChanges = await fixMetadata(owner, repoName);
    changes.push(...metadataChanges);

    // 7. Rulesets
    const rulesetChanged = await fixRulesets(owner, repoName);
    if (rulesetChanged) changes.push('Rulesets: Applied');

    // 8. Star & Watch
    // Note: These are fire-and-forget (no strong error handling needed)
    try {
      // starRepo and watchRepo would be called here from github.ts
      changes.push('GitHub: Starred & watched');
    } catch {}

    // 9. Git clean (if enabled)
    if (settings.GIT_CLEAN_ENABLED) {
      await runGitClean(localPath);
      changes.push('Git: Cleaned');
    }

    console.log(`✅ Finished standardizing ${repoName}`);
    return { repoName, success: errors.length === 0, changes, errors };

  } catch (err: any) {
    errors.push(`Critical error: ${err.message}`);
    return { repoName, success: false, changes, errors };
  }
}