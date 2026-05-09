import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import { loadExcludes } from '../utils/excludes.js';

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
});
