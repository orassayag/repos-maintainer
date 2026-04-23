import { getRulesets, updateRulesets } from '../github';
import fs from 'fs/promises';
import { settings } from '../settings';

export async function fixRulesets(owner: string, repo: string): Promise<boolean> {
  try {
    const currentRulesets = await getRulesets(owner, repo);
    const templateRulesets = JSON.parse(await fs.readFile(settings.RULESETS_PATH, 'utf-8'));

    // Simple identity check as you originally wanted
    if (JSON.stringify(currentRulesets) !== JSON.stringify([templateRulesets])) {
      await updateRulesets(owner, repo, [templateRulesets]);
      return true;
    }

    return false;
  } catch (err) {
    console.warn(`⚠️  Rulesets step failed for ${owner}/${repo}: ${(err as Error).message}`);
    return false;
  }
}