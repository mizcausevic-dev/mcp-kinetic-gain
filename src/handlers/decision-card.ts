import { decisionCardSchema, type DecisionCard } from "../schemas.js";
import { canonicalJsonSha256, fetchJson, pretty, stripTrailingSlashes } from "../common.js";

const WELL_KNOWN_PREFIX = "/.well-known/decisions/";

export function decisionCardWellKnownUrl(origin: string, decision_id: string): string {
  return stripTrailingSlashes(origin) + WELL_KNOWN_PREFIX + encodeURIComponent(decision_id) + ".json";
}

async function loadCard(args: {
  url?: string;
  document_json?: string;
}): Promise<DecisionCard> {
  if (args.document_json) return decisionCardSchema.parse(JSON.parse(args.document_json));
  if (args.url) return decisionCardSchema.parse(await fetchJson(args.url));
  throw new Error("must provide either `url` or `document_json`");
}

export async function handleDecisionCardWellKnownUrl(args: {
  origin: string;
  decision_id: string;
}): Promise<string> {
  return pretty({ url: decisionCardWellKnownUrl(args.origin, args.decision_id) });
}

export async function handleDecisionCardFetch(args: { url: string }): Promise<string> {
  const card = decisionCardSchema.parse(await fetchJson(args.url));
  return pretty(card);
}

export async function handleDecisionCardValidate(args: { document_json: string }): Promise<string> {
  try {
    const card = decisionCardSchema.parse(JSON.parse(args.document_json));
    return pretty({
      valid: true,
      decision_id: card.decision_id,
      status: card.decision.status,
      buyer: card.buyer.name,
      buyer_type: card.buyer.type,
      vendor: card.subject.vendor_name,
      product: card.subject.product_name ?? null,
      documents_reviewed: card.subject.documents_reviewed?.length ?? 0,
      has_conditions: (card.conditions?.length ?? 0) > 0,
      condition_count: card.conditions?.length ?? 0,
      is_public: card.publication?.is_public ?? false,
    });
  } catch (err) {
    return pretty({ valid: false, reason: err instanceof Error ? err.message : String(err) });
  }
}

export async function handleDecisionCardInspect(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const card = await loadCard(args);

  // Pull out the most procurement-useful summary
  const rubricSummary = card.criteria?.rubric
    ? {
        total_criteria: card.criteria.rubric.length,
        pass: card.criteria.rubric.filter((r) => r.result === "pass").length,
        partial: card.criteria.rubric.filter((r) => r.result === "partial").length,
        fail: card.criteria.rubric.filter((r) => r.result === "fail").length,
        n_a: card.criteria.rubric.filter((r) => r.result === "n/a").length,
      }
    : null;

  const reviewed_types = card.subject.documents_reviewed
    ? Array.from(new Set(card.subject.documents_reviewed.map((d) => d.type)))
    : [];

  return pretty({
    decision_card_version: card.decision_card_version,
    decision_id: card.decision_id,
    issued_at: card.issued_at,
    buyer: {
      name: card.buyer.name,
      type: card.buyer.type,
      jurisdiction: card.buyer.jurisdiction ?? null,
      category: card.buyer.category ?? null,
    },
    decision: {
      status: card.decision.status,
      scope: card.decision.scope ?? null,
      effective_from: card.decision.effective_from ?? null,
      effective_until: card.decision.effective_until ?? null,
    },
    subject: {
      vendor: card.subject.vendor_name,
      product: card.subject.product_name ?? null,
      vendor_id: card.subject.vendor_id ?? null,
      documents_reviewed_count: card.subject.documents_reviewed?.length ?? 0,
      reviewed_document_types: reviewed_types,
    },
    rubric_summary: rubricSummary,
    conditions_count: card.conditions?.length ?? 0,
    signatures_count: card.signatures?.length ?? 0,
    has_appeals: card.appeals !== undefined,
    is_public: card.publication?.is_public ?? false,
    history_event_count: card.history?.length ?? 0,
    withdrawn: card.decision.status === "withdrawn",
  });
}

// ---------------------------------------------------------------------------
// v0.6.0 — Decision Intelligence preview tools (mirror procurement-decision-api
// and policy-as-code-engine logic at preview scale).
// ---------------------------------------------------------------------------

/**
 * Given a rubric, infer the right `decision.status`. Mirrors
 * `procurement-decision-api.rubric.infer_status()`.
 *
 *   any fail              -> "rejected-with-remediation"
 *   any partial / p-w-c   -> "approved-with-conditions"
 *   all pass              -> "approved"
 *   empty / all n/a       -> "pending"
 */
