import { describe, it, expect } from 'vitest';
import { normalizeToTitle, stripAnsi } from '../utils/stringUtils.js';

describe('stringUtils', () => {
  describe('normalizeToTitle', () => {
    it('should convert kebab-case to Title Case', () => {
      expect(normalizeToTitle('pizza-restaurant')).toBe('Pizza Restaurant');
    });

    it('should handle single word', () => {
      expect(normalizeToTitle('pizza')).toBe('Pizza');
    });

    it('should handle multiple hyphens', () => {
      expect(normalizeToTitle('my-awesome-project-repo')).toBe(
        'My Awesome Project Repo'
      );
    });

    it('should handle empty string', () => {
      expect(normalizeToTitle('')).toBe('');
    });
  });

  describe('stripAnsi', () => {
    it('should remove ANSI color codes', () => {
      const input = '\x1B[31mFailed\x1B[39m';
      expect(stripAnsi(input)).toBe('Failed');
    });

    it('should remove multiple ANSI codes', () => {
      const input =
        '\x1B[2m(\x1B[22m\x1B[2m3 tests\x1B[22m\x1B[2m | \x1B[22m\x1B[31m1 failed\x1B[39m\x1B[2m)\x1B[22m';
      expect(stripAnsi(input)).toBe('(3 tests | 1 failed)');
    });

    it('should handle string without ANSI codes', () => {
      const input = 'Normal string';
      expect(stripAnsi(input)).toBe('Normal string');
    });
  });
});
