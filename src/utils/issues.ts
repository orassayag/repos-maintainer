export enum Severity {
  HIGH = '1 - High - Most critical - Fix ASAP',
  MEDIUM = '2 - Medium - Need to be addressed',
  LOW = '3 - Low - Fix when have time, nice to have',
  VERY_LOW = '4 - Very Low - Minor issues',
}

export const ISSUES = {
  PROJECT_NOT_FOUND: {
    message: 'Project NOT found locally at {repoPath}',
    severity: Severity.HIGH,
  },
  PROJECT_NOT_SYNCED: {
    message: 'Project is NOT synced with git (.git folder missing)',
    severity: Severity.HIGH,
  },
  LOCAL_CHANGES: {
    message:
      'Project files are NOT equal to GitHub (local changes found):\n{status}',
    severity: Severity.HIGH,
  },
  NOT_PUSHED: {
    message: 'Local commits are NOT pushed to GitHub',
    severity: Severity.HIGH,
  },
  GIT_STATUS_FAILED: {
    message: 'Failed to check git status: {error}',
    severity: Severity.HIGH,
  },
  MISSING_TEMPLATE_FILE: {
    message: 'Missing template file: {file}',
    severity: Severity.MEDIUM,
  },
  FILE_CONTENT_MISMATCH: {
    message: "{file} content is incomplete or doesn't match template.",
    severity: Severity.MEDIUM,
  },
  GITIGNORE_MISSING_LINES: {
    message: '.gitignore is missing required lines from template:\n{lines}',
    severity: Severity.MEDIUM,
  },
  LICENSE_CONTENT_MISMATCH: {
    message: "LICENSE content is incomplete or doesn't match template.",
    severity: Severity.MEDIUM,
  },
  INSTRUCTIONS_MISSING_SECTION: {
    message: 'INSTRUCTIONS.md: Missing section "{section}"',
    severity: Severity.LOW,
  },
  README_TITLE_MISMATCH: {
    message:
      'README.md: First section should be similar to "{expectedTitle}" (found "{actualTitle}")',
    severity: Severity.LOW,
  },
  README_DESCRIPTION_LENGTH: {
    message:
      'README.md: Description length is {actualLen} (expected {min}-{max} chars)',
    severity: Severity.MEDIUM,
  },
  README_MISSING_SECTION: {
    message: 'README.md: Missing section "{section}"',
    severity: Severity.LOW,
  },
  PACKAGE_JSON_NAME_MISMATCH: {
    message: 'package.json: "name" should be "{expectedName}"',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_AUTHOR: {
    message: '{file}: Missing "author" key',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_AUTHOR_MISMATCH: {
    message: '{file}: "author" should be "{expectedAuthor}"',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_LICENSE_MISMATCH: {
    message: '{file}: "license" should be "MIT"',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_REPO_URL_MISMATCH: {
    message:
      '{file}: "repository" should be { "type": "git", "url": "{expectedRepoUrl}" }',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_HOMEPAGE: {
    message: '{file}: Missing "homepage" key',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_HOMEPAGE_MISMATCH: {
    message: '{file}: "homepage" should be "{expectedHomepage}"',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_BUGS: {
    message: '{file}: Missing "bugs" key',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_BUGS_MISMATCH: {
    message: '{file}: "bugs" should be { "url": "{expectedBugsUrl}" }',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_FUNDING: {
    message: '{file}: Missing "funding" key',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_FUNDING_MISMATCH: {
    message: '{file}: "funding" should be "{expectedFunding}"',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_SCRIPTS: {
    message: '{file}: Missing "scripts" field',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_MAIN: {
    message: '{file}: Missing or empty "main" field',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_INVALID_MAIN: {
    message: '{file}: "main" path "{path}" does not exist',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_TYPE: {
    message: '{file}: Missing "type" field',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_FILES: {
    message: '{file}: Missing or empty "files" field',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_FILES_NOT_IDENTICAL: {
    message:
      '{file}: "files" field does not match root directory contents.\nMissing: {missing}\nExtra: {extra}',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_FILES_NOT_SORTED: {
    message: '{file}: "files" field is not sorted correctly',
    severity: Severity.LOW,
  },
  PACKAGE_JSON_MISSING_DEPENDENCIES: {
    message: '{file}: Missing "dependencies" field',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_DEV_DEPENDENCIES: {
    message: '{file}: Missing "devDependencies" field',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_KEYWORDS_COUNT: {
    message: '{file}: "keywords" count is {actualCount} (expected 8-20)',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_KEYWORDS_MISMATCH: {
    message:
      '{file}: Keywords do not match GitHub topics.\nExpected: {expected}\nFound: {found}',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_DESCRIPTION_LENGTH: {
    message:
      '{file}: Description length is {actualLen} (expected {min}-{max} chars)',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_UNSORTED: {
    message: '{file}: Keys or scripts are not sorted alphabetically',
    severity: Severity.LOW,
  },
  GITHUB_STAR_MISSING: {
    message: 'GitHub: Repository is NOT starred by you',
    severity: Severity.LOW,
  },
  GITHUB_WATCH_MISSING: {
    message: 'GitHub: Repository is NOT watched by you',
    severity: Severity.LOW,
  },
  GITHUB_RULESET_MISSING: {
    message: 'GitHub: Ruleset "{rulesetName}" is missing',
    severity: Severity.MEDIUM,
  },
  GITHUB_RULESET_DISABLED: {
    message: 'GitHub: Ruleset "{rulesetName}" is disabled',
    severity: Severity.MEDIUM,
  },
  GITHUB_RULESET_MISCONFIGURED: {
    message:
      'GitHub: Ruleset "{rulesetName}" is misconfigured (expected enforcement: {expected})',
    severity: Severity.MEDIUM,
  },
  OUTDATED_DEPENDENCIES: {
    message: '{file}: Outdated dependencies found:\n{deps}',
    severity: Severity.LOW,
  },
  DEPENDENCY_OUTDATED: {
    message: 'Dependency "{name}" is outdated: {current} -> {latest}',
    severity: Severity.LOW,
  },
  PACKAGE_JSON_MISSING_ENGINES: {
    message: '{file}: Missing "engines" key',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_ENGINES_MISMATCH: {
    message:
      '{file}: "engines" should be { "node": ">=20.0.0", "pnpm": ">=8.0.0" }',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_CONTRIBUTOR: {
    message: '{file}: Missing Or Assayag as a contributor',
    severity: Severity.MEDIUM,
  },
  LINT_ISSUES: {
    message: 'Lint issues found (run via npx):\n{issues}',
    severity: Severity.VERY_LOW,
  },
  PACKAGE_JSON_PRIVATE: {
    message: '{file}: "private" should not be true',
    severity: Severity.MEDIUM,
  },
  LINT_COMMAND_FAILED: {
    message: 'Lint command failed when running via npx.',
    severity: Severity.VERY_LOW,
  },
  GITHUB_HOMEPAGE_MISMATCH: {
    message:
      'GitHub: Homepage should be "https://linkedin.com/in/orassayag" (found "{actual}")',
    severity: Severity.LOW,
  },
  GITHUB_DESCRIPTION_LENGTH: {
    message:
      'GitHub: Description length should be 340-350 chars (current: {actual})',
    severity: Severity.LOW,
  },
  GITHUB_METADATA_FETCH_FAILED: {
    message: 'GitHub: Failed to fetch metadata: {error}',
    severity: Severity.MEDIUM,
  },
  GITHUB_NO_RULESETS: {
    message: 'GitHub: No rulesets found for the repository',
    severity: Severity.LOW,
  },
  FORMATTER_UNFORMATTED: {
    message: '{formatter}: {count} file(s) unformatted:\n{files}',
    severity: Severity.VERY_LOW,
  },
  ESLINT_CONFIG_MISSING: {
    message:
      '{prefix}ESLint: Missing both "eslintrc.json" (Legacy) or "eslint.config.mjs" (Latest)',
    severity: Severity.MEDIUM,
  },
  ESLINT_LEGACY_CONFIG: {
    message:
      '{prefix}ESLint: "eslintrc.json" exists but "eslint.config.mjs" is missing (should migrate to flat config)',
    severity: Severity.MEDIUM,
  },
  ESLINT_FLAT_CONFIG_MISSING_PACKAGES: {
    message:
      '{prefix}package.json: Missing required packages for ESLint flat config: {packages}',
    severity: Severity.MEDIUM,
  },
  VITEST_CONFIG_MISSING: {
    message: 'Vitest: Missing "vitest.config.ts" in the root',
    severity: Severity.MEDIUM,
  },
  TSCONFIG_TYPES_MISMATCH: {
    message: '{file}: "compilerOptions.types" should be ["node", "vitest"]',
    severity: Severity.LOW,
  },
  TSCONFIG_JSON_MISSING: {
    message: 'Missing template file: tsconfig.json',
    severity: Severity.MEDIUM,
  },
  TSCONFIG_NODE_JSON_MISSING: {
    message: 'Missing template file: tsconfig.node.json',
    severity: Severity.MEDIUM,
  },
  VITEST_CONFIG_TEMPLATE_MISSING: {
    message: 'Missing template file: vitest.config.ts',
    severity: Severity.MEDIUM,
  },
  TEST_ISSUES: {
    message: 'Test issues found:\n{issues}',
    severity: Severity.LOW,
  },
  TEST_COMMAND_FAILED: {
    message: 'Test command failed when running via npx.',
    severity: Severity.LOW,
  },
  KNIP_ISSUES: {
    message: '{prefix}Knip found unused dependencies or exports:\n{issues}',
    severity: Severity.VERY_LOW,
  },
  KNIP_COMMAND_FAILED: {
    message: '{prefix}Knip command failed when running via {command}.',
    severity: Severity.VERY_LOW,
  },
  VSCODE_SETTINGS_MISSING_CSPELL_IGNORE_PATHS: {
    message: '.vscode/settings.json: Missing "cSpell.ignorePaths" section',
    severity: Severity.LOW,
  },
  INVALID_IMPORT: {
    message:
      '{file}: Direct file import used instead of index export at lines: {lines}',
    severity: Severity.VERY_LOW,
  },
  DUPLICATE_MD_TITLE: {
    message:
      '{file}: Duplicate MD title "{title}" (level {level}) at lines: {lines}',
    severity: Severity.LOW,
  },
} as const;

export type IssueKey = keyof typeof ISSUES;

/**
 * Sorts issues such that README.md issues come first, then INSTRUCTIONS.md issues, then others.
 */
export function sortIssuesByFile(issues: string[]): string[] {
  return [...issues].sort((a, b) => {
    const isAReadme = a.toLowerCase().includes('readme.md');
    const isBReadme = b.toLowerCase().includes('readme.md');
    const isAInstructions = a.toLowerCase().includes('instructions.md');
    const isBInstructions = b.toLowerCase().includes('instructions.md');

    if (isAReadme && !isBReadme) return -1;
    if (!isAReadme && isBReadme) return 1;

    if (isAInstructions && !isBInstructions) return -1;
    if (!isAInstructions && isBInstructions) return 1;

    return a.localeCompare(b);
  });
}

/**
 * Formats a list of issue messages into a string for the report.
 * Groups package.json issues by their subfolder if applicable.
 */
export function formatIssuesForReport(issues: string[]): string {
  const sortedIssues = sortIssuesByFile(issues);
  let formatted = '';
  let currentFolder = '';

  for (const message of sortedIssues) {
    // Check if message starts with "folder/package.json:" or "folder/subfolder/package.json:"
    // This matches the relativePath we pass in scanner.ts
    const match = message.match(/^(.+)\/package\.json: (.*)$/);
    if (match) {
      const folder = match[1];
      const rest = match[2];

      if (folder !== currentFolder) {
        currentFolder = folder;
        formatted += `\n${folder}\n`;
      }
      formatted += `-package.json: ${rest.trim()}\n`;
    } else {
      currentFolder = ''; // Reset folder grouping for non-package.json issues
      formatted += `-${message.trim()}\n`;
    }
  }
  return formatted;
}
