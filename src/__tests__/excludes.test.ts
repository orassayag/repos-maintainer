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
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(mockContent);

    const result = loadExcludes();
    expect(result.EXCLUDED_PROJECTS).toContain('project1');
    expect(result.EXCLUDED_PATHS['project2']).toContain('path1');
    expect(result.EXCLUDED_ISSUES['project3']).toContain('issue1');
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

  it('should check if outdated scan is excluded', () => {
    expect(isOutdatedScanExcluded('some-repo')).toBe(false);
  });
});
