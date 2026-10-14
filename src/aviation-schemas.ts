/**
 * Aviation v0.1 card schemas. Keep these aligned with the two source specs:
 * aviation-ml-assurance-card-spec and mro-ai-signoff-card-spec.
 * Structural validation is not an aviation approval or maintenance release.
 */
import { z } from "zod";

const nonempty = z.string().min(1).max(500).regex(/\S/);
const httpsUri = z.string().url().refine((value) => value.startsWith("https://"), {
  message: "expected an HTTPS URI",
});
const systemId = z.string().max(80).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
const stableId = z.string().max(80).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);

function uniqueStrings<T extends z.ZodTypeAny>(item: T) {
  return z.array(item).superRefine((values, ctx) => {
    if (new Set(values).size !== values.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate array value" });
    }
  });
}

const standardPosture = z.object({
  identifier: nonempty,
  status: z.enum(["referenced", "mapping_in_progress", "internal_assessment"]),
  evidence_uri: httpsUri.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status === "internal_assessment" && !value.evidence_uri) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence_uri"], message: "required for internal_assessment" });
  }
});

const binRef = z.object({
  dimension: stableId,
  bin: stableId,
}).strict();

const conditionEvidence = z.object({
  condition: nonempty,
  condition_id: stableId.optional(),
  bin_refs: z.array(binRef).optional(),
  evidence_refs: uniqueStrings(httpsUri),
}).strict().superRefine((value, ctx) => {
  if ((value.condition_id === undefined) !== (value.bin_refs === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "condition_id and bin_refs must appear together" });
  }
  const pairs = (value.bin_refs ?? []).map(({ dimension, bin }) => `${dimension}:${bin}`);
  if (new Set(pairs).size !== pairs.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bin_refs"], message: "duplicate ODD bin reference" });
  }
});

export const aviationMlCardSchema = z.object({
  aviation_ml_card_version: z.literal("0.1"),
  system: z.object({
    id: systemId,
    name: nonempty,
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/),
    provider: nonempty,
    intended_use: z.string().min(10).max(2000),
  }).strict(),
  assurance: z.object({
    easa_ai_level: z.enum(["1A", "1B", "2A", "2B", "3A"]),
    target_dal: z.enum(["A", "B", "C", "D", "E", "not_assigned"]),
    target_dal_basis_ref: httpsUri.optional(),
    standards_posture: z.array(standardPosture).superRefine((values, ctx) => {
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        const key = value.identifier;
        if (seen.has(key)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "duplicate standards identifier" });
        }
        seen.add(key);
      }
    }),
  }).strict(),
  odd: z.object({
    summary: z.string().min(10).max(2000),
    operating_conditions: uniqueStrings(nonempty).refine((values) => values.length > 0, { message: "at least one operating condition is required" }),
    excluded_conditions: uniqueStrings(nonempty),
    coverage_evidence_refs: uniqueStrings(httpsUri),
    condition_evidence: z.array(conditionEvidence),
  }).strict(),
  learning_assurance: z.object({
    process_summary: z.string().min(10).max(2000),
    evidence_refs: uniqueStrings(httpsUri),
  }).strict(),
  data_management: z.object({
    dataset_manifest_refs: uniqueStrings(httpsUri),
    split_policy: z.enum(["group_disjoint", "time_disjoint", "stratified", "other"]),
    split_policy_detail: nonempty.optional(),
    leakage_check_ref: httpsUri.optional(),
  }).strict(),
  human_ai_teaming: z.object({
    role: z.enum(["advisory", "decision_support", "autonomous"]),
    human_override_available: z.boolean(),
    override_procedure_ref: httpsUri.optional(),
    human_responsibility_summary: z.string().min(10).max(2000),
  }).strict(),
  links: z.object({
    agent_card_uri: httpsUri.optional(),
    incident_card_index_uri: httpsUri.optional(),
    ai_evidence_uris: uniqueStrings(httpsUri).optional(),
  }).strict().optional(),
}).strict().superRefine((card, ctx) => {
  if (card.assurance.target_dal !== "not_assigned" && !card.assurance.target_dal_basis_ref) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assurance", "target_dal_basis_ref"], message: "required for an assigned target DAL" });
  }
  if (card.data_management.split_policy === "other" && !card.data_management.split_policy_detail) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data_management", "split_policy_detail"], message: "required for split_policy=other" });
  }
  if (["2B", "3A"].includes(card.assurance.easa_ai_level)) {
    if (!card.human_ai_teaming.human_override_available) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["human_ai_teaming", "human_override_available"], message: "this Suite profile requires a human override path for Level 2B or 3A" });
    }
    if (!card.human_ai_teaming.override_procedure_ref) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["human_ai_teaming", "override_procedure_ref"], message: "required for Level 2B or 3A" });
    }
  }

  // JSON Schema cannot express equality between these two arrays. The source
  // spec's semantic validator enforces exactly one mapping for each condition.
  const declared = new Set(card.odd.operating_conditions);
  const mapped = new Set<string>();
  for (const [index, entry] of card.odd.condition_evidence.entries()) {
    if (!declared.has(entry.condition)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["odd", "condition_evidence", index, "condition"], message: "condition is not declared in operating_conditions" });
    }
    if (mapped.has(entry.condition)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["odd", "condition_evidence", index, "condition"], message: "duplicate condition mapping" });
    }
    mapped.add(entry.condition);
  }
  for (const condition of declared) {
    if (!mapped.has(condition)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["odd", "condition_evidence"], message: `missing evidence mapping for ${condition}` });
    }
  }
  for (const condition of card.odd.excluded_conditions) {
    if (declared.has(condition)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["odd", "excluded_conditions"], message: `excluded condition is also operating: ${condition}` });
    }
  }
  const ids = card.odd.condition_evidence.map((entry) => entry.condition_id).filter((id) => id !== undefined);
  if (ids.length > 0 && ids.length !== card.odd.condition_evidence.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["odd", "condition_evidence"], message: "every ODD condition needs an ID when bin mapping is used" });
  }
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["odd", "condition_evidence"], message: "duplicate ODD condition ID" });
  }
});

