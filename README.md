# Repos Maintainer

A comprehensive Node.js TypeScript application for automated GitHub repository standardization, metadata management, and maintenance workflows. Built with enterprise-grade architecture and designed for reliability, scalability, and consistency across large repository portfolios.

Built in April 2026. This application provides a robust infrastructure for ensuring all your GitHub repositories adhere to strict quality standards, including consistent documentation, package configurations, security policies, and automation rules.

## Features

### Core Capabilities

- **Multi-Fixer Standardization**: Automated updates for READMEs, package.json, GitHub metadata, and rulesets.
- **Bulk Repository Syncing**: Scan and update your entire repository list in a single operation.
- **Intelligent Metadata Management**: Sync repository descriptions, topics, and settings via GitHub API.
- **Template-Based Scaffolding**: Automatically inject standardized LICENSES, .gitignores, and contribution guides.
- **Local Git Integration**: Seamlessly handles cloning, pulling, and committing changes locally before pushing.

### Technical Excellence

- **Octokit Integration**: Full GitHub REST API support with intelligent throttling and retry logic.
- **Idempotent Operations**: Fixers only apply changes when necessary, preventing redundant commits.
- **Type Safety**: Full TypeScript with strict type checking and modern ESNext features.
- **Comprehensive Testing**: Robust unit testing suite with Vitest for all core utilities and logic.
- **Structured Logging**: Clean, informative console output with success/error indicators and PHI safety.
- **Domain-Driven Design**: Organized by purpose (fixers, commands, github) for maximum maintainability.

### Developer Experience

- **Interactive CLI Menu**: Rich terminal interface with Enquirer-based prompts for a smooth workflow.
- **Pre-flight Validations**: Automatic checks for environment variables, path availability, and GitHub auth.
- **ESC Navigation**: Cancel operations gracefully at any prompt, just like a native application.
- **Fast Execution**: Uses `tsx` for direct execution, bypassing slow build steps during development.
- **Environment Management**: Simple `env` file loading for secure GitHub token management.

## Getting Started

### Prerequisites

- Node.js 20 or higher
- pnpm package manager (recommended) or npm
- GitHub Personal Access Token (classic) with `repo` scope

### Installation

1. Clone the repository:

```bash
git clone https://github.com/orassayag/repos-maintainer.git
cd repos-maintainer
```

2. Install dependencies:

```bash
pnpm install
```

3. Build the project:

```bash
pnpm build
```

## Configuration

### 1. GitHub Token Setup

