/**
 * AI Claims Decision Card (InsurTech) — 12th Suite spec.
 *
 * Tools for the buyer/insurer-side claims-adjudication artifact defined at
 * github.com/mizcausevic-dev/ai-claims-decision-card-spec (v0.1). Detection
 * key is `claims_card_version` (distinct from the procurement Decision Card's
 * `decision_card_version`).
 *
 *   claims_card_validate  — structural validity + first-failing-check reason
 *   claims_card_inspect   — structured summary
 *   claims_card_sign      — canonical SHA-256 (attestation-excluded) for offline ed25519 signing
 *   claims_card_chain     — link a card to its predecessor (chain_index + prev_card_hash)
 *
 * All four take the card as a parsed object (`document` / `card`), never a
 * JSON string, and use only Node built-ins (crypto). Zero new dependencies.
 */
import { createHash } from "node:crypto";

import { pretty } from "../common.js";

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Canonical JSON: object keys sorted lexicographically at every level, no
 * insignificant whitespace. Byte-identical to `common.canonicalJson`, but
 * kept local so this handler can hash a *stripped* copy and return a raw
 * 64-char hex digest (the spec's `attestation.card_hash` shape) rather than
 * the `sha256:`-prefixed form the shared helper emits.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, sortKeysDeep(obj[k])]),
    );
  }
  return value;
}

type AnyRecord = Record<string, any>;

// ---------------------------------------------------------------------------
// claims_card_validate
// ---------------------------------------------------------------------------
export async function handleClaimsCardValidate(args: { document: AnyRecord }): Promise<string> {
  const d = args?.document;
  if (d === null || typeof d !== "object" || Array.isArray(d)) {
    return pretty({ valid: false, reason: "`document` must be a JSON object" });
  }

  if (d.claims_card_version === undefined) {
    return pretty({ valid: false, reason: "missing `claims_card_version` (is this a Claims Decision Card?)" });
  }

  const requiredTop = ["claim", "decision", "evidence_bundle", "governance", "attestation", "disclaimer"];
  for (const key of requiredTop) {
    if (d[key] === undefined) {
      return pretty({ valid: false, reason: `missing required top-level key: ${key}` });
    }
  }

  const validOutcomes = ["approve", "deny", "pend", "refer"];
  if (!validOutcomes.includes(d.decision?.outcome)) {
    return pretty({
      valid: false,
      reason: `decision.outcome must be one of ${validOutcomes.join(", ")}`,
    });
  }

  if (!Array.isArray(d.evidence_bundle?.sources) || d.evidence_bundle.sources.length === 0) {
    return pretty({ valid: false, reason: "evidence_bundle.sources must be a non-empty array" });
  }

  if (typeof d.disclaimer !== "string" || d.disclaimer.length === 0) {
    return pretty({ valid: false, reason: "disclaimer must be a non-empty string" });
  }

  return pretty({
    valid: true,
    claims_card_id: d.claim?.claim_id,
    version: d.claims_card_version,
  });
}

// ---------------------------------------------------------------------------
// claims_card_inspect
// ---------------------------------------------------------------------------
export async function handleClaimsCardInspect(args: { document: AnyRecord }): Promise<string> {
  const d = args?.document ?? {};
  const prev = d.attestation?.prev_card_hash;
  return pretty({
    claims_card_version: d.claims_card_version,
    claim_id: d.claim?.claim_id,
    claim_type: d.claim?.claim_type,
    outcome: d.decision?.outcome,
    covered: d.decision?.coverage?.covered,
    coverage_amount: d.decision?.coverage?.amount,
    coverage_currency: d.decision?.coverage?.currency,
    evidence_count: d.evidence_bundle?.sources?.length ?? 0,
    model_id: d.evidence_bundle?.model?.model_id,
    jurisdiction: d.governance?.jurisdiction,
    human_in_loop: d.governance?.human_in_loop,
    chain_index: d.attestation?.chain_index,
    has_predecessor: prev !== null && prev !== undefined,
    attestation_signed_at: d.attestation?.signed_at,
    disclaimer_present: typeof d.disclaimer === "string" && d.disclaimer.length > 0,
  });
}

// ---------------------------------------------------------------------------
// claims_card_sign
// ---------------------------------------------------------------------------
export async function handleClaimsCardSign(args: { document: AnyRecord }): Promise<string> {
  const d = args?.document;
  if (d === null || typeof d !== "object" || Array.isArray(d)) {
    return pretty({ error: "`document` must be a JSON object" });
  }
  // Deep-clone, then strip the attestation fields that are downstream of the hash.
  const clone = JSON.parse(JSON.stringify(d)) as AnyRecord;
  if (clone.attestation && typeof clone.attestation === "object") {
    delete clone.attestation.card_hash;
    delete clone.attestation.signature;
  }
  const canonical = JSON.stringify(sortKeysDeep(clone));
  const card_hash = createHash("sha256").update(canonical, "utf8").digest("hex");
  return pretty({
    card_hash,
    algorithm: "SHA-256",
    canonical_length: canonical.length,
    note: "Sign card_hash offline with ed25519. Set attestation.card_hash and attestation.signature to the results.",
  });
}

// ---------------------------------------------------------------------------
// claims_card_chain
// ---------------------------------------------------------------------------
export async function handleClaimsCardChain(args: {
  card: AnyRecord;
  prev_card_hash: string;
  prev_chain_index: number;
}): Promise<string> {
  const { card, prev_card_hash, prev_chain_index } = args ?? {};

  if (typeof prev_card_hash !== "string" || !HEX64.test(prev_card_hash)) {
    return pretty({ error: "`prev_card_hash` must be a 64-char lowercase hex string" });
  }
  if (!Number.isInteger(prev_chain_index) || prev_chain_index < 0) {
    return pretty({ error: "`prev_chain_index` must be an integer >= 0" });
  }
  if (card === null || typeof card !== "object" || Array.isArray(card)) {
    return pretty({ error: "`card` must be a JSON object" });
  }

  card.attestation = card.attestation ?? {};
  card.attestation.chain_index = prev_chain_index + 1;
  card.attestation.prev_card_hash = prev_card_hash;

  return pretty({
    chain_index: card.attestation.chain_index,
    prev_card_hash: card.attestation.prev_card_hash,
    ready_for_signing: true,
    note: "Call claims_card_sign next to compute card_hash for this chained card.",
  });
}
