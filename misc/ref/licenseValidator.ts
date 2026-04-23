/**
 * licenseValidator.ts
 * Validates LICENSE files across repositories for the "repos-maintainer" project.
 */

export type LicenseType = "MIT" | "Apache-2.0" | "GPL-3.0" | "BSD-2-Clause" | "BSD-3-Clause" | "ISC" | "Unknown";

export interface ValidationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  suggestion?: string;
}

export interface LicenseValidationResult {
  valid: boolean;
  licenseType: LicenseType;
  detectedYear?: number;
  detectedAuthor?: string;
  issues: ValidationIssue[];
  summary: string;
}

// ─── Canonical Templates ────────────────────────────────────────────────────

const MIT_REQUIRED_PHRASES = [
  "permission is hereby granted, free of charge",
  "to deal in the software without restriction",
  "the above copyright notice and this permission notice shall be included",
  "the software is provided \"as is\"",
  "without warranty of any kind",
  "in no event shall the authors or copyright holders be liable",
];

const APACHE_REQUIRED_PHRASES = [
  "apache license",
  "version 2.0",
  "licensed under the apache license",
  "redistribution and use in source and binary forms",
];

const GPL3_REQUIRED_PHRASES = [
  "gnu general public license",
  "version 3",
  "free software foundation",
  "you may copy, distribute and modify the software",
];

const BSD2_REQUIRED_PHRASES = [
  "redistribution and use in source and binary forms",
  "redistributions of source code must retain the above copyright notice",
  "redistributions in binary form must reproduce the above copyright notice",
];

const BSD3_REQUIRED_PHRASES = [
  ...BSD2_REQUIRED_PHRASES,
  "neither the name",
  "may not be used to endorse or promote",
];

