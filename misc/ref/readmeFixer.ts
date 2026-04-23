import fs from 'fs/promises';
import path from 'path';
import { settings } from '../settings';

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

export async function fixReadme(repoPath: string): Promise<boolean> {
  const readmePath = path.join(repoPath, 'README.md');

  try {
    let content = await fs.readFile(readmePath, 'utf-8');

    // Check if Author section already exists (idempotent)
    if (content.includes('## Author') && content.includes(settings.AUTHOR_NAME)) {
      return false; // already good
    }

    // Append at the end if missing
    if (!content.endsWith('\n')) content += '\n';
    content += '\n' + AUTHOR_SECTION + '\n' + LICENSE_SECTION + '\n';

    await fs.writeFile(readmePath, content, 'utf-8');
    return true;

  } catch (err) {
    console.warn(`⚠️  Could not fix README.md: ${(err as Error).message}`);
    return false;
  }
}