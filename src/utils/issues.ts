export enum Severity {
  HIGH = '1 - High - Most critical - Fix ASAP',
  MEDIUM = '2 - Medium - Need to be addressed',
  LOW = '3 - Low - Fix when have time, nice to have',
  VERY_LOW = '4 - Very Low - Minor issues',
}

export interface IssueDefinition {
  message: string;
  severity: Severity;
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
      'README.md: First section should be similar to "# {expectedTitle}" (found "{actualTitle}")',
    severity: Severity.LOW,
  },
  README_DESCRIPTION_LENGTH: {
    message:
      'README.md: Description length is {actualLen} (expected {min}-{max} chars)',
    severity: Severity.LOW,
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
    message: 'package.json: Missing "author" key',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_AUTHOR_MISMATCH: {
    message: 'package.json: "author" should be "{expectedAuthor}"',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_LICENSE_MISMATCH: {
    message: 'package.json: "license" should be "MIT"',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_REPO_URL_MISMATCH: {
    message:
      'package.json: "repository" should be { "type": "git", "url": "{expectedRepoUrl}" }',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_HOMEPAGE: {
    message: 'package.json: Missing "homepage" key',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_HOMEPAGE_MISMATCH: {
    message: 'package.json: "homepage" should be "{expectedHomepage}"',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_BUGS: {
    message: 'package.json: Missing "bugs" key',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_BUGS_MISMATCH: {
    message: 'package.json: "bugs" should be { "url": "{expectedBugsUrl}" }',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_FUNDING: {
    message: 'package.json: Missing "funding" key',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_FUNDING_MISMATCH: {
    message:
      'package.json: "funding" should be { "type": "github", "url": "https://github.com/sponsors/orassayag" }',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_SCRIPTS: {
    message: 'package.json: Missing "scripts" section',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_MAIN: {
    message: 'package.json: Missing "main" field',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_TYPE: {
    message: 'package.json: Missing "type" field',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_FILES: {
    message: 'package.json: Missing or empty "files" section',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_FILES_NOT_IDENTICAL: {
    message:
      'package.json: "files" section is not identical to root level files and folders',
    severity: Severity.LOW,
  },
  PACKAGE_JSON_FILES_NOT_SORTED: {
    message: 'package.json: "files" section is not in alphabetical order',
    severity: Severity.LOW,
  },
  PACKAGE_JSON_MISSING_DEPENDENCIES: {
    message: 'package.json: Missing "dependencies" section',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_DEV_DEPENDENCIES: {
    message: 'package.json: Missing "devDependencies" section',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_KEYWORDS_COUNT: {
    message:
      'package.json: Keywords count is {actualCount} (expected 8-20 unique items)',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_KEYWORDS_MISMATCH: {
    message:
      'package.json: Keywords do not match GitHub topics.\nExpected (from package.json): {expected}\nFound (on GitHub): {found}',
    severity: Severity.LOW,
  },
  PACKAGE_JSON_DESCRIPTION_LENGTH: {
    message:
      'package.json: Description length is {actualLen} (expected 290-300 chars)',
    severity: Severity.MEDIUM,
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
  DEPENDENCY_OUTDATED: {
    message: 'Dependency "{name}" is outdated: {current} -> {latest}',
    severity: Severity.LOW,
  },
  PACKAGE_JSON_MISSING_ENGINES: {
    message: 'package.json: Missing "engines" key',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_ENGINES_MISMATCH: {
    message:
      'package.json: "engines" should contain node and npm/pnpm versions',
    severity: Severity.MEDIUM,
  },
  PACKAGE_JSON_MISSING_CONTRIBUTOR: {
    message:
      'package.json: Missing or incorrect "contributors" entry for Or Assayag',
    severity: Severity.MEDIUM,
  },
  LINT_ISSUES: {
    message: 'Lint issues found (run via npx):\n{issues}',
    severity: Severity.VERY_LOW,
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
  GITHUB_NO_RULESETS: {
    message: 'GitHub: No rulesets found for the repository',
    severity: Severity.LOW,
  },
  FORMATTER_UNFORMATTED: {
    message: '{formatter}: {count} file(s) unformatted:\n{files}',
    severity: Severity.VERY_LOW,
  },
} as const;

export type IssueKey = keyof typeof ISSUES;
