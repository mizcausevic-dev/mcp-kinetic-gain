import { createHash } from "node:crypto";

import {
  studentDisclosureSchema,
  type StudentDisclosure,
} from "../schemas.js";
import { canonicalSha256, errorJson, pretty } from "../common.js";

function loadDisclosure(document_json: string): StudentDisclosure {
  return studentDisclosureSchema.parse(JSON.parse(document_json));
}

/** Canonical SHA-256 over the raw bytes of an artifact, as a base64-decoded payload. */
function sha256OverBytes(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  return "sha256:" + createHash("sha256").update(buf).digest("hex");
}

export async function handleDisclosureValidate(args: {
  document_json: string;
}): Promise<string> {
  try {
    const doc = loadDisclosure(args.document_json);
    return pretty({
      valid: true,
      disclosure_id: doc.disclosure_id,
      ai_used: doc.ai_used,
      assistance_extent: doc.assistance_extent ?? null,
      prompt_evidence_mode: doc.prompt_evidence_mode ?? null,
    });
  } catch (err) {
    return pretty({
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handleDisclosureInspect(args: {
  document_json: string;
}): Promise<string> {
  const doc = loadDisclosure(args.document_json);
  return pretty({
    disclosure_version: doc.disclosure_version,
    disclosure_id: doc.disclosure_id,
    created_at: doc.created_at,
    student_id: doc.student.id,
    grade_or_year: doc.student.grade_or_year ?? null,
    assignment: {
      id: doc.assignment.id,
      title: doc.assignment.title,
      course_id: doc.assignment.course_id,
      lms: doc.assignment.lms ?? null,
    },
    ai_used: doc.ai_used,
    tools_used:
      doc.tools_used?.map((t) => ({
        name: t.name,
        provider: t.provider ?? null,
        version: t.version ?? null,
        has_agent_card: t.agent_card_uri !== undefined,
        has_tutor_card: t.tutor_card_uri !== undefined,
      })) ?? [],
    roles: doc.roles ?? [],
    assistance_extent: doc.assistance_extent ?? null,
    assistance_pct: doc.assistance_pct ?? null,
    prompt_evidence_mode: doc.prompt_evidence_mode ?? null,
    prompt_count: doc.prompts?.length ?? 0,
    artifact_hash: doc.artifact_hash,
    has_artifact_uri: doc.artifact_uri !== undefined,
    has_aup_uri: doc.aup_uri !== undefined,
    policy_compliant: doc.policy_compliant ?? null,
    signed_by_student: doc.signed_by_student,
    teacher_acknowledged: doc.teacher_acknowledged
      ? {
          acknowledged: doc.teacher_acknowledged.acknowledged,
          by: doc.teacher_acknowledged.by,
          at: doc.teacher_acknowledged.at,
        }
      : null,
  });
}

/**
 * Verify the disclosure's artifact_hash binds to a candidate artifact. The
 * caller passes one of:
 *   - `candidate_text`  → canonical SHA-256 (LF, no trailing newline)
 *   - `candidate_bytes_base64` → raw-bytes SHA-256 (base64-encoded file)
 */
export async function handleDisclosureVerifyArtifactHash(args: {
  document_json: string;
  candidate_text?: string;
  candidate_bytes_base64?: string;
}): Promise<string> {
  const doc = loadDisclosure(args.document_json);
  if (args.candidate_text === undefined && args.candidate_bytes_base64 === undefined) {
    return errorJson("missing_input", {
      reason: "must provide either candidate_text or candidate_bytes_base64",
    });
  }
  const recomputed =
    args.candidate_bytes_base64 !== undefined
      ? sha256OverBytes(args.candidate_bytes_base64)
      : canonicalSha256(args.candidate_text ?? "");
  if (recomputed === doc.artifact_hash) {
    return pretty({
      ok: true,
      disclosure_id: doc.disclosure_id,
      artifact_hash: doc.artifact_hash,
      mode: args.candidate_bytes_base64 ? "raw_bytes" : "canonical_text",
    });
  }
  return errorJson("artifact_hash_mismatch", {
    disclosure_id: doc.disclosure_id,
    expected: doc.artifact_hash,
    recomputed,
    mode: args.candidate_bytes_base64 ? "raw_bytes" : "canonical_text",
  });
}

/**
 * Verify a single prompt hash. Looks up the prompt by `prompt_id` and
 * compares the canonical SHA-256 of `candidate_text` against the stored
 * hash. Only meaningful when `prompt_evidence_mode == "hashed"`.
 */
export async function handleDisclosureVerifyPromptHash(args: {
  document_json: string;
  prompt_id: string;
  candidate_text: string;
}): Promise<string> {
  const doc = loadDisclosure(args.document_json);
  if (doc.prompt_evidence_mode !== "hashed") {
    return errorJson("wrong_prompt_mode", {
      reason: `Disclosure prompt_evidence_mode is '${doc.prompt_evidence_mode ?? "absent"}'; this tool only applies when mode is 'hashed'.`,
    });
  }
  const prompt = doc.prompts?.find((p) => p.id === args.prompt_id);
  if (!prompt) {
    return errorJson("prompt_not_found", {
      prompt_id: args.prompt_id,
      available_ids: doc.prompts?.map((p) => p.id) ?? [],
    });
  }
  if (!prompt.hash) {
    return errorJson("prompt_has_no_hash", {
      prompt_id: args.prompt_id,
      reason: "Prompt entry is missing a hash field despite hashed mode.",
    });
  }
  const recomputed = canonicalSha256(args.candidate_text);
  if (recomputed === prompt.hash) {
    return pretty({
      ok: true,
      disclosure_id: doc.disclosure_id,
      prompt_id: args.prompt_id,
      hash: prompt.hash,
    });
  }
  return errorJson("prompt_hash_mismatch", {
    disclosure_id: doc.disclosure_id,
    prompt_id: args.prompt_id,
    expected: prompt.hash,
    recomputed,
  });
}

/**
 * Best-effort policy posture summary. Until the Classroom AI AUP spec lands,
 * this surfaces whether the disclosure declares compliance and where the AUP
 * lives. Future versions will fetch and cross-check against the AUP itself.
 */
export async function handleDisclosureAupCheck(args: {
  document_json: string;
}): Promise<string> {
  const doc = loadDisclosure(args.document_json);
  const status = doc.aup_uri
    ? doc.policy_compliant
      ? doc.policy_compliant.declared
        ? "declared_compliant"
        : "declared_non_compliant"
      : "aup_referenced_but_unclaimed"
    : "no_aup_reference";
  return pretty({
    disclosure_id: doc.disclosure_id,
    aup_uri: doc.aup_uri ?? null,
    declared: doc.policy_compliant?.declared ?? null,
    reason: doc.policy_compliant?.reason ?? null,
    status,
    note:
      "Pairs with the forthcoming Classroom AI AUP spec; v0.3 of this tool reports declared posture only and does not fetch the AUP.",
  });
}
