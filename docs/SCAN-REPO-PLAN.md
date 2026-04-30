# Scan Repo Feature Plan

This document outlines the detailed plan for implementing the "Scan Repo" feature in the `repos-maintainer` CLI.

## 1. Menu Integration
- Add a new option "🔍 Scan Repo" to the main menu in `src/cli.ts`.
- It will be placed under the "Add Repo" option.
- It will use the same emoji logic as "Sync Repos" (actually the pre-plan says same emoji as "Sync Repos", which is `♻️`, but I'll use `🔍` as suggested in some parts or stick to the requirement).
  - *Correction*: Pre-plan says "It will have the same emoji in the menu like the 'Sync Repos' option." which is `♻️`. Wait, `Sync Repos` has `♻️` in `src/cli.ts`. I will use `♻️ Scan Repo`.

## 2. Repo Selection Flow
- Once selected, the CLI will ask the user to enter the repo name or the repo URL.
- **Search Logic**:
  - Try to find an exact match in the `repos.txt` list.
  - If no repos exist in the list, notify the user and allow recovery (back to menu or try again).
  - If an exact match is found, proceed to scanning.
  - If no exact match but similar names are found, display a fuzzy-search dropdown of suggested repos.
  - *Reference*: Logic for suggestions and dropdown will be adapted from existing patterns (or similar projects).

## 3. Scanning Logic & Reporting
- **Report File**: Create/Overwrite `SCAN_REPOS_REPORT.txt` on the Desktop.
- **Step 1: Local Existence**:
  - Check if the project exists in `C:\Or\web\projects`.
  - Log to report if missing.
- **Step 2: Git Sync**:
  - Check for `.git` folder in the local project.
  - Log to report if missing.
- **Step 3: File Comparison**:
  - Compare local files with the ones in GitHub.
  - Log discrepancies to report.

## 4. Template Compliance Scan
- **Existence**: Verify all files from `src/templates/` exist in the target repo.
- **Content Verification**:
  - `.gitignore`: Verify all template content is included.
  - `CHANGELOG.md`: Verify existence and content.
  - `CODE_OF_CONDUCT.md`: Verify existence and content.
  - `INSTRUCTIONS.md`: Verify existence and content.
  - `LICENSE.md`: Verify existence (ignoring the year).
  - `SECURITY.md`: Verify existence and content.

## 5. File-Specific Deep Scan
### INSTRUCTIONS.md
- Verify presence of specific sections:
  - "Setup and Usage Instructions", "Table of Contents", "Prerequisites", "System Requirements", "Initial Setup", "Install Dependencies", "Available Commands", "Development Commands", "Running Scripts", "Troubleshooting", "Extending the Application", "Best Practices", "Documentation", "External Resources", "Author", "Last Updated", "Version".
- Report if sections are missing or empty.

### README.md
- **First Section**: Must be the repo name.
- **Description**: Must follow the same min/max length rules as "Add Repo" flow.
- **Required Sections**:
  - "Features", "Core Capabilities", "Technical Excellence", "Developer Experience", "Getting Started", "Prerequisites", "Installation", "Configuration", "Usage", "Available Scripts", "Best Practices", "Development", "Architecture Principles", "Architecture", "Directory Structure", "Design Patterns", "Contributing", "License", "Support", "Author", "Acknowledgments".
- Report if sections are missing or empty.

### package.json
- Verify fields:
  - `name`: Must match repo name.
  - `version`: Must match repo version.
  - `description`: Must match repo description and follow length rules.
  - `repository`: Must be `{ "type": "git", "url": "git://github.com/orassayag/*.git" }`.
  - `keywords`: Must follow length rules and match GitHub topics.
  - `main`, `type`, `scripts`: Must exist with values.
  - `author`: Must be "Or Assayag <orassayag@gmail.com>".
  - `contributors`: Must match the specific object structure.
  - `files`: Must be a non-empty list.
  - `license`: Must be "MIT".
  - `dependencies`, `devDependencies`: Must exist.

## 6. GitHub API Metadata Scan
- Fetch and verify:
  - Repo URL, Description, Website URL (`https://linkedin.com/in/orassayag`), Tags/Topics (must match `package.json`), Rulesets, Star status, Watch status.
- Description length check (340-350 chars).
- Report if any data is missing, incorrect, or if the repo is not starred/watched.

## 7. Execution Strategy
1. **Utility Creation**: Create `src/utils/scanner.ts` to handle file system and content checks.
2. **GitHub Enhancements**: Update `src/github.ts` to include methods for fetching detailed metadata (stars, watches, rulesets).
3. **Command Implementation**: Implement `src/commands/scanRepo.ts` orchestration logic.
4. **Integration**: Wire up the command in `src/cli.ts`.
5. **Testing**: Run against a known standardized repo and a non-standardized one to verify report accuracy.
