import { describe, it, expect } from 'vitest';
import path from 'path';
import { settings, getReposListPath, getLocalRepoPath } from '../settings.js';

describe('settings', () => {
  it('should have correct default PROJECTS_ROOT', () => {
    // This depends on the environment, but let's check it's defined
    expect(settings.PROJECTS_ROOT).toBeDefined();
    expect(typeof settings.PROJECTS_ROOT).toBe('string');
  });

  it('should construct correct repos list path', () => {
    const expected = path.join(path.dirname(settings.PROJECTS_ROOT), settings.REPOS_LIST_FILE);
    expect(getReposListPath()).toBe(expected);
  });

  it('should construct correct local repo path', () => {
    const repoName = 'my-awesome-repo';
    const expected = path.join(settings.PROJECTS_ROOT, repoName);
    expect(getLocalRepoPath(repoName)).toBe(expected);
  });
});
