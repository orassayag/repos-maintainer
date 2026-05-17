import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Excludes {
  EXCLUDED_PROJECTS: string[];
  EXCLUDED_PATHS: Record<string, string[]>;
  EXCLUDED_ISSUES: Record<string, string[]>;
  EXCLUDED_KNIP_PACKAGES_GLOBALLY: string[];
  EXCLUDED_KNIP_PACKAGES_PER_PROJECT: Record<string, string[]>;
  EXCLUDED_KNIP_PATHS: Record<string, string[]>;
  EXCLUDED_KNIP_SCAN: string[];
  EXCLUDED_KNIP_UNUSED_DEPS_SCAN: string[];
}

const EXCLUDES_PATH = path.join(
  __dirname,
  '..',
  '..',
  'excludes',
  'exclude.json'
);

const PROJECTS_DATA_PATH = 'C:\\Or\\web\\project-repos-names.json';

interface ProjectData {
  name: string;
  url: string;
  type: 'Active' | 'Legacy';
}

function loadProjectsData(): ProjectData[] {
  try {
    if (fs.existsSync(PROJECTS_DATA_PATH)) {
      const content = fs.readFileSync(PROJECTS_DATA_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('Failed to load projects data:', error);
  }
  return [];
}

const projectsData = loadProjectsData();

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
    EXCLUDED_KNIP_PACKAGES_GLOBALLY: [],
    EXCLUDED_KNIP_PACKAGES_PER_PROJECT: {},
    EXCLUDED_KNIP_PATHS: {},
    EXCLUDED_KNIP_SCAN: [],
    EXCLUDED_KNIP_UNUSED_DEPS_SCAN: [],
  };
}

const excludes = loadExcludes();

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
  const globalExcludes = excludes.EXCLUDED_KNIP_PACKAGES_GLOBALLY || [];
  const projectExcludes =
    excludes.EXCLUDED_KNIP_PACKAGES_PER_PROJECT[repoName] || [];
  return [...new Set([...globalExcludes, ...projectExcludes])];
}

export function getExcludedKnipPaths(repoName: string): string[] {
  return excludes.EXCLUDED_KNIP_PATHS[repoName] || [];
}

export function isKnipScanExcluded(repoName: string): boolean {
  return excludes.EXCLUDED_KNIP_SCAN.includes(repoName);
}

export function isKnipUnusedDepsExcluded(repoName: string): boolean {
  return excludes.EXCLUDED_KNIP_UNUSED_DEPS_SCAN.includes(repoName);
}

export function isOutdatedScanExcluded(repoName: string): boolean {
  const project = projectsData.find((p) => p.name === repoName);
  return project?.type === 'Legacy';
}
