/** Optional, local-only aviation disclosure and sign-off tools. */
import { createHash } from "node:crypto";
import { verifyAsync } from "@noble/ed25519";
import { z } from "zod";

import { canonicalizeJcs, parseCardJson } from "../aviation-json.js";
import { aviationMlCardSchema, mroSignoffCardSchema, type AviationMlCard } from "../aviation-schemas.js";
import { pretty } from "../common.js";

type CardInput = { document_json: string };

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "invalid card";
  const path = issue.path.length > 0 ? issue.path.join(".") : "document_json";
  return `${path}: ${issue.message}`;
}

function parseAviationCard(args: CardInput): AviationMlCard {
  const result = aviationMlCardSchema.safeParse(parseCardJson(args?.document_json));
  if (!result.success) throw new Error(`invalid Aviation ML Assurance Card: ${firstIssue(result.error)}`);
  return result.data;
}

export async function handleAviationMlCardValidate(args: CardInput): Promise<string> {
  try {
    const card = parseAviationCard(args);
    return pretty({
      valid: true,
      system_id: card.system.id,
      version: card.aviation_ml_card_version,
      scope: "structure_and_suite_rules_only",
      airworthiness_approval: false,
      evidence_verified: false,
    });
  } catch (error) {
    return pretty({
      valid: false,
      reason: error instanceof Error ? error.message : "invalid Aviation ML Assurance Card",
      airworthiness_approval: false,
    });
  }
}

export async function handleAviationMlCardInspect(args: CardInput): Promise<string> {
  const card = parseAviationCard(args);
  return pretty({
    aviation_ml_card_version: card.aviation_ml_card_version,
    system: card.system,
    declared_easa_ai_level: card.assurance.easa_ai_level,
    proposed_target_dal: card.assurance.target_dal,
    target_dal_basis_ref: card.assurance.target_dal_basis_ref ?? null,
    standards_posture: card.assurance.standards_posture,
    odd: {
      summary: card.odd.summary,
      operating_conditions: card.odd.operating_conditions,
      excluded_conditions: card.odd.excluded_conditions,
      global_coverage_reference_count: card.odd.coverage_evidence_refs.length,
      condition_mapping_count: card.odd.condition_evidence.length,
    },
    learning_assurance_reference_count: card.learning_assurance.evidence_refs.length,
    dataset_manifest_reference_count: card.data_management.dataset_manifest_refs.length,
    leakage_check_referenced: !!card.data_management.leakage_check_ref,
    human_ai_teaming: card.human_ai_teaming,
    evidence_verified: false,
    airworthiness_approval: false,
  });
}

export async function handleAviationMlCardOddCheck(args: CardInput): Promise<string> {
  const card = parseAviationCard(args);
  const unreferenced = card.odd.condition_evidence
    .filter((entry) => entry.evidence_refs.length === 0)
    .map((entry) => entry.condition);
  return pretty({
    system_id: card.system.id,
    operating_conditions: card.odd.operating_conditions,
    condition_evidence: card.odd.condition_evidence.map((entry) => ({
      condition: entry.condition,
      reference_count: entry.evidence_refs.length,
    })),
    unreferenced_conditions: unreferenced,
    global_coverage_report_referenced: card.odd.coverage_evidence_refs.length > 0,
    references_present_for_each_condition: unreferenced.length === 0,
    independently_verified: false,
    coverage_adequacy: "not_assessed",
    note: "References are declarations only; inspect the separate dataset provenance report before judging ODD coverage.",
  });
}

export async function handleAviationMlCardDalCheck(args: CardInput): Promise<string> {
  const card = parseAviationCard(args);
  const documentationGaps: string[] = [];
  if (card.assurance.target_dal === "not_assigned") documentationGaps.push("target DAL not assigned");
  if (card.assurance.standards_posture.length === 0) documentationGaps.push("no standards posture entries");
  if (!card.assurance.standards_posture.some((entry) => entry.status === "internal_assessment")) {
    documentationGaps.push("no internal standards assessment evidence reference");
  }
  if (card.learning_assurance.evidence_refs.length === 0) documentationGaps.push("no learning-assurance evidence references");
  if (card.data_management.dataset_manifest_refs.length === 0) documentationGaps.push("no dataset-manifest references");
  return pretty({
    system_id: card.system.id,
    declared_easa_ai_level: card.assurance.easa_ai_level,
    proposed_target_dal: card.assurance.target_dal,
    target_dal_basis_ref: card.assurance.target_dal_basis_ref ?? null,
    standards_posture: card.assurance.standards_posture.map((entry) => ({
      identifier: entry.identifier,
      status: entry.status,
      evidence_referenced: !!entry.evidence_uri,
    })),
    documentation_gaps: documentationGaps,
    independently_verified: false,
    dal_certification_status: "not_assessed",
  });
}

