import * as fs from "fs";
import * as path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  hint?: string;
}

export interface ValidationResult {
  repoPath: string;
  filePath: string | null;
  isValid: boolean;
  issues: ValidationIssue[];
}

// ─── Section rules ────────────────────────────────────────────────────────────

interface SectionRule {
  /** Human-readable name shown in messages */
  name: string;
  /** All of these patterns must appear somewhere in the file */
  requiredPatterns: RegExp[];
  /** Error codes for each required pattern (same order) */
  missingCodes: string[];
  /** Messages for each missing pattern (same order) */
  missingMessages: string[];
  /** Optional hint per pattern */
  hints?: (string | undefined)[];
}

const SECTION_RULES: SectionRule[] = [
  {
    name: "Introduction / welcome statement",
    requiredPatterns: [
      /contributions?\s+to\s+this\s+project/i,
      /everyone\s+is\s+welcome|welcome\s+to\s+contribute/i,
    ],
    missingCodes: ["CONTRIB-001", "CONTRIB-002"],
    missingMessages: [
      "Missing introductory statement about contributions to the project.",
      "Missing a welcoming statement for contributors.",
    ],
    hints: [
      "Add an opening paragraph describing that contributions are released under the project license.",
      'Add a sentence like "Everyone is welcome to contribute to this project."',
    ],
  },
  {
    name: "Reporting Issues section",
    requiredPatterns: [
      /##\s+.*reporting\s+issues?/i,
      /github\s+issues?/i,
      /steps?\s+to\s+reproduce/i,
      /expected.*actual|actual.*expected/i,
      /os.*node|node.*os|environment\s+details/i,
    ],
    missingCodes: [
      "CONTRIB-010",
      "CONTRIB-011",
      "CONTRIB-012",
      "CONTRIB-013",
      "CONTRIB-014",
    ],
    missingMessages: [
      'Missing "Reporting Issues" section header.',
      "Missing reference to GitHub Issues tracker.",
      "Missing instruction to provide steps to reproduce for bugs.",
      "Missing instruction to describe expected vs actual behavior.",
      "Missing instruction to include environment details (OS, Node version).",
    ],
    hints: [
      'Add a "## Reporting Issues" (or nested) section.',
      "Mention the GitHub Issues URL where users should file bugs.",
      "Ask reporters to include numbered steps to reproduce the problem.",
      "Ask reporters to describe both expected and actual behavior.",
      "Ask reporters to include OS, Node.js version, and other relevant env info.",
    ],
  },
  {
    name: "Pull Requests section",
    requiredPatterns: [
      /##\s+.*pull\s+requests?|submitting\s+pull\s+requests?/i,
      /fork\s+the\s+repo/i,
      /git\s+checkout\s+-b|create\s+a\s+new\s+branch/i,
      /commit.*clear|descriptive.*commit|commit.*message/i,
    ],
    missingCodes: [
      "CONTRIB-020",
      "CONTRIB-021",
      "CONTRIB-022",
      "CONTRIB-023",
    ],
    missingMessages: [
      'Missing "Submitting Pull Requests" section.',
      "Missing instruction to fork the repository.",
      "Missing instruction to create a feature/fix branch.",
      "Missing instruction to write clear, descriptive commit messages.",
    ],
    hints: [
      'Add a "### Submitting Pull Requests" section with a numbered workflow.',
      'Add step: "Fork the repository".',
      'Add step: "Create a new branch: git checkout -b feature/your-feature-name".',
      'Add step: "Commit with clear, descriptive messages".',
    ],
  },
  {
    name: "Code Style / Standards section",
    requiredPatterns: [
      /##\s+.*code\s+(style|standards?|guidelines?)|coding\s+standards?/i,
      /eslint|prettier|linter/i,
      /pnpm\s+(format|lint|build|test)|npm\s+run|yarn\s+run/i,
    ],
    missingCodes: ["CONTRIB-030", "CONTRIB-031", "CONTRIB-032"],
    missingMessages: [
      'Missing "Code Style" or "Coding Standards" section.',
      "Missing reference to a linter or formatter (e.g. ESLint, Prettier).",
      "Missing pre-submission commands (format / lint / build / test).",
    ],
    hints: [
      'Add a "### Code Style Guidelines" section.',
      "State which linter/formatter is used (ESLint, Prettier, etc.).",
      "List the commands contributors should run before opening a PR.",
    ],
  },
  {
    name: "Error Code Management section",
    requiredPatterns: [
      /error.{0,30}code/i,
      /error_index|error\s+index/i,
      /\[ERROR-[A-Z0-9]+\]|\[ERROR-XXXXXXX\]/i,
    ],
    missingCodes: ["CONTRIB-040", "CONTRIB-041", "CONTRIB-042"],
    missingMessages: [
      "Missing section that explains the project's error code convention.",
      "Missing reference to the error_index file.",
      "Missing the error code format example (e.g. [ERROR-XXXXXXX]).",
    ],
    hints: [
      'Add an "### Error Code Management" section.',
      'Reference "misc/error_index.txt" as the source of truth for error codes.',
      'Show the format: "[ERROR-XXXXXXX] at the start of the error message".',
    ],
  },
  {
    name: "Contact / Help section",
    requiredPatterns: [
      /questions?|need\s+help|contact/i,
      /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}|github\.com\//i,
    ],
    missingCodes: ["CONTRIB-050", "CONTRIB-051"],
    missingMessages: [
      'Missing a "Questions or Need Help?" (or similar) section.',
      "Missing maintainer contact information (email or GitHub profile).",
    ],
    hints: [
      'Add a "## Questions or Need Help?" section at the bottom.',
      "Include at least one contact method: email, GitHub profile, or similar.",
    ],
  },
  {
    name: "License reference",
    requiredPatterns: [
      /open\s+source\s+license|project.*license|license/i,
    ],
    missingCodes: ["CONTRIB-060"],
    missingMessages: [
      "Missing a reference to the project's open-source license.",
    ],
    hints: [
      'Add a sentence like "Contributions are released under the project\'s open source license."',
    ],
  },
];

