import { decisionCardSchema, type DecisionCard } from "../schemas.js";
import { fetchJson, pretty, stripTrailingSlashes } from "../common.js";

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
