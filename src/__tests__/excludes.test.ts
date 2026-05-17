import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import {
  loadExcludes,
  isProjectExcluded,
  isIssueExcluded,
  getExcludedPaths,
  getExcludedKnipPackages,
  getExcludedKnipPaths,
  isKnipScanExcluded,
  isKnipUnusedDepsExcluded,
  isOutdatedScanExcluded,
} from '../utils/excludes.js';

vi.mock('fs');

describe('excludes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load excludes from file', () => {
    const mockContent = JSON.stringify({
      EXCLUDED_PROJECTS: ['project1'],
      EXCLUDED_PATHS: { project2: ['path1'] },
      EXCLUDED_ISSUES: { project3: ['issue1'] },
      EXCLUDED_KNIP_PACKAGES_GLOBALLY: ['global-pkg'],
      EXCLUDED_KNIP_PACKAGES_PER_PROJECT: { project4: ['project-pkg'] },
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

    const result = loadExcludes();
    expect(result.EXCLUDED_PROJECTS).toContain('project1');
    expect(result.EXCLUDED_PATHS['project2']).toContain('path1');
    expect(result.EXCLUDED_ISSUES['project3']).toContain('issue1');
    expect(result.EXCLUDED_KNIP_PACKAGES_GLOBALLY).toContain('global-pkg');
    expect(result.EXCLUDED_KNIP_PACKAGES_PER_PROJECT['project4']).toContain(
      'project-pkg'
    );
  });

  it('should return default excludes if file missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const result = loadExcludes();
    expect(result.EXCLUDED_PROJECTS).toEqual([]);
    expect(result.EXCLUDED_PATHS).toEqual({});
    expect(result.EXCLUDED_ISSUES).toEqual({});
  });

  it('should check if project is excluded', () => {
    // Note: 'excludes' is initialized once.
    // We can't easily change it here without reloading the module,
    // but we can test the exported functions with the current state.
    expect(isProjectExcluded('some-repo')).toBe(false);
  });

  it('should check if issue is excluded', () => {
    expect(isIssueExcluded('some-repo', 'some-issue')).toBe(false);
  });

  it('should get excluded paths', () => {
    expect(getExcludedPaths('some-repo')).toEqual([]);
  });

  it('should get excluded knip packages', () => {
    expect(getExcludedKnipPackages('some-repo')).toEqual([]);
  });

  it('should get excluded knip paths', () => {
    expect(getExcludedKnipPaths('some-repo')).toEqual([]);
  });

  it('should check if knip scan is excluded', () => {
    expect(isKnipScanExcluded('some-repo')).toBe(false);
  });

  it('should check if knip unused deps scan is excluded', () => {
    expect(isKnipUnusedDepsExcluded('some-repo')).toBe(false);
  });

  it('should check if outdated scan is excluded based on project type', () => {
    // This test might be tricky because projectsData is loaded at module level.
    // However, in our current implementation of src/utils/excludes.ts:
    // isOutdatedScanExcluded searches in projectsData which was loaded when the module was first imported.

    // To properly test this, we would need to control what loadProjectsData returns.
    // Since projectsData is a private constant in the module, we can't easily change it.
    // But we can verify the current behavior.

    // In the test environment, loadProjectsData() likely returned [] because fs.existsSync was not yet mocked
    // or returned false during the initial import of the module.

    expect(isOutdatedScanExcluded('some-repo')).toBe(false);
  });
});
