import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixReadme, fixInstructions } from '../fixers/readmeFixer.js';
import fs from 'fs/promises';
import { settings } from '../settings.js';
import { Logger } from '../utils/logger.js';

vi.mock('fs/promises');
vi.mock('../utils/logger.js');
vi.mock('../settings.js', () => ({
  settings: {
    AUTHOR_NAME: 'Or Assayag',
    AUTHOR_EMAIL: 'orassayag@gmail.com',
    AUTHOR_GITHUB: 'orassayag',
    AUTHOR_STACKOVERFLOW: 'or-assayag',
    DRY_RUN: false,
    TEMPLATES_DIR: '/mock/templates',
  },
}));

describe('readmeFixer', () => {
  const repoPath = '/mock/repo';
  const templateReadmeContent = `
# Template
## License
Template License
## Author
Template Author
## Acknowledgments
Template Acknowledgments
`;

  const templateInstructionsContent = `
# Instructions
## Author
Template Author
`;

  beforeEach(() => {
    vi.clearAllMocks();
    settings.DRY_RUN = false;

    // Default mock for template files
    vi.mocked(fs.readFile).mockImplementation((filePath) => {
      const p = filePath.toString().replace(/\\/g, '/');
      if (p.endsWith('templates/README.md'))
        return Promise.resolve(templateReadmeContent);
      if (p.endsWith('templates/INSTRUCTIONS.md'))
        return Promise.resolve(templateInstructionsContent);
      if (p.endsWith('README.md'))
        return Promise.resolve('# Existing README\n');
      if (p.endsWith('INSTRUCTIONS.md'))
        return Promise.resolve('# Existing INSTRUCTIONS\n');
      return Promise.resolve('# Existing Content\n');
    });

    vi.mocked(fs.access).mockResolvedValue(undefined);
  });

  describe('fixReadme', () => {
    it('should append sections if missing', async () => {
      vi.mocked(fs.readFile).mockImplementation((filePath) => {
        const p = filePath.toString().replace(/\\/g, '/');
        if (p.endsWith('templates/README.md'))
          return Promise.resolve(templateReadmeContent);
        if (p.endsWith('README.md')) return Promise.resolve('# Test Repo\n');
        return Promise.resolve('');
      });

      const result = await fixReadme(repoPath);

      expect(result).toBe(true);
      const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(written).toContain('## License\nTemplate License');
      expect(written).toContain('## Author\nTemplate Author');
      expect(written).toContain('## Acknowledgments\nTemplate Acknowledgments');
    });

    it('should update sections if different', async () => {
      vi.mocked(fs.readFile).mockImplementation((filePath) => {
        const p = filePath.toString().replace(/\\/g, '/');
        if (p.endsWith('templates/README.md'))
          return Promise.resolve(templateReadmeContent);
        if (p.endsWith('README.md'))
          return Promise.resolve(
            '# Test Repo\n## License\nOld License\n## Author\nOld Author\n## Acknowledgments\nOld Acknowledgments'
          );
        return Promise.resolve('');
      });

      const result = await fixReadme(repoPath);

      expect(result).toBe(true);
      const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(written).toContain('## License\nTemplate License');
      expect(written).not.toContain('Old License');
    });

    it('should return false if sections are already identical', async () => {
      vi.mocked(fs.readFile).mockImplementation((filePath) => {
        const p = filePath.toString().replace(/\\/g, '/');
        if (p.endsWith('templates/README.md'))
          return Promise.resolve(templateReadmeContent);
        if (p.endsWith('README.md'))
          return Promise.resolve(
            '# Test Repo\n\n## License\nTemplate License\n\n## Author\nTemplate Author\n\n## Acknowledgments\nTemplate Acknowledgments'
          );
        return Promise.resolve('');
      });

      const result = await fixReadme(repoPath);

      expect(result).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('fixInstructions', () => {
    it('should update Author section if different', async () => {
      vi.mocked(fs.readFile).mockImplementation((filePath) => {
        const p = filePath.toString().replace(/\\/g, '/');
        if (p.endsWith('templates/INSTRUCTIONS.md'))
          return Promise.resolve(templateInstructionsContent);
        if (p.endsWith('INSTRUCTIONS.md'))
          return Promise.resolve('# Instructions\n## Author\nOld Author');
        return Promise.resolve('');
      });
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result = await fixInstructions(repoPath);

      expect(result).toBe(true);
      const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      expect(written).toContain('## Author\nTemplate Author');
    });

    it('should return false if file does not exist', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await fixInstructions(repoPath);

      expect(result).toBe(false);
      expect(fs.readFile).not.toHaveBeenCalled();
    });
  });

  it('should handle dry run', async () => {
    vi.mocked(fs.readFile).mockImplementation((filePath) => {
      const p = filePath.toString().replace(/\\/g, '/');
      if (p.endsWith('templates/README.md'))
        return Promise.resolve(templateReadmeContent);
      if (p.endsWith('README.md')) return Promise.resolve('# Test Repo\n');
      return Promise.resolve('');
    });
    settings.DRY_RUN = true;

    const result = await fixReadme(repoPath);

    expect(result).toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(Logger.log).toHaveBeenCalledWith(
      expect.stringContaining('[DRY RUN]')
    );
  });
});