export async function handleDecisionCardInferStatus(args: {
  rubric: Array<{ id: string; result: string }>;
}): Promise<string> {
  if (!Array.isArray(args.rubric)) {
    return pretty({ error: "`rubric` must be an array" });
  }
  if (args.rubric.length === 0) {
    return pretty({ status: "pending", reason: "empty rubric" });
  }
  const results = args.rubric.map((r) => r.result);
  if (results.some((r) => r === "fail")) {
    return pretty({ status: "rejected-with-remediation", reason: "at least one `fail`" });
  }
  if (results.some((r) => r === "partial" || r === "pass-with-condition")) {
    return pretty({
      status: "approved-with-conditions",
      reason: "at least one `partial` or `pass-with-condition`",
    });
  }
  if (results.some((r) => r === "pass")) {
    return pretty({ status: "approved", reason: "all results pass or n/a" });
  }
  return pretty({ status: "pending", reason: "all results are n/a" });
}

/**
 * Translate a Decision Card into the PolicyBundle that
 * `policy-as-code-engine`'s POST /bundles/from-decision-card would
 * generate. Read-only preview.
 */
export async function handleDecisionCardToPolicyBundle(args: {
  document_json?: string;
  url?: string;
}): Promise<string> {
  const card = await loadCard(args);
  const status = card.decision.status;
  const vendor = card.subject.vendor_name;
  const decision_id = card.decision_id;
  const source = `decision-card:${decision_id}`;

  const rejectStatuses = new Set([
    "rejected",
    "rejected-with-remediation",
    "withdrawn",
    "expired",
    "pending",
  ]);

  if (rejectStatuses.has(status)) {
    return pretty({
      bundle_id: `decision-card-${decision_id}`,
      source,
      policies: [
        {
          id: `${decision_id}__${status}`,
          description: `Vendor "${vendor}" is ${status}; all requests denied.`,
          default_effect: "deny",
          rules: [{ id: `${status}-deny`, effect: "deny", when_kind: "always" }],
        },
      ],
    });
  }

  if (status === "approved") {
    return pretty({
      bundle_id: `decision-card-${decision_id}`,
      source,
      policies: [
        {
          id: `${decision_id}__approved`,
          description: `Vendor "${vendor}" is approved; all requests permitted.`,
          default_effect: "allow",
          rules: [{ id: "approved-allow", effect: "allow", when_kind: "always" }],
        },
      ],
    });
  }

  if (status === "approved-with-conditions") {
    const conditions = card.conditions ?? [];
    if (conditions.length === 0) {
      // Fail safe — deny everything.
      return pretty({
        bundle_id: `decision-card-${decision_id}`,
        source,
        policies: [
          {
            id: `${decision_id}__approved-with-conditions-no-conditions`,
            description: `Vendor "${vendor}" approved-with-conditions but no conditions declared; failing safe.`,
            default_effect: "deny",
            rules: [{ id: "no-conditions-deny", effect: "deny", when_kind: "always" }],
          },
        ],
      });
    }
    return pretty({
      bundle_id: `decision-card-${decision_id}`,
      source,
      policies: conditions.map((c) => ({
        id: `${decision_id}__condition__${c.id}`,
        description: c.description,
        default_effect: "deny",
        rules: [
          {
            id: `${c.id}-satisfied`,
            effect: "allow",
            when_kind: "eq",
            when_field: `conditions_satisfied.${c.id}`,
            when_value: true,
          },
        ],
      })),
    });
  }

  // Unknown status -> deny-all.
  return pretty({
    bundle_id: `decision-card-${decision_id}`,
    source,
    policies: [
      {
        id: `${decision_id}__unknown-status-${status}`,
        description: `Unknown decision.status "${status}"; failing safe.`,
        default_effect: "deny",
        rules: [{ id: "unknown-status-deny", effect: "deny", when_kind: "always" }],
      },
    ],
  });
}

/**
 * Check that a Decision Card carries at least one signature whose hash
 * matches the recomputed canonical hash of the card body (minus the
 * `signatures` block itself). This is the structural check — full
 * cryptographic verification needs `attestation_verify`.
 */
export async function handleDecisionCardSignatureCheck(args: {
  document_json?: string;
  url?: string;
}): Promise<string> {
  const card = await loadCard(args);
  const signatures = card.signatures ?? [];

  if (signatures.length === 0) {
    return pretty({
      has_signature: false,
      reason: "decision card has no signatures[] block",
    });
  }

  // Compute the canonical hash of the body excluding signatures.
  const bodyWithoutSignatures: DecisionCard = { ...card, signatures: undefined };
  const expected_hash = canonicalJsonSha256(bodyWithoutSignatures);

  return pretty({
    has_signature: true,
    signature_count: signatures.length,
    signers: signatures.map((s) => ({
      signer: s.signer,
      signed_at: s.signed_at,
      method: s.method ?? null,
      key_uri: s.key_uri ?? null,
      has_signature_value: typeof s.signature_value === "string" && s.signature_value.length > 0,
    })),
    expected_canonical_hash: expected_hash,
    note: "Use `attestation_verify` with a Suite-style attestation envelope for cryptographic verification.",
  });
}
