import { aeoDocumentSchema } from "../schemas.js";
import { errorJson, fetchJson, pretty, stripTrailingSlashes } from "../common.js";

export const AEO_WELL_KNOWN_PATH = "/.well-known/aeo.json";

export function aeoWellKnownUrl(origin: string): string {
  return stripTrailingSlashes(origin) + AEO_WELL_KNOWN_PATH;
}

export async function handleAeoFetch(args: { origin: string }): Promise<string> {
  const raw = await fetchJson(aeoWellKnownUrl(args.origin));
  return pretty(raw);
}

export async function handleAeoInspect(args: { origin: string }): Promise<string> {
  const raw = await fetchJson(aeoWellKnownUrl(args.origin));
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
  const raw = await fetchJson(aeoWellKnownUrl(args.origin));
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
