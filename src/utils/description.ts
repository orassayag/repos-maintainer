import { normalizeToTitle } from './stringUtils.js';

/**
 * Validates a package.json description.
 * Expected length: 290-300 characters.
 */
export function validatePackageDescription(desc: string): string | true {
  const len = desc.trim().length;
  if (len < 290 || len > 300) {
    return `Description length is ${len} (expected 290-300 chars)`;
  }
  return true;
}

/**
 * Validates a README.md description.
 * Expected length: 500-600 characters.
 */
export function validateReadmeDescription(desc: string): string | true {
  const len = desc.trim().length;
  if (len < 500 || len > 600) {
    return `Description length is ${len} (expected 500-600 chars)`;
  }
  return true;
}

/**
 * Validates a GitHub project description.
 * Expected length: 340-350 characters.
 */
export function validateGitHubDescription(desc: string): string | true {
  const len = desc.trim().length;
  if (len < 340 || len > 350) {
    return `Description length is ${len} (expected 340-350 chars)`;
  }
  return true;
}

/**
 * Extracts the description from README.md content.
 * Everything between the first title (# ) and the next header (## ).
 */
export function extractReadmeDescription(content: string): string {
  const lines = content.split('\n').filter((l) => l.trim() !== '');
  let foundTitle = false;
  const descLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      foundTitle = true;
      continue;
    }
    if (foundTitle) {
      if (trimmed.startsWith('## ')) break;
      descLines.push(line);
    }
  }
  return descLines.join('\n').trim();
}

/**
 * Updates the description in README.md content.
 * Keeps the title and replaces the content until the next header.
 */
export function updateReadmeDescription(
  content: string,
  newDesc: string,
  repoName: string
): string {
  const lines = content.split('\n');
  const expectedTitle = `# ${normalizeToTitle(repoName)}`;

  let titleIndex = -1;
  let nextHeaderIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('# ')) {
      titleIndex = i;
    } else if (titleIndex !== -1 && lines[i].trim().startsWith('## ')) {
      nextHeaderIndex = i;
      break;
    }
  }

  if (titleIndex === -1) {
    // If no title found, prepend it
    return `${expectedTitle}\n\n${newDesc}\n\n${content}`;
  }

  const resultLines = [...lines];
  if (nextHeaderIndex === -1) {
    // No next header, replace everything after title
    resultLines.splice(
      titleIndex + 1,
      resultLines.length - (titleIndex + 1),
      '',
      newDesc
    );
  } else {
    // Replace between title and next header
    resultLines.splice(
      titleIndex + 1,
      nextHeaderIndex - (titleIndex + 1),
      '',
      newDesc,
      ''
    );
  }

  return resultLines.join('\n');
}

/**
 * Validates keywords list.
 * Expected: 8-20 unique items.
 * GitHub rules:
 * - lowercase only (a-z, 0-9, -)
 * - max 50 characters
 * - must start with a letter or number
 */
export function validateKeywords(keywords: string[]): string | true {
  const uniqueItems = [...new Set(keywords.filter(Boolean))];

  if (uniqueItems.length < 8 || uniqueItems.length > 20) {
    return `Must have between 8 and 20 unique keywords (current: ${uniqueItems.length})`;
  }

  const errors: string[] = [];
  const githubTopicRegex = /^[a-z0-9][a-z0-9-]*$/;

  for (const keyword of uniqueItems) {
    if (keyword.length > 50) {
      errors.push(`"${keyword}" is too long (max 50 chars)`);
      continue;
    }

    if (!githubTopicRegex.test(keyword)) {
      if (/[A-Z]/.test(keyword)) {
        errors.push(`"${keyword}" contains uppercase letters`);
      } else if (/\s/.test(keyword)) {
        errors.push(`"${keyword}" contains spaces`);
      } else if (!/^[a-z0-9]/.test(keyword)) {
        errors.push(`"${keyword}" must start with a letter or number`);
      } else {
        errors.push(
          `"${keyword}" contains invalid characters (only lowercase, numbers, and hyphens allowed)`
        );
      }
    }
  }

  if (errors.length > 0) {
    return `Invalid keywords found:\n${errors.join('\n')}`;
  }

  return true;
}

/**
 * Parses a comma-separated string into a list of unique keywords.
 */
export function parseKeywordsString(input: string): string[] {
  return [
    ...new Set(
      input
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  ];
}

/**
 * Validator for keywords input string.
 */
export function validateKeywordsInput(val: string): string | true {
  const keywords = parseKeywordsString(val);
  return validateKeywords(keywords);
}

/**
 * Extracts the "Built in" paragraph from README.md content.
 * Also checks if there's an empty line before it.
 */
export function extractBuiltInParagraph(content: string): {
  found: boolean;
  hasSpacing: boolean;
  paragraph: string;
} {
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('Built in')) {
      // Check if previous line is empty (or it's the first line)
      const hasSpacing = i === 0 || lines[i - 1].trim() === '';

      // Collect the paragraph
      const paragraphLines: string[] = [];
      for (let j = i; j < lines.length; j++) {
        if (lines[j].trim() === '' && j > i) break;
        paragraphLines.push(lines[j]);
      }

      return {
        found: true,
        hasSpacing,
        paragraph: paragraphLines.join('\n'),
      };
    }
  }

  return {
    found: false,
    hasSpacing: false,
    paragraph: '',
  };
}