1. Go to [GitHub Settings → Tokens](https://github.com/settings/tokens)
2. Generate a new token (classic) with `repo` scope.
3. Create a file named `env` (no extension) in the project root.
4. Add your token to the file:

```env
GITHUB_TOKEN=your_github_personal_access_token_here
```

### 2. Path Configuration

The tool uses several important paths that can be configured in `src/settings.ts`:

- **PROJECTS_ROOT**: Where your repositories are located locally (Default: `C:\Or\web\projects`).
- **REPOS_LIST_PATH**: Path to the `.txt` file containing your repository names (Default: `C:\Or\web\project-repos-names.txt`).

## Usage

### Interactive Menu (Recommended)

Start the interactive CLI menu to select and run maintenance tasks:

```bash
pnpm start
```

This will display:

```
=== Repos Maintainer ===

Select a script to run (ESC to exit):
  ❯ 🔄 Add Repo          - Add and fully standardize a new GitHub repository
    ♻️  Repos Sync        - Scan, update and clean all repositories (crawler)
    🚪 Exit
```

### Direct Execution

You can also run specific scripts directly if needed:

```bash
# Direct execution via tsx
pnpm start
```

## Available Commands

### Add Repo

Interactive wizard to onboard a new repository. You provide a GitHub URL, and the tool performs the following:

- Validates the URL format (HTTPS or SSH).
- Verifies the repository exists on GitHub.
- Clones the repository if it's missing locally.
- Runs full standardization across all fixers.
- Commits and pushes changes if updates were made.

### Repos Sync

The "crawler" mode that ensures your entire portfolio is up to date:

- Reads your repository list file.
- Iterates through each repository.
- Performs a `git pull` or `git clone`.
- Applies all standardization fixers.
- Synchronizes GitHub metadata (description, topics).
- Reports a summary of changes and issues encountered.

## Standardization Fixers

The core of the application is the "Fixer" system. Each fixer is responsible for a specific aspect of repository health:

### README Fixer

Ensures every repository has a professional README.md with consistent headers, links, and license information.

### Package JSON Fixer

Standardizes `package.json` fields, ensuring proper author info, license, and repository links.

### Metadata Fixer

Syncs repository descriptions and topics from your local configuration to the GitHub API.

### Rulesets Fixer

Configures GitHub branch protection rules and rulesets to ensure project security.

### Template Injector

Injects standard files like `.gitignore`, `LICENSE`, `CONTRIBUTING.md`, and `CHANGELOG.md` if they are missing or outdated.

## Development

### Code Quality

**Format code:**

```bash
pnpm format
```

**Lint code:**

```bash
pnpm lint
```

### Testing

**Run all tests:**

```bash
pnpm test
```

**Watch mode (during development):**

```bash
pnpm test:watch
```

**Coverage report:**

```bash
pnpm test:ui
```

### Architecture Principles

This project follows clean architecture principles:

1. **Idempotency**: All fixers are designed to be safe to run multiple times.
2. **Type Safety**: Strict TypeScript with comprehensive type definitions.
3. **Structured Logging**: Use `Logger` class for all console output.
4. **Validation**: Pre-flight checks for all external dependencies and paths.
5. **Testability**: Logic is decoupled from the CLI for easy unit testing.

## Architecture

This project follows a clean, domain-driven architecture:

### Directory Structure

```
src/
├── commands/           # CLI command implementations
│   ├── addRepo.ts      # "Add Repo" logic
│   └── reposSync.ts    # "Repos Sync" logic
├── fixers/             # Standardization logic
│   ├── metadataFixer.ts    # GitHub API metadata sync
│   ├── packageJsonFixer.ts # package.json updates
│   ├── readmeFixer.ts      # README.md standardization
│   ├── rulesetsFixer.ts    # Branch protection rules
│   └── standardizer.ts     # Orchestrator for all fixers
├── templates/          # Standard file templates
│   ├── .gitignore
│   ├── LICENSE
│   ├── CONTRIBUTING.md
│   └── ...
├── utils/              # Shared utilities
│   ├── fileFixer.ts    # Low-level file manipulation
│   ├── git.ts          # Git command wrappers
│   ├── logger.ts       # Structured logging
│   ├── prompts.ts      # Enquirer prompt wrappers
│   └── repoList.ts     # Repo list file parsing
├── __tests__/          # Vitest test suite
├── github.ts           # GitHub API (Octokit) services
├── settings.ts         # Configuration and path resolution
├── cli.ts              # Main menu and CLI flow
└── index.ts            # Application entry point
```

### Design Patterns

- **Strategy Pattern**: Different fixers for different file types.
- **Facade Pattern**: `Standardizer` provides a simple interface to complex fixer logic.
- **Wrapper Pattern**: `Git` and `GitHub` classes wrap external libraries with domain-specific logic.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](src/templates/CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](src/templates/LICENSE) file for details.

## Author

**Or Assayag**

- Email: orassayag@gmail.com
- GitHub: [@orassayag](https://github.com/orassayag)
- StackOverflow: [or-assayag](https://stackoverflow.com/users/4442606/or-assayag)
- LinkedIn: [orassayag](https://linkedin.com/in/orassayag)

## Acknowledgments

Built with:

- [Node.js](https://nodejs.org/) - JavaScript runtime
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Vitest](https://vitest.dev/) - Testing framework
- [Enquirer](https://www.npmjs.com/package/enquirer) - Interactive prompts

---
