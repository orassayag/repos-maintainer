# Refactoring Plan V2 - Repos Maintainer

This document outlines the comprehensive refactoring plan for the Repos Maintainer project, based on the requirements specified in `misc/ref/planv2.txt`.

## 1. Current Architecture Analysis

### Current State
- **Entry Point**: `src/index.ts` handles initial pre-flight checks and branches into either CLI mode or Auto (Sync) mode.
- **CLI**: `src/cli.ts` provides a basic menu using `enquirer`.
- **Commands**: `src/commands/addRepo.ts` and `src/commands/reposSync.ts` contain the high-level orchestration for their respective tasks.
- **Fixers**: `src/fixers/` contains specialized logic for updating READMEs, package.json, and other files.
- **Settings**: `src/settings.ts` centralizes configuration and defaults.

### Identified Pain Points
- **Validation**: Pre-flight validation is functional but needs to be more rigorous and informative as per the new plan.
- **Interactive Flow**: The "Add Repo" command is currently a single-step process (URL input) followed by automated standardization. It lacks the required interactive steps for descriptions and keywords.
- **Error Recovery**: Current prompts don't fully support the "let the user recover" requirement for validation errors in all steps.
- **Template Logic**: Template injection logic is spread across multiple fixers and needs to be unified for the "Add Repo" flow.

## 2. Refactoring Objectives & Success Criteria

### Objectives
- Implement rigorous pre-flight validations (Projects root, Repos list, GitHub auth).
- Refactor the CLI menu to match the desired visual style and selection options.
- Transform the "Add Repo" command into a robust, multi-step interactive wizard.
- Ensure all template injections (CONTRIBUTING, LICENSE, etc.) follow the specific replacement rules.
- Automate the update of `package.json` with dynamic dependencies and keywords.
- Finalize the flow with clean Git operations (add, commit, push).

### Success Criteria
- All validation steps from `planv2.txt` are implemented and functional.
- The "Add Repo" command successfully prompts for and validates all required fields (README desc, package.json desc, GitHub desc, Keywords).
- Templates are correctly injected with dynamic values (Repo name, Year).
- `package.json` is updated with latest package versions and keywords.
- The project remains stable and maintainable after the `src/` directory refactor.

## 3. Implementation Roadmap

### Milestone 1: Pre-flight & Menu (The Shell)
- [ ] Refactor `src/index.ts` to implement strict pre-flight checks with enhanced logging.
- [ ] Update `src/cli.ts` to match the "🚀 Repos Maintainer starting..." visual style and menu options.

### Milestone 2: Interactive "Add Repo" Wizard
- [ ] Implement URL validation and extraction logic in `src/commands/addRepo.ts`.
- [ ] Create interactive prompt steps for:
    - README description (340-600 chars).
    - package.json description (120-300 chars).
    - GitHub project description (340-350 chars).
    - Keywords/Topics (8-20 unique items).
- [ ] Implement "user recovery" logic for each prompt.

### Milestone 3: Template & Package Logic
- [ ] Refactor template injection logic to handle:
    - `.gitignore`, `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (no changes).
    - `CONTRIBUTING.md` (Repo name replacement).
    - `LICENSE` (Year replacement).
- [ ] Implement `package.json` injection:
    - Name and URL updates.
    - Keywords addition.
    - Dynamic dependency version fetching.
    - "pnpm i" execution and lockfile verification.

### Milestone 4: Git Operations & Finalization
- [ ] Implement Git flow: `git add .`, `git commit`, `git push --force-with-lease`.
- [ ] Add final "Repo created successfully" confirmation.

### Milestone 5: General Structure Improvement
- [ ] Clean up redundant code in `src/fixers/` and `src/utils/`.
- [ ] Ensure consistent logging and error handling across the project.

## 4. Risk Assessment & Mitigation

| Risk | Impact | Mitigation Strategy |
| :--- | :--- | :--- |
| GitHub API rate limiting | Medium | Use cached results where possible; provide clear error messages if limited. |
| Invalid Repo URL/Permissions | High | Robust validation before proceeding; informative error messages for recovery. |
| Template injection errors | Medium | Dry-run validation of templates before writing to disk. |
| Network issues during `pnpm i` | Medium | Retry logic or informative failure messages; let the user re-run the step. |

## 5. Testing Strategy
- **Manual End-to-End Test**: Run the "Add Repo" command and walk through every prompt and validation step.
- **Unit Testing**:
    - Validate URL parsing logic.
    - Validate character count constraints for descriptions.
    - Validate keyword deduplication and count.
- **Template Verification**: Check injected files in a test repository to ensure placeholders are replaced correctly.

## 6. Rollback Plan
- Since the project is version-controlled with Git, any critical issues can be resolved by reverting to the last known stable commit.
- For local file changes during the "Add Repo" process, the script will operate within the newly cloned repo directory, minimizing risk to existing projects.

## 7. Resource Requirements & Timeline Estimates
- **Environment**: Local Windows setup with Node.js, pnpm, and Git.
- **Timeline**: 
    - Milestone 1 & 2: ~1-2 hours.
    - Milestone 3 & 4: ~2 hours.
    - Milestone 5 & Verification: ~1 hour.
