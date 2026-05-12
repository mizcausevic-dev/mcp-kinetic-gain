import { aiEvidenceSchema } from "../schemas.js";
import { canonicalSha256, errorJson, pretty } from "../common.js";

function parse(document_json: string): ReturnType<typeof aiEvidenceSchema.parse> {
  return aiEvidenceSchema.parse(JSON.parse(document_json));
}

export async function handleAiEvidenceValidate(args: {
  document_json: string;
}): Promise<string> {
  try {
    const ev = parse(args.document_json);
    return pretty({
      valid: true,
      evidence_id: ev.evidence_id,
      synthesis_role: ev.synthesis_role,
    });
  } catch (err) {
    return pretty({
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handleAiEvidenceInspect(args: {
  document_json: string;
}): Promise<string> {
  const ev = parse(args.document_json);
  return pretty({
    evidence_version: ev.evidence_version,
    evidence_id: ev.evidence_id,
    claim_text: ev.claim_text,
    source: {
      uri: ev.source.uri,
      type: ev.source.type,
      title: ev.source.title ?? null,
      publisher: ev.source.publisher ?? null,
    },
    span_selector_type: ev.span.selector_type,
    span_has_exact_text: typeof ev.span.exact_text === "string",
    retrieval_method: ev.retrieval.method,
    retrieval_confidence: ev.retrieval.confidence ?? null,
    synthesis_role: ev.synthesis_role,
    content_hash: ev.verification.content_hash,
    signed: typeof ev.verification.signature === "string",
  });
}

export async function handleAiEvidenceVerifyHash(args: {
  document_json: string;
  candidate_text: string;
}): Promise<string> {
  const ev = parse(args.document_json);
  const recomputed = canonicalSha256(args.candidate_text);
  const ok = recomputed === ev.verification.content_hash;
  if (!ok) {
    return errorJson("hash_mismatch", {
      expected: ev.verification.content_hash,
      recomputed,
      note: "Verify the candidate_text uses LF line endings and no trailing newline.",
    });
  }
  return pretty({
    ok: true,
    evidence_id: ev.evidence_id,
    content_hash: ev.verification.content_hash,
  });
}
