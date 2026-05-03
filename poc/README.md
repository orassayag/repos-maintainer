# repo-formatter

A CLI tool that runs your existing lint/format configs across all your repos and reports exactly which files were changed.

No new formatter config is imposed — it detects and uses whatever is **already in each project**.

---

## Setup

```bash
npm install
```

---

## Configuration

Create a `formatter.config.json` in the project root (or pass `--config <path>`):

```json
{
  "reposRoot": "/Users/yourname/projects",
  "exclude": ["archived-repo", "some-vendor-thing"],
  "depth": 1
}
```

| Field | Description | Default |
|---|---|---|
| `reposRoot` | Directory that contains all your repos | required |
| `include` | Only process these repo names (optional) | all |
| `exclude` | Skip these repo names | `[]` |
| `depth` | How deep to search for repos inside `reposRoot` | `1` |

---

## Usage

```bash
# Format everything, using formatter.config.json
npm start

# Quick override — pass root directly
npm start -- --root /Users/yourname/projects

# Dry run: detect formatters per repo, but make no changes
npm run dry-run

# Save a JSON report
npm start -- --json ./report.json

# Use a different config file
npm start -- --config /path/to/my.config.json
```

---

## Supported Formatters

The tool **auto-detects** which formatter each repo uses — no manual config needed.

| Formatter | Detection |
|---|---|
| **Prettier** | `.prettierrc*`, `prettier.config.*`, or `"prettier"` in `package.json` |
| **ESLint** (--fix) | `.eslintrc*`, `eslint.config.*`, or `"eslint"` in `package.json` |
| **Biome** | `biome.json` / `biome.jsonc` |
| **Stylelint** | `.stylelintrc*`, `stylelint.config.*`, or `"stylelint"` in `package.json` |
| **rustfmt** | `Cargo.toml` |
| **gofmt** | `go.mod` |
| **Black** (Python) | `pyproject.toml` with `[tool.black]` section |

Multiple formatters can apply to the same repo (e.g. Prettier + ESLint).

---

## How change detection works

- **Git repos**: uses `git diff --name-only` before/after to get the exact list of changed files.
- **Non-git directories**: falls back to `mtime` comparison.

---

## Example output

```
Repo Formatter  scanning /Users/yourname/projects

Found 5 repo(s):
  • api-service
  • dashboard
  • shared-utils
  • mobile-app
  • docs-site

  Formatting api-service … Prettier, ESLint
  Formatting dashboard … Prettier
  Formatting shared-utils … ESLint
  Formatting mobile-app … Biome
  Formatting docs-site … no formatters detected

───────────────────────────────────────────
  Repo Formatter Report
───────────────────────────────────────────

✔ api-service  (no changes)

✎ dashboard
  Prettier reformatted 3 files:
    → src/components/Header.tsx
    → src/pages/index.tsx
    → src/utils/helpers.ts

✎ shared-utils
  ESLint reformatted 1 file:
    → lib/parser.js

✔ mobile-app  (no changes)

───────────────────────────────────────────
  Scanned 5 repos  │  2 had changes  │  4 files reformatted
───────────────────────────────────────────
```
