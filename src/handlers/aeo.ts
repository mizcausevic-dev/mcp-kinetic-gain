import { aeoDocumentSchema } from "../schemas.js";
import { errorJson, fetchJson, pretty, stripTrailingSlashes } from "../common.js";
import { isIP } from "node:net";

export const AEO_WELL_KNOWN_PATH = "/.well-known/aeo.json";

export function aeoWellKnownUrl(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new TypeError("AEO origin must be an absolute HTTPS origin URL");
  }
  if (
    parsed.protocol !== "https:" || parsed.username || parsed.password ||
    parsed.pathname !== "/" || parsed.search || parsed.hash ||
    isIP(parsed.hostname.replace(/^\[|\]$/g, "")) !== 0
  ) {
    throw new TypeError("AEO origin must be an HTTPS hostname without credentials, path, query, or fragment");
  }
  return parsed.origin + AEO_WELL_KNOWN_PATH;
}

const AEO_FETCH_MAX_BYTES = 1_000_000; // generous for a JSON declaration doc, far beyond any legitimate size

// Fetch dispatch retains the existing URL shape for the loopback fixture and
// callers. fetchJson independently enforces the network destination boundary.
// Tightening fetch-origin semantics needs a separate compatibility review.
function aeoFetchUrl(origin: string): string {
  return stripTrailingSlashes(origin) + AEO_WELL_KNOWN_PATH;
}

export async function handleAeoFetch(args: { origin: string }): Promise<string> {
  const raw = await fetchJson(aeoFetchUrl(args.origin), 10_000, AEO_FETCH_MAX_BYTES);
  const doc = aeoDocumentSchema.parse(raw);
  return pretty(doc);
}

export async function handleAeoInspect(args: { origin: string }): Promise<string> {
  const raw = await fetchJson(aeoFetchUrl(args.origin));
  const doc = aeoDocumentSchema.parse(raw);
  return pretty({
    protocol: doc.aeo_version,
    entity: {
      id: doc.entity.id,
      type: doc.entity.type,
      name: doc.entity.name,
      canonical_url: doc.entity.canonical_url,
    },
    primary_source_count: doc.authority.primary_sources.length,
    verification_count: doc.authority.verifications?.length ?? 0,
    claim_count: doc.claims.length,
    claim_ids: doc.claims.map((c) => c.id),
    audit_mode: doc.audit?.mode ?? null,
  });
}

export async function handleAeoGetClaim(args: {
  origin: string;
  claim_id: string;
}): Promise<string> {
  const raw = await fetchJson(aeoFetchUrl(args.origin));
  const doc = aeoDocumentSchema.parse(raw);
  const claim = doc.claims.find((c) => c.id === args.claim_id);
  if (!claim) {
    return errorJson("claim_not_found", {
      claim_id: args.claim_id,
      available_claim_ids: doc.claims.map((c) => c.id),
    });
  }
  return pretty(claim);
}

export async function handleAeoWellKnownUrl(args: { origin: string }): Promise<string> {
  return pretty({ url: aeoWellKnownUrl(args.origin) });
}
