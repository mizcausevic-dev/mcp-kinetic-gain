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
