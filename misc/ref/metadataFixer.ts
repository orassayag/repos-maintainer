import { getRepoMetadata, updateRepoMetadata } from '../github';
import { settings } from '../settings';

export async function fixMetadata(owner: string, repo: string): Promise<string[]> {
  const changes: string[] = [];
  const metadata = await getRepoMetadata(owner, repo);

  let newDescription = metadata.description;
  let descriptionChanged = false;

  // Description logic (your exact requirement)
  if (!newDescription || newDescription.length < settings.DESCRIPTION_MIN_REPLACE) {
    newDescription = settings.DEFAULT_DESCRIPTION;
    descriptionChanged = true;
    changes.push('Description: Replaced with default (was too short/missing)');
  } else if (newDescription.length > settings.DESCRIPTION_MAX) {
    // Intelligent truncate
    newDescription = newDescription.slice(0, settings.DESCRIPTION_MAX).trim();
    if (newDescription.endsWith('.')) newDescription = newDescription.slice(0, -1);
    newDescription += '...';
    descriptionChanged = true;
    changes.push(`Description: Truncated to ${settings.DESCRIPTION_MAX} chars`);
  } else if (newDescription.length < settings.DESCRIPTION_MIN) {
    changes.push(`Description: ${newDescription.length} chars (within acceptable range, left as-is)`);
  }

  // Homepage
  if (!metadata.homepage) {
    await updateRepoMetadata(owner, repo, { homepage: settings.DEFAULT_HOMEPAGE });
    changes.push('Homepage: Set to LinkedIn');
  }

  // Topics
  if (metadata.topics.length < settings.MIN_TOPICS) {
    // You can expand this with a default topics array in settings later
    changes.push(`Topics: Currently ${metadata.topics.length} (minimum ${settings.MIN_TOPICS})`);
  }

  // Apply description change if needed
  if (descriptionChanged) {
    await updateRepoMetadata(owner, repo, { description: newDescription });
  }

  return changes;
}