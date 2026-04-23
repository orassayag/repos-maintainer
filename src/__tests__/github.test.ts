import { describe, it, expect } from 'vitest';
import { parseGitHubUrl } from '../github.js';

describe('github utils', () => {
  describe('parseGitHubUrl', () => {
    it('should parse standard https URL', () => {
      const url = 'https://github.com/orassayag/repos-maintainer';
      const result = parseGitHubUrl(url);
      expect(result).toEqual({ owner: 'orassayag', repo: 'repos-maintainer' });
    });

    it('should parse URL with .git extension', () => {
      const url = 'https://github.com/orassayag/repos-maintainer.git';
      const result = parseGitHubUrl(url);
      expect(result).toEqual({ owner: 'orassayag', repo: 'repos-maintainer' });
    });

    it('should parse SSH URL', () => {
      const url = 'git@github.com:orassayag/repos-maintainer.git';
      const result = parseGitHubUrl(url);
      expect(result).toEqual({ owner: 'orassayag', repo: 'repos-maintainer' });
    });

    it('should return null for non-github URLs', () => {
      const url = 'https://gitlab.com/orassayag/repos-maintainer';
      const result = parseGitHubUrl(url);
      expect(result).toBeNull();
    });

    it('should return null for invalid strings', () => {
      const url = 'not-a-url';
      const result = parseGitHubUrl(url);
      expect(result).toBeNull();
    });
  });
});
