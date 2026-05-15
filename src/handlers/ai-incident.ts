import {
  aiIncidentCardSchema,
  aiIncidentIndexSchema,
  type AiIncidentCard,
  type AiIncidentIndex,
} from "../schemas.js";
import { errorJson, fetchJson, pretty, stripTrailingSlashes } from "../common.js";

const WELL_KNOWN_PREFIX = "/.well-known/ai-incidents/";
const INDEX_PATH = "/.well-known/ai-incidents.json";

export function incidentWellKnownUrl(origin: string, incident_id: string): string {
  return stripTrailingSlashes(origin) + WELL_KNOWN_PREFIX + encodeURIComponent(incident_id) + ".json";
}

export function incidentIndexUrl(origin: string): string {
  return stripTrailingSlashes(origin) + INDEX_PATH;
}

async function loadCard(args: {
  url?: string;
  document_json?: string;
}): Promise<AiIncidentCard> {
  if (args.document_json) return aiIncidentCardSchema.parse(JSON.parse(args.document_json));
  if (args.url) return aiIncidentCardSchema.parse(await fetchJson(args.url));
  throw new Error("must provide either `url` or `document_json`");
}

export async function handleIncidentWellKnownUrl(args: {
  origin: string;
  incident_id: string;
}): Promise<string> {
  return pretty({ url: incidentWellKnownUrl(args.origin, args.incident_id) });
}

export async function handleIncidentFetch(args: { url: string }): Promise<string> {
  const card = aiIncidentCardSchema.parse(await fetchJson(args.url));
  return pretty(card);
}

export async function handleIncidentValidate(args: { document_json: string }): Promise<string> {
  try {
    const card = aiIncidentCardSchema.parse(JSON.parse(args.document_json));
    return pretty({
      valid: true,
      incident_id: card.incident.id,
      severity: card.incident.severity,
      status: card.incident.status,
      categories: card.incident.categories,
      affected_vendor: card.affected.vendor,
      root_cause_category: card.root_cause.category,
      permanent_fix: card.mitigation.permanent_fix,
    });
  } catch (err) {
    return pretty({ valid: false, reason: err instanceof Error ? err.message : String(err) });
  }
}

export async function handleIncidentInspect(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const card = await loadCard(args);
  return pretty({
    incident_card_version: card.incident_card_version,
    incident: card.incident,
    affected: {
      vendor: card.affected.vendor,
      products: card.affected.products,
      versions: card.affected.versions ?? [],
      agent_card_count: card.affected.agent_card_uris?.length ?? 0,
      tutor_card_count: card.affected.tutor_card_uris?.length ?? 0,
      tool_card_count: card.affected.tool_card_uris?.length ?? 0,
      affected_user_count: card.affected.affected_user_count ?? null,
      affected_populations: card.affected.affected_populations ?? [],
    },
    summary_excerpt: card.summary.slice(0, 400),
    root_cause: card.root_cause,
    harm: card.harm,
    mitigation: card.mitigation,
    evidence_present: card.evidence !== undefined,
    references_count: card.references?.length ?? 0,
    regulatory: card.regulatory ?? null,
    withdrawn: card.incident.status === "withdrawn",
    withdrawal_reason: card.withdrawal?.reason ?? null,
    published_by: card.published_by,
    last_updated_at: card.last_updated_at,
    revision: card.revision ?? null,
  });
}

/**
 * Fetch the well-known incident-card index and return a procurement-friendly
 * summary: total count, breakdown by severity, by status, IDs sorted by
 * disclosed_at descending.
 */