export type AviationMlCard = z.infer<typeof aviationMlCardSchema>;

export const mroSignoffCardSchema = z.object({
  mro_signoff_card_version: z.literal("0.1"),
  finding: z.object({
    id: systemId,
    kind: z.enum(["borescope", "ndt", "predictive_maintenance", "other"]),
    kind_other_text: nonempty.optional(),
    summary: z.string().min(10).max(2000),
    model_id: nonempty,
    model_version: nonempty,
    confidence: z.number().min(0).max(1),
  }).strict(),
  artifact: z.object({
    id: nonempty,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    media_type: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/).optional(),
    byte_length: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  }).strict(),
  evidence_refs: uniqueStrings(httpsUri).refine((values) => values.length > 0, { message: "at least one evidence reference is required" }),
  human_review: z.object({
    staff_id: z.string().min(1).max(128),
    decision: z.enum(["accept", "override", "reject"]),
    reviewed_at: z.string().datetime().regex(/Z$/),
    authority_ref: httpsUri,
    override_reason: nonempty.optional(),
    comment: z.string().max(2000).optional(),
  }).strict(),
  signature: z.object({
    profile: z.literal("JCS-SHA256-Ed25519-v1"),
    key_id: nonempty,
    signed_at: z.string().datetime().regex(/Z$/),
    signature_b64url: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
  }).strict(),
}).strict().superRefine((card, ctx) => {
  if (card.finding.kind === "other" && !card.finding.kind_other_text) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["finding", "kind_other_text"], message: "required for kind=other" });
  }
  if (card.human_review.decision === "override" && !card.human_review.override_reason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["human_review", "override_reason"], message: "required for decision=override" });
  }
  if (card.human_review.decision !== "override" && card.human_review.override_reason !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["human_review", "override_reason"], message: "only permitted for decision=override" });
  }
  if (Date.parse(card.signature.signed_at) < Date.parse(card.human_review.reviewed_at)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["signature", "signed_at"], message: "signature predates human review" });
  }
});

export type MroSignoffCard = z.infer<typeof mroSignoffCardSchema>;
