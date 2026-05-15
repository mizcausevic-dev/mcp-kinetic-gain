/**
 * Cross-spec operations that work over any Kinetic Gain Suite document.
 *
 * - suite_doc_detect_spec  : which spec is this JSON document? (sniffs *_version)
 * - suite_doc_drift        : structural diff between two versions of a doc
 *
 * Both mirror behavior from `aeo-validator-service` and `incident-correlation-rs`
 * at preview scale — no fetch, no persistent state.
 */

import { canonicalJsonSha256, pretty } from "../common.js";

/**
 * Map of `*_version` field name -> spec slug. Same vocabulary as the
 * `aeo-validator-service` validator's spec sniffer and the
 * `aeo-graph-explorer-rs` graph node `NodeKind`.
 */
const SPEC_BY_VERSION_FIELD: Record<string, string> = {
  aeo_version: "aeo",
  provenance_version: "prompt-provenance",
  agent_card_version: "agent-card",
  evidence_version: "ai-evidence",
  tool_card_version: "tool-card",
  tutor_card_version: "tutor-card",
  disclosure_version: "student-ai-disclosure",
  aup_version: "classroom-aup",
  clinical_ai_card_version: "clinical-ai",
  incident_card_version: "incident-card",
  decision_card_version: "decision-card",
};

/**
 * Detect which Suite spec a JSON document is. Returns `{ spec, version }`
 * — `spec: "unknown"` and `version: null` when no `*_version` field is
 * recognised.
 */
export async function handleSuiteDocDetectSpec(args: { body: unknown }): Promise<string> {
  if (typeof args.body !== "object" || args.body === null || Array.isArray(args.body)) {
    return pretty({ error: "`body` must be a JSON object" });
  }
  const obj = args.body as Record<string, unknown>;
  for (const [field, spec] of Object.entries(SPEC_BY_VERSION_FIELD)) {
    if (field in obj) {
      const version = obj[field];
      return pretty({
        spec,
        version_field: field,
        version: typeof version === "string" ? version : null,
      });
    }
  }
  return pretty({ spec: "unknown", version_field: null, version: null });
}

/**
 * Structural diff between two versions of the same doc. Mirrors the
 * `DriftReport` shape `aeo-validator-service` emits.
 */
export async function handleSuiteDocDrift(args: {
  before: unknown;
  after: unknown;
}): Promise<string> {
  if (typeof args.before !== "object" || args.before === null || Array.isArray(args.before)) {
    return pretty({ error: "`before` must be a JSON object" });
  }
  if (typeof args.after !== "object" || args.after === null || Array.isArray(args.after)) {
    return pretty({ error: "`after` must be a JSON object" });
  }
  const before = args.before as Record<string, unknown>;
  const after = args.after as Record<string, unknown>;

  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));

  const added = [...afterKeys].filter((k) => !beforeKeys.has(k)).sort();
  const removed = [...beforeKeys].filter((k) => !afterKeys.has(k)).sort();
  const changed: string[] = [];
  for (const k of beforeKeys) {
    if (!afterKeys.has(k)) continue;
    if (canonicalJsonSha256(before[k]) !== canonicalJsonSha256(after[k])) {
      changed.push(k);
    }
  }
  changed.sort();

  const beforeHash = canonicalJsonSha256(before);
  const afterHash = canonicalJsonSha256(after);
  const beforeSpec = detectSpecField(before);
  const afterSpec = detectSpecField(after);

  return pretty({
    drifted:
      beforeHash !== afterHash ||
      beforeSpec.spec !== afterSpec.spec ||
      added.length > 0 ||
      removed.length > 0 ||
      changed.length > 0,
    spec_before: beforeSpec.spec,
    spec_after: afterSpec.spec,
    spec_changed: beforeSpec.spec !== afterSpec.spec,
    content_hash_before: beforeHash,
    content_hash_after: afterHash,
    added_fields: added,
    removed_fields: removed,
    changed_fields: changed,
  });
}

function detectSpecField(obj: Record<string, unknown>): { spec: string } {
  for (const [field, spec] of Object.entries(SPEC_BY_VERSION_FIELD)) {
    if (field in obj) return { spec };
  }
  return { spec: "unknown" };
}
