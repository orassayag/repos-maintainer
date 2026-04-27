import { describe, it, expect } from 'vitest';
import { normalizeToTitle } from '../utils/stringUtils.js';

describe('stringUtils', () => {
  describe('normalizeToTitle', () => {
    it('should convert kebab-case to Title Case', () => {
      expect(normalizeToTitle('pizza-restaurant')).toBe('Pizza Restaurant');
    });

    it('should handle single word', () => {
      expect(normalizeToTitle('pizza')).toBe('Pizza');
    });

    it('should handle multiple hyphens', () => {
      expect(normalizeToTitle('my-awesome-project-repo')).toBe('My Awesome Project Repo');
    });

    it('should handle empty string', () => {
      expect(normalizeToTitle('')).toBe('');
    });
  });
});
