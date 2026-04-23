**PLAN.md**

# Repos Maintainer

## Goal

Build a reliable personal tool to maintain high structural standards across all my GitHub repositories.  
It serves as both a quick “Add Repo” assistant and a powerful automatic crawler that keeps existing repos clean and consistent.

Core principles:
- Do as much as possible automatically
- Never stop on individual failures (run all steps)
- Prioritize safety and idempotency
- Stay practical for personal use (not a generic policy engine)

## Pre-flight Validation (`pnpm run start`)

1. Check that `PROJECTS_ROOT` exists and is not empty
2. Check that `project-repos-names.txt` exists and is not empty
3. Verify GitHub authentication (`gh auth status` or valid `GITHUB_TOKEN`)
4. Fail fast with clear error if any validation fails

## CLI Menu

```text
=== Repos Maintainer ===

? Select a script to run (ESC to exit):
> 🔄 Add Repo          - Add and fully standardize a new GitHub repository
  ♻️  Repos Sync        - Scan, update and clean all repositories (crawler)
  🚪 Exit
```

## 1. Add Repo Command

### Flow:

1. Prompt for GitHub repository URL  
   - Validate it is a proper GitHub URL  
   - Allow retry on invalid input

2. Verify the repository exists via GitHub API

3. Add or update entry in `project-repos-names.txt` (keep list alphabetically sorted)

4. **Standardization Phase** – Execute all steps (continue even if some fail):

   - **Git step**:
     - If local folder does not exist → clone the repository
     - If folder exists → verify `git remote get-url origin` matches the expected URL
     - Handle mismatch with clear warning

   - **package.json**:
     - Run existing `packageJsonValidator.ts` logic unchanged
     - Ensure the exact `author` and `contributors` block is present

   - **README.md**:
     - Run existing `readmeValidator.ts` logic unchanged
     - Ensure the exact "## Author" and "## License" section exists at the bottom (append intelligently to avoid duplication)

   - **Standard files** (create from `templates/` if missing):
     - `LICENSE`
     - `CONTRIBUTING.md`
     - `CHANGELOG.md`
     - `CODE_OF_CONDUCT.md`
     - `SECURITY.md`
     - `.gitignore`

   - **Metadata step** (GitHub repository settings):
     - Fetch current description, homepage, and topics
     - **Description handling**:
       - If missing or < 300 characters → replace with default description (347 chars)
       - If > 350 characters → intelligently truncate to 350 characters (at word boundary)
       - If 300–340 characters → leave as-is and log a clear note
     - If homepage is empty → set to `https://linkedin.com/in/orassayag`
     - Ensure at least 8 topics (add from default list when needed)

   - **Rulesets step**:
     - Get current rulesets of the repo
     - Compare with local `Rulesets.json`
     - If missing or not equal → apply / update it

   - **Star & Watch step**:
     - Ensure the repository is starred and watched by the authenticated user

   - **Git clean step** (configurable):
     - Run only if enabled in settings or via flag:
       ```bash
       git gc --aggressive --prune=now
       git reflog expire --expire=now --all && git gc --prune=now
       ```

5. Show clear summary of what was fixed/added for this repo

## 2. Repos Sync (Crawler)

- Read all repositories from `project-repos-names.txt`
- For each repo:
  - Clone if missing
  - `git pull --rebase`
  - Run full standardization (same steps as Add Repo)
  - Run git clean (if enabled)
- If a change is complex or risky → write suggested changes to `~/Desktop/repos-maintainer-changes.txt` instead of auto-applying
- Output a nice summary table at the end (repo | changes | status)

**Auto mode**:  
`pnpm run sync` or `pnpm run start --auto` → runs Repos Sync without menu

## File Overwrite Policy

| File                  | Policy                          | Reason |
|-----------------------|---------------------------------|--------|
| `LICENSE`             | Overwrite if missing or different | Should be identical |
| `SECURITY.md`         | Overwrite if missing            | Safety first, but allow custom contact if needed later |
| `CODE_OF_CONDUCT.md`  | Overwrite if missing            | Consistency |
| `CONTRIBUTING.md`     | Overwrite only if missing       | May contain repo-specific info |
| `CHANGELOG.md`        | Create if missing, never overwrite | Content is repo-specific |
| `README.md`           | Only append/fix Author + License section (idempotent) | Never replace whole file |
| `.gitignore`          | Overwrite if missing            | Base template |

## Idempotency Requirement

All fixers must be **idempotent**:
- Running the tool 10 times on the same repo produces the same result with no duplicate sections or noisy changes.
- Check before adding (e.g., don’t append Author section if it already exists).

## Commit Strategy

- After local changes in Repos Sync or Add Repo: create **one commit per repo**
- Conventional commit message:
  ```
  chore(maintainer): standardize repository structure
  ```
- Push the commit automatically (with confirmation in interactive mode)

## Configuration (`settings.ts`)

Centralized and cross-platform:
- `PROJECTS_ROOT` (supports `REPOS_ROOT` env var)
- `REPOS_LIST_FILE`
- `TEMPLATES_DIR`
- `RULESETS_PATH`
- Description limits and default text
- Default topics list
- Author / contact details (centralized)
- Git clean enabled (default: false for safety)
- Overwrite policies per file

## Safety Features

- `--dry-run` flag: show planned changes without applying anything
- Local backup of modified files before changes
- Per-repo try/catch: one failing repo does not stop the entire run
- Logging to console + `repos-maintainer.log`
- Colors and progress indicators

## Default Description (347 characters)

**I didn't touch it** — already in range:

"Collection of high-quality open-source projects maintained by Or Assayag. Focused on clean architecture, TypeScript best practices, robust error handling, and developer experience. Each repository follows strict standards: comprehensive READMEs, proper licensing, contribution guidelines, security policies, and GitHub rulesets for main branch protection. Actively maintained with regular updates, changelog, and community-friendly structure."

## Architecture Overview

```text
.git
.github/
├── rulesets/
│   ├── main-protection.json
.vscode/
docs/
logs/
node_modules/
src/
├── settings.ts
├── github.ts                   # Octokit + helpers
├── cli.ts
├── templates/
├── utils/
│   ├── repoList.ts
│   ├── git.ts                  # clone, pull, verify remote, gc
│   └── fileFixer.ts
├── fixers/
│   ├── standardizer.ts         # Main orchestrator
│   ├── packageJsonFixer.ts
│   ├── readmeFixer.ts
│   ├── metadataFixer.ts
│   └── rulesetsFixer.ts
├── commands/
│   ├── addRepo.ts
│   └── reposSync.ts
└── index.ts
```

## Development Priorities

1. `settings.ts` (paths + profiles + policies)
2. `github.ts`
3. Core `standardizer.ts` + idempotent fixers
4. `addRepo.ts` and `reposSync.ts`
5. Implement commit strategy + dry-run