// ─── Format checks ────────────────────────────────────────────────────────────

interface FormatCheck {
  code: string;
  severity: "error" | "warning";
  test: (content: string) => boolean;
  message: string;
  hint?: string;
}

const FORMAT_CHECKS: FormatCheck[] = [
  {
    code: "CONTRIB-100",
    severity: "error",
    test: (c) => c.trim().length > 0,
    message: "CONTRIBUTING.md is empty.",
    hint: "Add contribution guidelines to the file.",
  },
  {
    code: "CONTRIB-101",
    severity: "warning",
    test: (c) => c.trim().length >= 300,
    message: "CONTRIBUTING.md is very short (under 300 characters). It may be a placeholder.",
    hint: "Expand the file with actionable contribution guidelines.",
  },
  {
    code: "CONTRIB-102",
    severity: "error",
    test: (c) => /^#\s+.+/m.test(c),
    message: "CONTRIBUTING.md has no top-level heading (# Title).",
    hint: 'Add a top-level heading such as "# Contributing".',
  },
  {
    code: "CONTRIB-103",
    severity: "warning",
    test: (c) => !/TODO|FIXME|TBD|placeholder/i.test(c),
    message: "CONTRIBUTING.md contains placeholder text (TODO / FIXME / TBD).",
    hint: "Replace all placeholder sections with real content.",
  },
  {
    code: "CONTRIB-104",
    severity: "warning",
    test: (c) => /```/.test(c),
    message: "CONTRIBUTING.md has no fenced code blocks.",
    hint: "Add at least one code block showing branch creation or pre-submission commands.",
  },
];

// ─── Core validator ───────────────────────────────────────────────────────────

/**
 * Validates a single CONTRIBUTING.md file and returns a structured result.
 *
 * @param repoPath  - Absolute path to the repository root.
 * @param filePath  - Optional override path to the CONTRIBUTING.md file.
 *                    Defaults to `<repoPath>/CONTRIBUTING.md`.
 */
export function validateContributing(
  repoPath: string,
  filePath?: string
): ValidationResult {
  const resolvedFilePath =
    filePath ?? path.join(repoPath, "CONTRIBUTING.md");

  const result: ValidationResult = {
    repoPath,
    filePath: resolvedFilePath,
    isValid: true,
    issues: [],
  };

  // ── 1. File existence ──────────────────────────────────────────────────────
  if (!fs.existsSync(resolvedFilePath)) {
    result.isValid = false;
    result.filePath = null;
    result.issues.push({
      code: "CONTRIB-000",
      severity: "error",
      message: "CONTRIBUTING.md does not exist in the repository.",
      hint: "Create a CONTRIBUTING.md file at the root of the repository.",
    });
    return result;
  }

  // ── 2. Read content ────────────────────────────────────────────────────────
  const content = fs.readFileSync(resolvedFilePath, "utf-8");

  // ── 3. Format checks ───────────────────────────────────────────────────────
  for (const check of FORMAT_CHECKS) {
    if (!check.test(content)) {
      result.issues.push({
        code: check.code,
        severity: check.severity,
        message: check.message,
        hint: check.hint,
      });
    }
  }

  // If empty, skip all further checks — nothing to match against.
  if (content.trim().length === 0) {
    result.isValid = false;
    return result;
  }

  // ── 4. Section / pattern checks ───────────────────────────────────────────
  for (const rule of SECTION_RULES) {
    rule.requiredPatterns.forEach((pattern, idx) => {
      if (!pattern.test(content)) {
        result.issues.push({
          code: rule.missingCodes[idx],
          severity: "error",
          message: `[${rule.name}] ${rule.missingMessages[idx]}`,
          hint: rule.hints?.[idx],
        });
      }
    });
  }

  // ── 5. Derive overall validity ─────────────────────────────────────────────
  result.isValid = result.issues.every((i) => i.severity !== "error");

  return result;
}

// ─── Multi-repo helper ────────────────────────────────────────────────────────

/**
 * Validates CONTRIBUTING.md across multiple repository roots and prints
 * a human-readable report to stdout.
 *
 * @param repoPaths - Array of absolute paths to repository roots.
 */
export function validateAllContributing(repoPaths: string[]): void {
  const results = repoPaths.map((p) => validateContributing(p));

  const passed = results.filter((r) => r.isValid);
  const failed = results.filter((r) => !r.isValid);

  console.log("─".repeat(60));
  console.log(`CONTRIBUTING.md Validation Report`);
  console.log(`Repos checked: ${results.length}  |  ✅ ${passed.length}  |  ❌ ${failed.length}`);
  console.log("─".repeat(60));

  for (const result of results) {
    const icon = result.isValid ? "✅" : "❌";
    const label = path.basename(result.repoPath);
    console.log(`\n${icon}  ${label}  (${result.repoPath})`);

    if (result.filePath === null) {
      console.log("   ⚠  File not found.");
    }

    if (result.issues.length === 0) {
      console.log("   No issues found.");
      continue;
    }

    const errors = result.issues.filter((i) => i.severity === "error");
    const warnings = result.issues.filter((i) => i.severity === "warning");

    if (errors.length) {
      console.log(`\n   Errors (${errors.length}):`);
      for (const issue of errors) {
        console.log(`     [${issue.code}] ❌ ${issue.message}`);
        if (issue.hint) console.log(`             💡 ${issue.hint}`);
      }
    }

    if (warnings.length) {
      console.log(`\n   Warnings (${warnings.length}):`);
      for (const issue of warnings) {
        console.log(`     [${issue.code}] ⚠  ${issue.message}`);
        if (issue.hint) console.log(`             💡 ${issue.hint}`);
      }
    }
  }

  console.log("\n" + "─".repeat(60));
}
