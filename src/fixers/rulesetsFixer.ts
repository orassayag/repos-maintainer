import fs from 'fs/promises';
import {
  getRulesets,
  getRulesetDetails,
  createRuleset,
  updateRuleset,
} from '../github.js';
import type { RulesetData } from '../github.js';
import { settings } from '../settings.js';
import { Logger } from '../utils/logger.js';

/**
 * Compares the repo's rulesets against the local template and creates/updates as needed.
 * Returns true if any changes were made.
 */
export async function fixRulesets(
  owner: string,
  repo: string
): Promise<boolean> {
  try {
    // Load local template
    const templateContent = await fs.readFile(settings.RULESETS_PATH, 'utf-8');
    const templateRuleset: RulesetData = JSON.parse(templateContent);

    // Get current rulesets from GitHub
    const currentRulesets = await getRulesets(owner, repo);

    // Find a ruleset with the same name
    const existingRuleset = currentRulesets.find(
      (rs) => rs.name === templateRuleset.name
    );

    if (!existingRuleset) {
      // No matching ruleset found → create it
      if (settings.DRY_RUN) {
        Logger.log(
          `🔍 [DRY RUN] Would create ruleset: "${templateRuleset.name}"`
        );
        return false;
      }

      Logger.log(
        `🔧 Creating ruleset: "${templateRuleset.name}" for ${owner}/${repo}`
      );
      await createRuleset(owner, repo, templateRuleset);
      Logger.success(`Ruleset created: "${templateRuleset.name}"`);
      return true;
    }

    // Ruleset exists — check if it needs updating
    const details = existingRuleset.id
      ? await getRulesetDetails(owner, repo, existingRuleset.id)
      : null;

    if (details) {
      const isMatch = compareRulesets(details, templateRuleset);
      if (isMatch) {
        return false; // Already matches
      }

      if (settings.DRY_RUN) {
        Logger.log(
          `🔍 [DRY RUN] Would update ruleset: "${templateRuleset.name}"`
        );
        return false;
      }

      Logger.log(
        `🔧 Updating ruleset: "${templateRuleset.name}" for ${owner}/${repo}`
      );
      await updateRuleset(owner, repo, existingRuleset.id!, templateRuleset);
      Logger.success(`Ruleset updated: "${templateRuleset.name}"`);
      return true;
    }

    return false;
  } catch (err) {
    Logger.error(
      `Rulesets step failed for ${owner}/${repo}: ${(err as Error).message}`
    );
    return false;
  }
}

/**
 * Compares two rulesets by their key fields (enforcement, conditions, rules).
 */
function compareRulesets(current: RulesetData, template: RulesetData): boolean {
  if (current.enforcement !== template.enforcement) return false;

  // Compare rules by type
  const currentTypes = (current.rules || []).map((r) => r.type).sort();
  const templateTypes = (template.rules || []).map((r) => r.type).sort();
  if (JSON.stringify(currentTypes) !== JSON.stringify(templateTypes))
    return false;

  // Compare conditions
  if (
    JSON.stringify(current.conditions) !== JSON.stringify(template.conditions)
  )
    return false;

  return true;
}
