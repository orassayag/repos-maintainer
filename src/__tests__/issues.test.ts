import { describe, it, expect } from 'vitest';
import { sortIssuesByFile } from '../utils/issues.js';

describe('sortIssuesByFile', () => {
  it('should prioritize README.md then INSTRUCTIONS.md then others', () => {
    const issues = [
      'package.json: Missing author',
      'INSTRUCTIONS.md: Missing section "Setup"',
      'README.md: Missing section "Features"',
      'LICENSE: Content mismatch',
      'README.md: Title mismatch',
      'INSTRUCTIONS.md: Missing section "Usage"',
    ];

    const sorted = sortIssuesByFile(issues);

    expect(sorted[0]).toContain('README.md');
    expect(sorted[1]).toContain('README.md');
    expect(sorted[2]).toContain('INSTRUCTIONS.md');
    expect(sorted[3]).toContain('INSTRUCTIONS.md');
    // alphabetical for the rest
    expect(sorted[4]).toBe('LICENSE: Content mismatch');
    expect(sorted[5]).toBe('package.json: Missing author');
  });

  it('should handle case-insensitivity', () => {
    const issues = [
      'instructions.md: some issue',
      'readme.md: some issue',
      'Other: issue',
    ];

    const sorted = sortIssuesByFile(issues);

    expect(sorted[0]).toContain('readme.md');
    expect(sorted[1]).toContain('instructions.md');
    expect(sorted[2]).toBe('Other: issue');
  });
});
