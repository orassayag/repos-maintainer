import fs from 'fs/promises';
import path from 'path';
import { settings } from '../settings.js';

// ─────────────────────────────────────────────────────────────────────────────
// Expected sections (must match exactly what the plan specifies)
// ─────────────────────────────────────────────────────────────────────────────

const AUTHOR_SECTION = `## Author

**${settings.AUTHOR_NAME}**

- Email: ${settings.AUTHOR_EMAIL}
- GitHub: [@${settings.AUTHOR_GITHUB}](https://github.com/${settings.AUTHOR_GITHUB})
- StackOverflow: [${settings.AUTHOR_STACKOVERFLOW}](https://stackoverflow.com/users/4442606/${settings.AUTHOR_STACKOVERFLOW})
- LinkedIn: [${settings.AUTHOR_GITHUB}](https://linkedin.com/in/${settings.AUTHOR_GITHUB})
`;

const LICENSE_SECTION = `## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
`;

/**
 * Ensures the README.md has Author and License sections at the bottom.
 * Idempotent — checks for existing sections before appending.
 * Returns true if changes were made.
 */
export async function fixReadme(repoPath: string): Promise<boolean> {
  const readmePath = path.join(repoPath, 'README.md');

  try {
    let content = await fs.readFile(readmePath, 'utf-8');

    // Check if Author section already exists with the correct name (idempotent)
    const hasAuthor = content.includes('## Author') && content.includes(settings.AUTHOR_NAME);
    const hasLicense = content.includes('## License') && content.includes('MIT License');

    if (hasAuthor && hasLicense) {
      return false; // Already has both sections
    }

    if (settings.DRY_RUN) {
      console.log('🔍 [DRY RUN] Would add Author/License section to README.md');
      return false;
    }

    // Ensure content ends with newline
    if (!content.endsWith('\n')) {
      content += '\n';
    }

    // Append missing sections
    if (!hasAuthor) {
      content += '\n' + AUTHOR_SECTION + '\n';
    }
    if (!hasLicense) {
      content += LICENSE_SECTION + '\n';
    }

    await fs.writeFile(readmePath, content, 'utf-8');
    console.log('✅ Fixed README.md: Added Author/License section');
    return true;
  } catch (err) {
    console.warn(`⚠️  Could not fix README.md: ${(err as Error).message}`);
    return false;
  }
}