function decodeCanonicalBase64url(value: unknown, expectedBytes: number, label: string): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${label} must be unpadded base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== expectedBytes || bytes.toString("base64url") !== value) {
    throw new Error(`${label} must encode exactly ${expectedBytes} bytes in canonical base64url`);
  }
  return bytes;
}

type SignoffInput = CardInput & {
  expected_key_id: string;
  public_key_b64url: string;
  independent_artifact_sha256?: string;
};

export async function handleMroSignoffVerify(args: SignoffInput): Promise<string> {
  const result = mroSignoffCardSchema.safeParse(parseCardJson(args?.document_json));
  if (!result.success) throw new Error(`invalid MRO AI Sign-off Card: ${firstIssue(result.error)}`);
  const card = result.data;
  if (typeof args.expected_key_id !== "string" || args.expected_key_id.length === 0) {
    throw new Error("expected_key_id is required from an external trusted roster");
  }
  const publicKey = decodeCanonicalBase64url(args.public_key_b64url, 32, "public_key_b64url");
  if (args.independent_artifact_sha256 !== undefined &&
      !/^[0-9a-f]{64}$/.test(args.independent_artifact_sha256)) {
    throw new Error("independent_artifact_sha256 must be lowercase SHA-256 hex");
  }
  const digestMatches = args.independent_artifact_sha256 === undefined
    ? null
    : args.independent_artifact_sha256 === card.artifact.sha256;
  const keyIdMatches = card.signature.key_id === args.expected_key_id;
  if (!keyIdMatches) {
    return pretty({
      card_id: card.finding.id,
      key_id_matches_expected: false,
      signature_valid_for_supplied_key: false,
      artifact_digest_matches_supplied: digestMatches,
      artifact_bytes_checked: false,
      identity_verified: false,
      certifying_authority_verified: false,
      return_to_service_authorized: false,
      reason: "key_id_mismatch",
    });
  }

  const signature = decodeCanonicalBase64url(card.signature.signature_b64url, 64, "signature.signature_b64url");
  // The signature covers key_id, profile, and signed_at. Only the signature
  // value is omitted from the JCS payload, as defined by the MRO v0.1 spec.
  const unsignedCard = {
    ...card,
    signature: {
      profile: card.signature.profile,
      key_id: card.signature.key_id,
      signed_at: card.signature.signed_at,
    },
  };
  const digest = createHash("sha256").update(canonicalizeJcs(unsignedCard), "utf8").digest();
  let signatureValid = false;
  try {
    signatureValid = await verifyAsync(signature, digest, publicKey);
  } catch {
    signatureValid = false;
  }
  return pretty({
    card_id: card.finding.id,
    signature_profile: card.signature.profile,
    key_id_matches_expected: true,
    signature_valid_for_supplied_key: signatureValid,
    artifact_digest_matches_supplied: digestMatches,
    artifact_bytes_checked: false,
    identity_verified: false,
    certifying_authority_verified: false,
    return_to_service_authorized: false,
    result: signatureValid && digestMatches !== false ? "cryptographic_integrity_for_supplied_key" : "invalid",
    note: "The card's authority_ref is not proof of staff privileges. A separate authorized maintenance process must decide return to service.",
  });
}

export const aviationHandlers: Record<string, (args: any) => Promise<string>> = {
  aviation_ml_card_validate: handleAviationMlCardValidate,
  aviation_ml_card_inspect: handleAviationMlCardInspect,
  aviation_ml_card_odd_check: handleAviationMlCardOddCheck,
  aviation_ml_card_dal_check: handleAviationMlCardDalCheck,
  mro_signoff_verify: handleMroSignoffVerify,
};
