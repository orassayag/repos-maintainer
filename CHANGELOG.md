# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Unit Testing Framework** - Integrated Vitest for robust testing.
  - Added `src/__tests__/github.test.ts` for URL parsing logic.
  - Added `src/__tests__/settings.test.ts` for path resolution logic.
  - Configured `vitest.config.ts` with coverage support.
- **Manual Environment Loading** - Implemented a secure loader for `GITHUB_TOKEN` from a local `env` file.
- **Pre-flight Validations** - Added automated checks for projects root, repos list file, and GitHub authentication on startup.
- **Enquirer-based CLI** - Migrated to a cleaner, help-text-free interactive menu matching the style of `events-and-people-syncer`.
- **Modular Fixer System** - Foundation for automated repository standardization (package.json, README, etc.).

### Changed
- **Logging Refactor** - Removed all file-based logging (`repos-maintainer.log`) in favor of clean console output.
- **Path Resolution** - Updated settings to correctly resolve repository lists from the parent directory of the projects root.
- **Dependency Update** - Migrated from `inquirer` to `enquirer` for a better user experience and ESC key support.

### Fixed
- **Vitest Windows Compatibility** - Resolved missing native bindings for Rolldown on Windows environments.
- **GitHub Auth 401** - Fixed authentication issues by ensuring `process.env.GITHUB_TOKEN` is correctly populated from the `env` file.

## [1.0.0] - 2026-04-20

### Added
- Initial project setup with TypeScript and Octokit.
- Basic repository cloning and folder management logic.
- Repository list parsing from text files.
- Simple CLI structure for adding and syncing repos.
- ESLint and Prettier configuration for code quality.
