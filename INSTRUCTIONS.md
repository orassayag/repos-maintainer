# Setup and Usage Instructions

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [GitHub Authentication](#github-authentication)
4. [Environment Management](#environment-management)
5. [Available Commands](#available-commands)
6. [Script Usage Guide](#script-usage-guide)
7. [Troubleshooting](#troubleshooting)
8. [Advanced Configuration](#advanced-configuration)
9. [Best Practices](#best-practices)

## Prerequisites

### System Requirements

- **Node.js**: Version 20 or higher
- **Package Manager**: pnpm (recommended) or npm
- **Operating System**: macOS, Linux, or Windows (PowerShell/CMD)
- **Memory**: 1GB RAM minimum
- **Disk Space**: ~200MB for application and dependencies + space for local repo clones

### GitHub Requirements

- Active GitHub account.
- Personal Access Token (classic) with `repo` scope.
- SSH key configured (if using SSH URLs).

### Knowledge Prerequisites

- Basic understanding of Git and GitHub.
- Familiarity with Node.js and npm/pnpm.
- Basic terminal usage.

## Initial Setup

### 1. Install Dependencies

Using pnpm (recommended):

```bash
pnpm install
```

Verify installation by running a build:

```bash
pnpm build
```

### 2. Configure Environment

The tool requires a GitHub Personal Access Token to interact with the GitHub API.

1. Create a file named `env` (no extension) in the root directory.
2. Add your token to the file:

```env
GITHUB_TOKEN=your_github_token_here
```

### 3. Verify Paths

Ensure your repository list file exists at the expected location. By default, the tool looks for:
`C:\Or\web\project-repos-names.txt`

The file should contain one repository name per line, e.g.:
```text
events-and-people-syncer
repos-maintainer
my-other-project
```

## GitHub Authentication

### Creating a Personal Access Token (PAT)

1. Navigate to [GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens).
2. Click **Generate new token** → **Generate new token (classic)**.
3. **Note**: Give it a descriptive name like "Repos Maintainer Tool".
4. **Expiration**: Choose an expiration period that suits your security policy.
5. **Scopes**: Select the `repo` checkbox (this grants full control of private repositories).
6. Click **Generate token**.
7. **Important**: Copy the token immediately. You will not be able to see it again.

### Adding the Token to the Tool

Paste the token into your `env` file as shown in the [Initial Setup](#initial-setup) section.

## Environment Management

### Manual Environment Loading

Unlike many projects that use `dotenv`, Repos Maintainer uses a custom manual loader in `src/index.ts` to read the `env` file at startup. This ensures that the `GITHUB_TOKEN` is available to the Octokit client immediately and consistently across different operating systems.

### Pre-flight Validations

Every time the application starts, it performs several critical checks:

1. **Projects Root**: Verifies the local directory for repositories exists.
2. **Repos List**: Verifies the text file containing repository names exists.
3. **GitHub Auth**: Verifies that a valid token is provided and that it has the necessary permissions.

If any of these checks fail, the application will exit with a clear error message explaining what is missing.

## Available Commands

### Development Commands

**Linting and Formatting:**

```bash
# Check code style and quality
pnpm lint

# Format all TypeScript files
pnpm format
```

**Testing:**

```bash
# Run all unit tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with interactive UI
pnpm test:ui
```

**Building:**

```bash
# Compile TypeScript to JavaScript
pnpm build
```

### Running the Tool

**Interactive Menu (Recommended):**

```bash
# Start the main menu
pnpm start
```

## Script Usage Guide

### Add Repo

#### Purpose
Used to onboard a new repository into your local maintenance workflow and apply immediate standardization.

#### Workflow
1. Select **Add Repo** from the main menu.
2. Enter the full GitHub URL (e.g., `https://github.com/orassayag/new-project`).
3. The tool parses the URL and checks GitHub for the repository's existence.
4. If valid, it checks if the repo is already cloned locally in your projects root.
5. If missing, it performs a `git clone`.
6. It then runs the **Standardizer**, which executes all active fixers.
7. Any changes made are committed and pushed back to GitHub.

### Repos Sync

#### Purpose
The "crawler" script that iterates through your entire repository list to ensure global consistency.

#### Workflow
1. Select **Repos Sync** from the main menu.
2. The tool reads your `project-repos-names.txt` file.
3. For each repository:
   - Updates the local clone (pull) or clones if missing.
   - Applies all standardization fixers.
   - Updates GitHub metadata (descriptions/topics).
   - Reports success or errors encountered.
4. A summary is displayed at the end of the run.

## Standardization Fixers

Fixers are modular scripts that enforce specific standards. You can find them in `src/fixers/`.

### README Fixer
Enforces a standard structure for `README.md` files. It checks for:
- Standard headers and badges.
- Correct license links.
- Consistent project descriptions.

### Package JSON Fixer
Ensures `package.json` contains:
- Correct author information.
- Valid license field.
- Proper repository and bug links.
- Consistent versioning patterns.

### Metadata Fixer
Synchronizes your local project descriptions and topics with the GitHub API, ensuring your GitHub profile stays updated.

### Rulesets Fixer
Configures repository rulesets (branch protection) via the GitHub API to prevent accidental deletions or unreviewed pushes.

## Troubleshooting

### GitHub Authentication Failed (401)

**Problem**: You see "❌ GitHub authentication failed" in the terminal.

**Solutions**:
1. Check your `env` file and ensure it's named exactly `env` (no extension).
2. Ensure the token in `env` is exactly what you copied from GitHub.
3. Verify your token has not expired.
4. Check that your token has the `repo` scope.

### Repos List File Not Found

**Problem**: The tool reports "❌ Repos list file not found".

**Solutions**:
1. Ensure the file exists at `C:\Or\web\project-repos-names.txt`.
2. Check that the path in `src/settings.ts` matches your actual file location.

### Git Clone/Pull Failures

**Problem**: Errors related to Git credentials or network.

**Solutions**:
1. Verify you have `git` installed and accessible in your path.
2. If using SSH, ensure your SSH key is added to your GitHub account and your SSH agent is running.
3. If using HTTPS, ensure your GitHub credentials are cached or accessible.

## Advanced Configuration

### Modifying Settings
You can fine-tune the tool's behavior by editing `src/settings.ts`. Key settings include:

```typescript
export const PROJECTS_ROOT = 'C:\\Or\\web\\projects';
export const REPOS_LIST_FILENAME = 'project-repos-names.txt';
```

### Adding New Fixers
1. Create a new fixer file in `src/fixers/` (e.g., `gitignoreFixer.ts`).
2. Implement the `fix` method to handle your specific logic.
3. Register the new fixer in `src/fixers/standardizer.ts`.

## Best Practices

1. **Test Before Bulk Sync**: Always run **Add Repo** on a single project first to verify your changes before running a full **Repos Sync**.
2. **Review Changes**: Use `git diff` in your project folders to review what the tool changed before pushing if you are running in a manual mode.
3. **Keep Token Secure**: Never commit your `env` file. It is already added to `.gitignore`, but stay vigilant.
4. **Regular Backups**: Since the tool modifies files, ensure your repositories have their work committed before running the maintainer.
