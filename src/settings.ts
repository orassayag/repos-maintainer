import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type OverwritePolicy = 'always' | 'if-missing';

export interface MaintainerSettings {
  // Paths
  PROJECTS_ROOT: string;
  REPOS_LIST_FILE: string;
  TEMPLATES_DIR: string;
  RULESETS_PATH: string;

  // Description settings
  DESCRIPTION_MIN_REPLACE: number;   // replace if shorter than this
  DESCRIPTION_MIN: number;           // leave as-is if in this range
  DESCRIPTION_MAX: number;           // truncate if longer than this

  // Default description (347 chars)
  DEFAULT_DESCRIPTION: string;

  // Contact / Author info (centralized)
  AUTHOR_NAME: string;
  AUTHOR_EMAIL: string;
  AUTHOR_GITHUB: string;
  AUTHOR_LINKEDIN: string;
  AUTHOR_STACKOVERFLOW: string;

  // GitHub defaults
  DEFAULT_HOMEPAGE: string;
  MIN_TOPICS: number;
  DEFAULT_TOPICS: string[];

  // Safety & Behavior
  GIT_CLEAN_ENABLED: boolean;
  DRY_RUN: boolean;

  // Overwrite policies
  OVERWRITE_POLICY: Record<string, OverwritePolicy>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────



export const settings: MaintainerSettings = {
  PROJECTS_ROOT: process.env.REPOS_ROOT || path.join('C:', 'Or', 'web', 'projects'),
  REPOS_LIST_FILE: 'project-repos-names.txt',
  TEMPLATES_DIR: path.join(__dirname, 'templates'),
  RULESETS_PATH: path.resolve(__dirname, '..', '.github', 'rulesets', 'main-protection.json'),

  DESCRIPTION_MIN_REPLACE: 300,
  DESCRIPTION_MIN: 300,
  DESCRIPTION_MAX: 350,

  DEFAULT_DESCRIPTION:
    "Collection of high-quality open-source projects maintained by Or Assayag. " +
    "Focused on clean architecture, TypeScript best practices, robust error handling, " +
    "and developer experience. Each repository follows strict standards: comprehensive " +
    "READMEs, proper licensing, contribution guidelines, security policies, and GitHub " +
    "rulesets for main branch protection. Actively maintained with regular updates, " +
    "changelog, and community-friendly structure.",

  AUTHOR_NAME: "Or Assayag",
  AUTHOR_EMAIL: "orassayag@gmail.com",
  AUTHOR_GITHUB: "orassayag",
  AUTHOR_LINKEDIN: "https://linkedin.com/in/orassayag",
  AUTHOR_STACKOVERFLOW: "or-assayag",

  DEFAULT_HOMEPAGE: "https://linkedin.com/in/orassayag",
  MIN_TOPICS: 8,
  DEFAULT_TOPICS: [
    "typescript",
    "nodejs",
    "javascript",
    "open-source",
    "developer-tools",
    "clean-code",
    "best-practices",
    "mit-license",
    "clean-architecture",
    "production-ready",
  ],

  GIT_CLEAN_ENABLED: false,
  DRY_RUN: false,

  OVERWRITE_POLICY: {
    'LICENSE': 'always',
    'SECURITY.md': 'if-missing',
    'CODE_OF_CONDUCT.md': 'if-missing',
    'CONTRIBUTING.md': 'if-missing',
    'CHANGELOG.md': 'if-missing',
    '.gitignore': 'if-missing',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────────────

export const getReposListPath = (): string =>
  path.join(path.dirname(settings.PROJECTS_ROOT), settings.REPOS_LIST_FILE);

export const getLocalRepoPath = (repoName: string): string =>
  path.join(settings.PROJECTS_ROOT, repoName);
