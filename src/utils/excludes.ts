import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Excludes {
  EXCLUDED_PROJECTS: string[];
  EXCLUDED_PATHS: Record<string, string[]>;
  EXCLUDED_ISSUES: Record<string, string[]>;
  EXCLUDED_KNIP_PACKAGES: Record<string, string[]>;
  EXCLUDED_KNIP_SCAN: string[];
  EXCLUDED_OUTDATED_SCAN: string[];
}

const EXCLUDES_PATH = path.join(
  __dirname,
  '..',
  '..',
  'excludes',
  'exclude.json'
);

export function loadExcludes(): Excludes {
  try {
    if (fs.existsSync(EXCLUDES_PATH)) {
      const content = fs.readFileSync(EXCLUDES_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Failed to load excludes:', error);
  }
  return {
    EXCLUDED_PROJECTS: [],
    EXCLUDED_PATHS: {},
    EXCLUDED_ISSUES: {},
    EXCLUDED_KNIP_PACKAGES: {},
    EXCLUDED_KNIP_SCAN: [],
    EXCLUDED_OUTDATED_SCAN: [],
  };
}

export const excludes = loadExcludes();

export function isProjectExcluded(repoName: string): boolean {
  return excludes.EXCLUDED_PROJECTS.includes(repoName);
}

export function isIssueExcluded(repoName: string, issueKey: string): boolean {
  const repoExcludes = excludes.EXCLUDED_ISSUES[repoName] || [];
  return repoExcludes.includes(issueKey) || repoExcludes.includes('*');
}

export function getExcludedPaths(repoName: string): string[] {
  return excludes.EXCLUDED_PATHS[repoName] || [];
}

export function getExcludedKnipPackages(repoName: string): string[] {
  return excludes.EXCLUDED_KNIP_PACKAGES[repoName] || [];
}

export function isKnipScanExcluded(repoName: string): boolean {
  return excludes.EXCLUDED_KNIP_SCAN.includes(repoName);
}

export function isOutdatedScanExcluded(repoName: string): boolean {
  return excludes.EXCLUDED_OUTDATED_SCAN.includes(repoName);
}