export async function handleIncidentIndexFetch(args: { origin: string }): Promise<string> {
  const url = incidentIndexUrl(args.origin);
  let parsed: unknown;
  try {
    parsed = await fetchJson(url);
  } catch (err) {
    return errorJson("fetch_failed", {
      url,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  let entries: AiIncidentIndex;
  try {
    // Some vendors serve { "incidents": [...] }; tolerate both.
    const candidate = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === "object" && Array.isArray((parsed as { incidents?: unknown }).incidents)
          ? (parsed as { incidents: unknown[] }).incidents
          : null);
    if (candidate === null) {
      return errorJson("index_malformed", {
        url,
        reason: "expected array or { incidents: [...] }",
      });
    }
    entries = aiIncidentIndexSchema.parse(candidate);
  } catch (err) {
    return errorJson("index_validation_failed", {
      url,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const e of entries) {
    if (e.severity) bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    if (e.status) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
  }

  const sortedIds = [...entries]
    .sort((a, b) => (b.disclosed_at ?? "").localeCompare(a.disclosed_at ?? ""))
    .map((e) => ({ id: e.id, severity: e.severity ?? null, status: e.status ?? null, disclosed_at: e.disclosed_at ?? null }));

  return pretty({
    url,
    total: entries.length,
    by_severity: bySeverity,
    by_status: byStatus,
    incidents_sorted_by_disclosed_at_desc: sortedIds,
  });
}

// ---------------------------------------------------------------------------
// v0.6.0 — incident remediation tools (mirror incident-correlation-rs at
// single-hop preview scale; for full Suite-graph BFS use the Rust crate).
// ---------------------------------------------------------------------------

interface AffectedRef {
  uri: string;
  kind: "agent-card" | "tutor-card" | "tool-card" | "vendor" | "product";
}

function collectAffected(card: AiIncidentCard): AffectedRef[] {
  const out: AffectedRef[] = [];
  out.push({ uri: `vendor:${card.affected.vendor}`, kind: "vendor" });
  for (const product of card.affected.products ?? []) {
    out.push({ uri: `product:${card.affected.vendor}/${product}`, kind: "product" });
  }
  for (const u of card.affected.agent_card_uris ?? []) out.push({ uri: u, kind: "agent-card" });
  for (const u of card.affected.tutor_card_uris ?? []) out.push({ uri: u, kind: "tutor-card" });
  for (const u of card.affected.tool_card_uris ?? []) out.push({ uri: u, kind: "tool-card" });
  return out;
}

/**
 * Walk an Incident Card's `affected` block and return every referenced
 * Suite document by URI + kind. Useful as the seed list for
 * `incident-correlation-rs` or for fan-out validation via
 * `aeo-validator-service`.
 */
export async function handleIncidentAffectedWalk(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const card = await loadIncident(args);
  if ("error" in card) return pretty(card);
  const affected = collectAffected(card);
  return pretty({
    incident_id: card.incident.id,
    severity: card.incident.severity,
    vendor: card.affected.vendor,
    affected_count: affected.length,
    affected,
    counts_by_kind: countBy(affected.map((a) => a.kind)),
  });
}

/**
 * Map each affected URI to a recommended Action + Urgency. Mirrors the
 * `incident-correlation-rs.correlate()` single-hop logic:
 *
 *   tool-card  -> revalidate (rerun aeo-validator-service watches + audit tool calls)
 *   agent-card -> revalidate
 *   tutor-card -> revalidate
 *   product    -> request_review (procurement reopens the Decision Card)
 *   vendor     -> request_review
 *
 * Urgency table: critical -> critical, high -> high, medium -> normal, low -> low.
 */
export async function handleIncidentRemediationPlan(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const card = await loadIncident(args);
  if ("error" in card) return pretty(card);

  const baseUrgency = severityToUrgency(card.incident.severity);
  const affected = collectAffected(card);
  if (affected.length === 0) {
    return pretty({
      incident_id: card.incident.id,
      severity: card.incident.severity,
      steps: [],
      summary: "no affected documents declared",
    });
  }

  const steps = affected.map((a) => {
    const action =
      a.kind === "vendor" || a.kind === "product" ? "request_review" : "revalidate";
    return {
      document_uri: a.uri,
      kind: a.kind,
      action,
      urgency: baseUrgency,
      rationale: rationaleFor(action, a.kind, card.incident.title),
    };
  });

  return pretty({
    incident_id: card.incident.id,
    title: card.incident.title,
    severity: card.incident.severity,
    steps,
    summary: `${steps.length} step(s) recommended; severity=${card.incident.severity}`,
  });
}

async function loadIncident(args: {
  url?: string;
  document_json?: string;
}): Promise<AiIncidentCard | { error: string }> {
  try {
    if (args.document_json) {
      return aiIncidentCardSchema.parse(JSON.parse(args.document_json));
    }
    if (args.url) {
      return aiIncidentCardSchema.parse(await fetchJson(args.url));
    }
    return { error: "must provide either `url` or `document_json`" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function severityToUrgency(sev: AiIncidentCard["incident"]["severity"]): string {
  switch (sev) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "normal";
    case "low":
    default:
      return "low";
  }
}

function rationaleFor(action: string, kind: AffectedRef["kind"], title: string): string {
  if (action === "request_review") {
    return `Bring forward a fresh procurement review for ${kind}. Incident: ${title}`;
  }
  return `Re-fetch + re-validate ${kind} via aeo-validator-service. Incident: ${title}`;
}

function countBy<T extends string>(items: T[]): Record<T, number> {
  const out: Partial<Record<T, number>> = {};
  for (const x of items) {
    out[x] = (out[x] ?? 0) + 1;
  }
  return out as Record<T, number>;
}