const ISC_REQUIRED_PHRASES = [
  "permission to use, copy, modify, and/or distribute this software",
  "isc",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Fuzzy match that tolerates smart-quotes, dash variants, and collapsed
 * whitespace — but does NOT strip all punctuation to avoid false positives.
 */
function includesFuzzy(text: string, phrase: string): boolean {
  const simplify = (s: string) =>
    s
      .replace(/[\u2018\u2019]/g, "'")   // smart single quotes → '
      .replace(/[\u201C\u201D]/g, '"')   // smart double quotes → "
      .replace(/[\u2013\u2014]/g, "-")   // en/em dash → -
      .replace(/\s+/g, " ")              // collapse whitespace
      .trim();
  return simplify(text).includes(simplify(phrase));
}

/** Expects an already-normalized (lowercased, whitespace-collapsed) string. */
function detectLicenseType(lower: string): LicenseType {

  // SPDX identifier takes priority — very common in modern repos
  const spdxMatch = lower.match(/spdx-license-identifier:\s*([a-z0-9\-.]+)/);
  if (spdxMatch) {
    const id = spdxMatch[1].toUpperCase();
    const spdxMap: Record<string, LicenseType> = {
      "MIT": "MIT",
      "APACHE-2.0": "Apache-2.0",
      "GPL-3.0": "GPL-3.0",
      "GPL-3.0-ONLY": "GPL-3.0",
      "GPL-3.0-OR-LATER": "GPL-3.0",
      "BSD-2-CLAUSE": "BSD-2-Clause",
      "BSD-3-CLAUSE": "BSD-3-Clause",
      "ISC": "ISC",
    };
    if (spdxMap[id]) return spdxMap[id];
  }

  // Multi-signal heuristics — require multiple phrases to avoid false positives.
  // Uses includesFuzzy so smart-quotes and en-dashes in real-world files don't
  // cause mis-detection as "Unknown".
  const has = (...phrases: string[]) => phrases.every((p) => includesFuzzy(lower, p));

  if (has("permission is hereby granted", "free of charge", "the software is provided \"as is\"")) return "MIT";
  if (has("apache license", "version 2.0", "licensed under the apache license")) return "Apache-2.0";
  if (has("gnu general public license", "version 3", "free software foundation")) return "GPL-3.0";
  if (has("isc", "permission to use, copy")) return "ISC";

  // BSD variants — order matters: check 3-clause before 2-clause
  if (has("neither the name", "endorse or promote")) return "BSD-3-Clause";
  if (includesFuzzy(lower, "redistribution and use in source and binary forms")) return "BSD-2-Clause";

  return "Unknown";
}

function extractCopyrightYear(content: string): number | undefined {
  // Prefer the end year of a range (2020-2026 → 2026) so the future-year
  // warning and staleness checks use the most recent declared year.
  const rangeMatch = content.match(/copyright\s+(?:\(c\)|©|&copy;)?\s*\d{4}-(\d{4})/i);
  if (rangeMatch) return parseInt(rangeMatch[1], 10);

  const match = content.match(/copyright\s+(?:\(c\)|©|&copy;)?\s*(\d{4})/i);
  return match ? parseInt(match[1], 10) : undefined;
}

function extractCopyrightAuthor(content: string): string | undefined {
  const match = content.match(
    /copyright\s+(?:\(c\)|©|&copy;)?\s*(?:\d{4}(?:-\d{4})?)\s+(.+)/i
  );
  if (!match) return undefined;
  // Stop at the first line break — never bleed into body text
  return match[1].split("\n")[0].trim();
}

// ─── Per-type validators ──────────────────────────────────────────────────────

function validateMIT(normalized: string, issues: ValidationIssue[]): void {
  for (const phrase of MIT_REQUIRED_PHRASES) {
    if (!includesFuzzy(normalized, phrase)) {
      issues.push({
        severity: "error",
        code: "MIT_MISSING_CLAUSE",
        message: `MIT license is missing required clause: "${phrase}"`,
        suggestion: "Restore the full MIT license text from https://opensource.org/licenses/MIT",
      });
    }
  }
}

function validateApache(normalized: string, issues: ValidationIssue[]): void {
  for (const phrase of APACHE_REQUIRED_PHRASES) {
    if (!includesFuzzy(normalized, phrase)) {
      issues.push({
        severity: "error",
        code: "APACHE_MISSING_CLAUSE",
        message: `Apache 2.0 license is missing required clause: "${phrase}"`,
        suggestion: "Restore the full Apache 2.0 license from https://www.apache.org/licenses/LICENSE-2.0",
      });
    }
  }
}

function validateGPL3(normalized: string, issues: ValidationIssue[]): void {
  for (const phrase of GPL3_REQUIRED_PHRASES) {
    if (!includesFuzzy(normalized, phrase)) {
      issues.push({
        severity: "error",
        code: "GPL3_MISSING_CLAUSE",
        message: `GPL-3.0 license is missing required clause: "${phrase}"`,
        suggestion: "Restore the full GPL-3.0 license from https://www.gnu.org/licenses/gpl-3.0.txt",
      });
    }
  }
}

function validateBSD(normalized: string, variant: "BSD-2-Clause" | "BSD-3-Clause", issues: ValidationIssue[]): void {
  const phrases = variant === "BSD-3-Clause" ? BSD3_REQUIRED_PHRASES : BSD2_REQUIRED_PHRASES;
  for (const phrase of phrases) {
    if (!includesFuzzy(normalized, phrase)) {
      issues.push({
        severity: "error",
        code: `${variant.replace("-", "_")}_MISSING_CLAUSE`,
        message: `${variant} license is missing required clause: "${phrase}"`,
        suggestion: `Restore the full ${variant} license from https://opensource.org/licenses/${variant}`,
      });
    }
  }
}

function validateISC(normalized: string, issues: ValidationIssue[]): void {
  for (const phrase of ISC_REQUIRED_PHRASES) {
    if (!includesFuzzy(normalized, phrase)) {
      issues.push({
        severity: "error",
        code: "ISC_MISSING_CLAUSE",
        message: `ISC license is missing required clause: "${phrase}"`,
        suggestion: "Restore the full ISC license from https://opensource.org/licenses/ISC",
      });
    }
  }
}

// ─── Structural checks (apply to all license types) ───────────────────────────

// Conservative lower bounds based on official template lengths.
// Still catches obviously truncated files without false-positives on valid ones.
const LICENSE_MIN_LENGTH: Record<LicenseType, number> = {
  "MIT":            900,   // official MIT template + typical copyright line
  "Apache-2.0":   10000,   // official Apache 2.0 is ~11.5k chars
  "GPL-3.0":      34000,   // official GPL-3.0 is ~34k+ chars
  "BSD-2-Clause":  1400,   // official BSD-2-Clause
  "BSD-3-Clause":  1600,   // official BSD-3-Clause
  "ISC":            400,   // official ISC
  "Unknown":        100,
};

function validateStructure(content: string, licenseType: LicenseType, issues: ValidationIssue[]): void {
  const trimmed = content.trim();

  // Empty file — bail early, nothing else will make sense
  if (trimmed.length === 0) {
    issues.push({ severity: "error", code: "EMPTY_FILE", message: "LICENSE file is empty." });
    return;
  }

  const minLength = LICENSE_MIN_LENGTH[licenseType];
  if (trimmed.length < minLength) {
    issues.push({
      severity: licenseType === "Unknown" ? "warning" : "error",
      code: "TOO_SHORT",
      message: `LICENSE file is too short for a ${licenseType} license (${trimmed.length} chars, expected ≥ ${minLength}).`,
      suggestion: "Add the full license text.",
    });
  }

  // Copyright line
  if (!/copyright/i.test(content)) {
    issues.push({
      severity: "error",
      code: "MISSING_COPYRIGHT",
      message: 'No "Copyright" statement found.',
      suggestion: 'Add a line like: Copyright (c) <YEAR> <AUTHOR>',
    });
  } else {
    const year = extractCopyrightYear(content);
    if (!year) {
      issues.push({
        severity: "warning",
        code: "MISSING_YEAR",
        message: "Could not detect a year in the copyright statement.",
        suggestion: "Ensure the copyright line includes a 4-digit year.",
      });
    } else {
      const currentYear = new Date().getFullYear();
      if (year < 1970) {
        issues.push({ severity: "warning", code: "SUSPICIOUS_YEAR", message: `Copyright year ${year} looks suspicious.` });
      }
      if (year > currentYear) {
        issues.push({
          severity: "warning",
          code: "FUTURE_YEAR",
          message: `Copyright year ${year} is in the future.`,
          suggestion: `Use ${currentYear} or a valid range.`,
        });
      }
    }

    const author = extractCopyrightAuthor(content);
    if (!author || author.trim().length === 0) {
      issues.push({
        severity: "error",
        code: "MISSING_AUTHOR",
        message: "No author name found in copyright statement.",
        suggestion: 'Add your name or organisation after the year: Copyright (c) 2026 Your Name',
      });
    } else {
      const placeholders = ["your name", "<author>", "[author]", "author name", "owner", "<n>"];
      if (placeholders.some((p) => author.toLowerCase().includes(p))) {
        issues.push({
          severity: "error",
          code: "PLACEHOLDER_AUTHOR",
          message: `Copyright author appears to be a placeholder: "${author}"`,
          suggestion: "Replace with your actual name or organisation.",
        });
      }
    }
  }

  const lines = content.split("\n");
  const trailingSpaceLines = lines
    .map((l, i) => ({ line: i + 1, text: l }))
    .filter(({ text }) => /\s+$/.test(text));
  if (trailingSpaceLines.length > 0) {
    issues.push({
      severity: "info",
      code: "TRAILING_WHITESPACE",
      message: `Trailing whitespace found on ${trailingSpaceLines.length} line(s): ${trailingSpaceLines.map((l) => l.line).join(", ")}`,
      suggestion: "Run a trim/lint pass on the file.",
    });
  }

  // © and similar are valid in licenses; flag as info, not error
  if (/[^\x00-\x7F]/.test(content)) {
    issues.push({
      severity: "info",
      code: "NON_ASCII_CHARS",
      message: "LICENSE file contains non-ASCII characters.",
      suggestion: "Ensure the file is saved as UTF-8 if this is intentional (e.g. © symbol).",
    });
  }

  if (!content.endsWith("\n")) {
    issues.push({
      severity: "info",
      code: "MISSING_FINAL_NEWLINE",
      message: "LICENSE file does not end with a newline.",
      suggestion: "Add a newline at the end of the file.",
    });
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Validates the content of a LICENSE file.
 *
 * @param content - Raw string content of the LICENSE file.
 * @returns A {@link LicenseValidationResult} describing all findings.
 *
 * @example
 * ```ts
 * import { validateLicense } from "./licenseValidator";
 * import fs from "fs";
 *
 * const content = fs.readFileSync("LICENSE", "utf-8");
 * const result = validateLicense(content);
 * console.log(result);
 * ```
 */
export function validateLicense(content: string): LicenseValidationResult {
  const issues: ValidationIssue[] = [];

  // Normalize once — reused by detection, clause validation, and structural checks
  const normalized = normalize(content);

  const licenseType = detectLicenseType(normalized);

  validateStructure(content, licenseType, issues);

  if (licenseType === "Unknown") {
    issues.push({
      severity: "error",
      code: "UNKNOWN_LICENSE_TYPE",
      message: "Could not detect a known open-source license type.",
      suggestion:
        "Ensure the file starts with a recognizable header such as 'MIT License', 'Apache License 2.0', etc.",
    });
  }

  switch (licenseType) {
    case "MIT":           validateMIT(normalized, issues);               break;
    case "Apache-2.0":   validateApache(normalized, issues);            break;
    case "GPL-3.0":      validateGPL3(normalized, issues);              break;
    case "BSD-2-Clause": validateBSD(normalized, "BSD-2-Clause", issues); break;
    case "BSD-3-Clause": validateBSD(normalized, "BSD-3-Clause", issues); break;
    case "ISC":          validateISC(normalized, issues);               break;
  }

  const errorCount   = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const valid        = errorCount === 0;

  const summary =
    errorCount > 0
      ? `❌ LICENSE has ${errorCount} error(s) and ${warningCount} warning(s) [${licenseType}]`
      : warningCount > 0
      ? `⚠️  LICENSE is valid but has ${warningCount} warning(s) (${licenseType})`
      : `✅ LICENSE is valid (${licenseType})`;

  return {
    valid,
    licenseType,
    detectedYear:   extractCopyrightYear(content),
    detectedAuthor: extractCopyrightAuthor(content),
    issues,
    summary,
  };
}

// ─── CLI / quick-run helper ───────────────────────────────────────────────────

/**
 * Pretty-prints a {@link LicenseValidationResult} to the console.
 */
export function printValidationResult(result: LicenseValidationResult): void {
  console.log("\n" + result.summary);
  console.log(`   Type   : ${result.licenseType}`);
  if (result.detectedYear)   console.log(`   Year   : ${result.detectedYear}`);
  if (result.detectedAuthor) console.log(`   Author : ${result.detectedAuthor}`);

  if (result.issues.length === 0) {
    console.log("   No issues found.\n");
    return;
  }

  console.log("\n   Issues:");
  for (const issue of result.issues) {
    const icon = issue.severity === "error" ? "🔴" : issue.severity === "warning" ? "🟡" : "🔵";
    console.log(`   ${icon} [${issue.code}] ${issue.message}`);
    if (issue.suggestion) console.log(`      → ${issue.suggestion}`);
  }
  console.log();
}
