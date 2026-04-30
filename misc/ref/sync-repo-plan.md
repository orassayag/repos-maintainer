We will add a new option under "Add Repo" called "Scan Repo".

1. It will have the same emoji in the menu like the "Sync Repos" option.
2. Once selected, the cli will ask the user to enter the repo name or the repo URL.
   2.1. If the repo name or URL were entered, the cli will try to find the repo in the list of repos.
   2.2. If there are no repos, the cli will notify the user and let it recover.
   2.3. If the exact found, the cli will move to the next step.
   2.4. If the exact not found, but similar found, display a dropdown of the suggested repos in a dropdown.
   Take the logic of suggestions and dropdown from the C:\Or\web\projects\events-and-people-syncer project.

3. Once the repo selected, the logic will scan the project according to the following steps:

3.0. Create a log file called "SCAN_REPOS_REPORT.txt" (if exists overwrite it) on the desktop.
3.1. Make sure the project found locally on the C:\Or\web\projects projects folder - If not, list it on the SCAN_REPOS_REPORT.txt report.
3.2. If found locally, need to check that it is synced with git (the hidden .git folder is found) - If not - list it on the SCAN_REPOS_REPORT.txt report.
3.3. If found locally, you need to compare the projects files between the ones in github and the ones found locally. If not equal - list it on the SCAN_REPOS_REPORT.txt report.

4. The next step is to the do the scan logic of the basic template files:
   4.1. Verify that the project has all the files existing in the templates folder. If any file is missing in the project - list it on the SCAN_REPOS_REPORT.txt report.
   4.2. We will also verify the content of the files:
   4.2.1. .gitignore - Verify that content of the .gitignore file included in the scanned project.
   If not, list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   4.2.2. CHANGELOG.md - Verify that the CHANGELOG.md file included in the scanned project.
   If not, list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   4.2.3. CODE_OF_CONDUCT.md - Verify that the CODE_OF_CONDUCT.md file included in the scanned project.
   If not, list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   4.2.4. INSTRUCTIONS.md - Verify that the INSTRUCTIONS.md file included in the scanned project.
   If not, list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   4.2.5. LICENSE.md - Verify that the LICENSE.md file included (expect of the year which can be change from project to project) in the scanned project.
   If not, list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   4.2.6. SECURITY.md - Verify that the SECURITY.md file included in the scanned project.
   If not, list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).

5. The next step is to the do the scan logic of INSTRUCTIONS.md file:
   5.1. INSTRUCTIONS.md - Verify that the INSTRUCTIONS.md file included in the scanned project.
   If not, list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   5.2. On this file the following sections must be included:
   "Setup and Usage Instructions", "Table of Contents", "Prerequisites", "System Requirements",
   "Initial Setup", "Install Dependencies", "Available Commands", "Development Commands",
   "Running Scripts", "Troubleshooting", "Extending the Application", "Best Practices",
   "Documentation", "External Resources", "Author", "Last Updated", "Version"
   5.3. If some of these sections are missing, or the sections are empty - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).

6. The next step is to the do the scan logic of README.md file:
   6.1. README.md - Verify that the README.md file included in the scanned project.
   If not, list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   6.2. The first section of the README.md file needs to be is the repo name. If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   6.3. The "description" right after the repo name must be the same description needs to be with minimum and maximum of the description asked in the cli from the "Add Repo" option (the README.md description step). If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   6.3. On this file the following sections must be included:
   "Features", "Core Capabilities", "Technical Excellence", "Developer Experience",
   "Getting Started", "Prerequisites", "Installation", "Configuration", "Usage",
   "Available Scripts", "Best Practices", "Development", "Architecture Principles",
   "Architecture", "Directory Structure", "Design Patterns", "Contributing",
   "License", "Support", "Author", "Acknowledgments"
   6.4. If some of these sections are missing, or the sections are empty - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).

7. The next step is to the do the scan logic of package.json file:
   7.1. package.json - Verify that the package.json file included in the scanned project.
   If not, list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.2. The "name" field in the package.json file must be the same name as the repo name. If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.3. The "version" field in the package.json file must be the same version as the repo version. If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.4. The "description" field in the package.json file must be the same description as the repo description. If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   The description needs to be with minimum and maximum of the description asked in the cli from the "Add Repo" option (the package.json description step). If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.5. The "repository" field in the package.json file must be the same repository as the repo repository.
   It should contain "type: git" and "url" with the repo name and in the format of:
   "url": "git://github.com/orassayag/\*.git".
   If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.6. The "keywords" field in the package.json.
   The keywords needs to be with minimum and maximum of the keywords / topics asked in the cli from the "Add Repo" option (the keywords / topics step). If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.7. The "main" fields must be exists with a value. If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.8. The "type" must be exists with a value. If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.9. The "scripts" must be exists with a value. If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.10. The "author" must be with the value of "Or Assayag <orassayag@gmail.com>", if not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.11. The "contributors" array section must be with:
   "
   {
   "name": "Or Assayag",
   "email": "orassayag@gmail.com",
   "url": "https://github.com/orassayag"
   }
   "
   if not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.12. The "files" section must be with a list of files. if not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.13. The "license" must be with the value of "MIT", if not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.14. The "dependencies" must be exists with a value. if not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   7.15. The "devDependencies" must be exists with a value. if not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).

8. The next step is to fetch the meta data from the github api of the project:
   8.1. Fetch the repo URL, fetch the description, fetch the website URL declared for the repo,
   fetch the tags / keywords / topics, the rulesets, if starred and if watched.
   if not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   8.2. If any of the values are empty or missing - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   8.3. The description needs to be with minimum and maximum of the description asked in the cli from the "Add Repo" option (minimum 340 and maximum 350) (the GitHub description step). If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing)
   8.4. The website URL declared for the repo should be with the value of "https://linkedin.com/in/orassayag". If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   8.5. The tags / keywords / topics should be IDENTICAL to the ones we declared in the "keywords" section of the package.json file. If not - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
   8.6. If the repo is not starred or not watched - list it on the SCAN_REPOS_REPORT.txt report (Be specific on whats missing).
