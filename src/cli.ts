/**
 * CLI mode for mcp-kinetic-gain.
 *
 * When invoked with subcommand args, the binary acts as a Suite JSON validator
 * instead of an MCP stdio server. The version field on each input document
 * decides which Kinetic Gain Protocol Suite spec it belongs to; the matching
 * zod schema validates it.
 *
 * Subcommands:
 *   validate <paths...>   Validate JSON file(s) or glob(s) against the 10 specs.
 *   --help, -h            Print usage.
 *   --version, -v         Print the package version.
 *
 * With no subcommand, falls through to MCP stdio server mode.
 */
import { readFile } from "node:fs/promises";
import fg from "fast-glob";
import type { ZodTypeAny } from "zod";

import {
  aeoDocumentSchema,
  agentCardSchema,
  aiEvidenceSchema,
  aiIncidentCardSchema,
  classroomAupSchema,
  clinicalAiCardSchema,
  decisionCardSchema,
  mcpToolCardSchema,
  promptProvenanceSchema,
  studentDisclosureSchema,
  tutorCardSchema,
} from "./schemas.js";

export const PACKAGE_VERSION = "0.5.2";

interface SpecMapping {
  key: string;
  versionField: string;
  displayName: string;
  schema: ZodTypeAny;
}

// Discriminator: top-level version field -> matching zod schema. The order is
// only for human-friendly output; lookup is by field name.
const SPECS: SpecMapping[] = [
  { key: "aeo",                versionField: "aeo_version",              displayName: "AEO Protocol",            schema: aeoDocumentSchema },
  { key: "prompt-provenance",  versionField: "provenance_version",       displayName: "Prompt Provenance",       schema: promptProvenanceSchema },
  { key: "agent-card",         versionField: "agent_card_version",       displayName: "Agent Card",              schema: agentCardSchema },
  { key: "ai-evidence",        versionField: "evidence_version",         displayName: "AI Evidence Format",      schema: aiEvidenceSchema },
  { key: "tool-card",          versionField: "tool_card_version",        displayName: "MCP Tool Card",           schema: mcpToolCardSchema },
  { key: "tutor-card",         versionField: "tutor_card_version",       displayName: "AI Tutor Card",           schema: tutorCardSchema },
  { key: "student-disclosure", versionField: "disclosure_version",       displayName: "Student AI Disclosure",   schema: studentDisclosureSchema },
  { key: "classroom-aup",      versionField: "aup_version",              displayName: "Classroom AI AUP",        schema: classroomAupSchema },
  { key: "clinical-ai",        versionField: "clinical_ai_card_version", displayName: "Clinical AI Card",        schema: clinicalAiCardSchema },
  { key: "ai-incident",        versionField: "incident_card_version",    displayName: "AI Incident Card",        schema: aiIncidentCardSchema },
  { key: "decision-card",      versionField: "decision_card_version",    displayName: "AI Procurement Decision Card", schema: decisionCardSchema },
];

function detectSpec(doc: unknown): SpecMapping | null {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const obj = doc as Record<string, unknown>;
  for (const spec of SPECS) {
    if (Object.prototype.hasOwnProperty.call(obj, spec.versionField)) {
      return spec;
    }
  }
  return null;
}

function isGitHubActions(): boolean {
  return process.env.GITHUB_ACTIONS === "true";
}

function annotate(level: "error" | "warning", message: string, file?: string): void {
  if (!isGitHubActions()) return;
  const fields = file ? `file=${file}` : "";
  process.stdout.write(`::${level} ${fields}::${message}\n`);
}

type ResultStatus = "pass" | "fail" | "unrecognized" | "parse-error" | "config-error";

interface ValidationResult {
  file: string;
  status: ResultStatus;
  spec?: SpecMapping;
  errors?: Array<{ path: string; message: string }>;
  parseError?: string;
}

async function validateFile(filePath: string): Promise<ValidationResult> {
  let raw: string;
  let doc: unknown;
  try {
    raw = await readFile(filePath, "utf8");
    doc = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    annotate("error", `Could not parse JSON: ${message}`, filePath);
    return { file: filePath, status: "parse-error", parseError: message };
  }

  const spec = detectSpec(doc);
  if (!spec) {
    annotate(
      "warning",
      "No recognized Kinetic Gain Protocol Suite version field found at the top level. Skipping.",
      filePath,
    );
    return { file: filePath, status: "unrecognized" };
  }

  const parsed = spec.schema.safeParse(doc);
  if (parsed.success) {
    return { file: filePath, status: "pass", spec };
  }

  const errors = parsed.error.issues.map((issue) => ({
    path: issue.path.length === 0 ? "(root)" : "/" + issue.path.join("/"),
    message: issue.message,
  }));
  for (const e of errors) {
    annotate("error", `${spec.displayName}: ${e.path} ${e.message}`, filePath);
  }
  return { file: filePath, status: "fail", spec, errors };
}

