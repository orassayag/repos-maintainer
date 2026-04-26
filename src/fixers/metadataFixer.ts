import {
  getRepoMetadata,
  updateRepoMetadata,
  replaceTopics,
} from '../github.js';
import { settings } from '../settings.js';
import { Logger } from '../utils/logger.js';

/**
 * Fixes repository metadata on GitHub:
 * - Description: replace if <300 chars, truncate if >350, leave if 300-350
 * - Homepage: set to LinkedIn if empty
 * - Topics: pad from default list if fewer than MIN_TOPICS
 *
 * Returns an array of change descriptions.
 */
export async function fixMetadata(
  owner: string,
  repo: string
): Promise<string[]> {
  const changes: string[] = [];

  let metadata;
  try {
    metadata = await getRepoMetadata(owner, repo);
  } catch (err) {
    changes.push(`Metadata: Failed to fetch — ${(err as Error).message}`);
    return changes;
  }

  // ── Description ──────────────────────────────────────────────────────────
  let newDescription = metadata.description;
  let descriptionChanged = false;

  const currentLen = newDescription?.length ?? 0;

  if (!newDescription || currentLen < settings.DESCRIPTION_MIN_REPLACE) {
    // Missing or too short → replace with default
    newDescription = settings.DEFAULT_DESCRIPTION;
    descriptionChanged = true;
    changes.push(
      `Description: Replaced with default (was ${currentLen} chars)`
    );
  } else if (currentLen > settings.DESCRIPTION_MAX) {
    // Too long → intelligent truncate at word boundary
    let truncated = newDescription.slice(0, settings.DESCRIPTION_MAX);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > settings.DESCRIPTION_MAX - 30) {
      truncated = truncated.slice(0, lastSpace);
    }
    // Clean trailing punctuation
    truncated = truncated.replace(/[,;:\s]+$/, '');
    newDescription = truncated;
    descriptionChanged = true;
    changes.push(
      `Description: Truncated to ${newDescription.length} chars (was ${currentLen})`
    );
  } else {
    // In acceptable range (300-350)
    changes.push(`Description: OK (${currentLen} chars, left as-is)`);

    // Special note for 300-340 as per plan
    if (currentLen < 340) {
      Logger.suggest(
        repo,
        `Current description is ${currentLen} chars. Consider expanding to ~350 chars for better SEO.`
      );
    }
  }

  if (descriptionChanged) {
    if (settings.DRY_RUN) {
      Logger.info(
        `[DRY RUN] Would update description to ${newDescription.length} chars`
      );
    } else {
      await updateRepoMetadata(owner, repo, { description: newDescription });
      Logger.success(`Updated description for ${repo}`);
    }
  }

  // ── Homepage ─────────────────────────────────────────────────────────────
  if (!metadata.homepage) {
    if (settings.DRY_RUN) {
      Logger.info(
        `[DRY RUN] Would set homepage to ${settings.DEFAULT_HOMEPAGE}`
      );
    } else {
      await updateRepoMetadata(owner, repo, {
        homepage: settings.DEFAULT_HOMEPAGE,
      });
      Logger.success(`Set homepage for ${repo} to ${settings.DEFAULT_HOMEPAGE}`);
    }
    changes.push(`Homepage: Set to ${settings.DEFAULT_HOMEPAGE}`);
  } else {
    changes.push(`Homepage: OK (${metadata.homepage})`);
  }

  // ── Topics ───────────────────────────────────────────────────────────────
  if (metadata.topics.length < settings.MIN_TOPICS) {
    // Pad with defaults (don't add duplicates)
    const existingSet = new Set(metadata.topics.map((t) => t.toLowerCase()));
    const newTopics = [...metadata.topics];

    for (const topic of settings.DEFAULT_TOPICS) {
      if (newTopics.length >= settings.MIN_TOPICS) break;
      if (!existingSet.has(topic.toLowerCase())) {
        newTopics.push(topic);
        existingSet.add(topic.toLowerCase());
      }
    }

    if (newTopics.length > metadata.topics.length) {
      if (settings.DRY_RUN) {
        Logger.info(
          `[DRY RUN] Would add topics: ${newTopics.slice(metadata.topics.length).join(', ')}`
        );
      } else {
        await replaceTopics(owner, repo, newTopics);
        Logger.success(`Padded topics for ${repo} to ${newTopics.length}`);
      }
      changes.push(
        `Topics: Padded from ${metadata.topics.length} → ${newTopics.length}`
      );
    } else {
      changes.push(
        `Topics: ${metadata.topics.length} (could not pad further, defaults already present)`
      );
    }
  } else {
    changes.push(`Topics: OK (${metadata.topics.length} topics)`);
  }

  return changes;
}