async function expandPatterns(patterns: string[]): Promise<string[]> {
  // fast-glob handles both literal paths and glob patterns. It requires forward
  // slashes; on Windows, callers commonly pass paths with backslashes (from
  // `path.join` or shell expansion), which fast-glob would interpret as glob
  // escape characters. Normalize defensively.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pat of patterns) {
    const normalized = pat.split("\\").join("/");
    const matches = await fg(normalized, {
      onlyFiles: true,
      dot: true,
      followSymbolicLinks: false,
    });
    for (const m of matches) {
      if (!seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(`mcp-kinetic-gain — Kinetic Gain Protocol Suite tooling

USAGE
  mcp-kinetic-gain                       Run the stdio MCP server (default)
  mcp-kinetic-gain validate <paths...>   Validate JSON files / globs against the 10 specs
  mcp-kinetic-gain --help                Print this message
  mcp-kinetic-gain --version             Print the package version

EXAMPLES
  mcp-kinetic-gain validate .well-known/ai-entity.json
  mcp-kinetic-gain validate ".well-known/**/*.json"
  mcp-kinetic-gain validate cards/clinical-ai.json cards/incident-*.json

EXIT CODES
  0   Every matched file passed validation
  1   At least one file failed validation, failed to parse, or hit a config error
  2   No file in the input matched a known Suite spec
  3   Usage error

The version field on each document selects the spec:
  aeo_version, provenance_version, agent_card_version, evidence_version,
  tool_card_version, tutor_card_version, disclosure_version, aup_version,
  clinical_ai_card_version, incident_card_version
`);
}

function printVersion(): void {
  process.stdout.write(`mcp-kinetic-gain v${PACKAGE_VERSION}\n`);
}

export async function runValidate(patterns: string[]): Promise<number> {
  if (patterns.length === 0) {
    process.stderr.write(`mcp-kinetic-gain validate: expected at least one path or glob.\nRun \`mcp-kinetic-gain --help\` for usage.\n`);
    return 3;
  }

  const files = await expandPatterns(patterns);
  if (files.length === 0) {
    process.stdout.write(`mcp-kinetic-gain validate: no files matched ${patterns.map((p) => `"${p}"`).join(", ")}\n`);
    return 0;
  }

  process.stdout.write(`mcp-kinetic-gain validate: ${files.length} file(s) matched\n\n`);

  const results: ValidationResult[] = [];
  for (const file of files) {
    const result = await validateFile(file);
    results.push(result);

    const tag =
      result.status === "pass"          ? "PASS" :
      result.status === "fail"          ? "FAIL" :
      result.status === "unrecognized"  ? "SKIP" :
      result.status === "parse-error"   ? "PARSE-ERROR" :
                                          "CONFIG-ERROR";
    const specLabel = result.spec ? ` [${result.spec.displayName}]` : "";
    process.stdout.write(`  ${tag.padEnd(13)} ${result.file}${specLabel}\n`);

    if (result.status === "fail" && result.errors) {
      for (const e of result.errors) {
        process.stdout.write(`      ${e.path} ${e.message}\n`);
      }
    } else if (result.status === "parse-error" && result.parseError) {
      process.stdout.write(`      ${result.parseError}\n`);
    }
  }

  const counts = {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    unrecognized: results.filter((r) => r.status === "unrecognized").length,
    parseError: results.filter((r) => r.status === "parse-error").length,
    configError: results.filter((r) => r.status === "config-error").length,
  };

  process.stdout.write(
    `\nmcp-kinetic-gain validate summary: ${counts.pass} pass, ${counts.fail} fail, ${counts.unrecognized} skipped, ${counts.parseError} parse error, ${counts.configError} config error\n`,
  );

  if (counts.fail > 0 || counts.parseError > 0 || counts.configError > 0) return 1;
  if (counts.unrecognized > 0 && counts.pass === 0) return 2;
  return 0;
}

/**
 * Dispatch argv. Returns:
 *   - { handled: false } if no subcommand matched (caller should run MCP server)
 *   - { handled: true, exitCode: N } if a subcommand ran (caller should exit N)
 */
export async function dispatchCli(argv: string[]): Promise<{ handled: boolean; exitCode?: number }> {
  // argv[0] = node, argv[1] = script, argv[2] = subcommand or flag
  const cmd = argv[2];

  if (!cmd) {
    return { handled: false };
  }

  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp();
    return { handled: true, exitCode: 0 };
  }

  if (cmd === "--version" || cmd === "-v") {
    printVersion();
    return { handled: true, exitCode: 0 };
  }

  if (cmd === "validate") {
    const code = await runValidate(argv.slice(3));
    return { handled: true, exitCode: code };
  }

  // Unknown flag-like arg. Anything else (positional, unlikely path) falls
  // through to MCP server mode so we don't surprise existing usage.
  if (cmd.startsWith("-")) {
    process.stderr.write(`mcp-kinetic-gain: unknown option ${cmd}\nRun \`mcp-kinetic-gain --help\` for usage.\n`);
    return { handled: true, exitCode: 3 };
  }

  return { handled: false };
}
