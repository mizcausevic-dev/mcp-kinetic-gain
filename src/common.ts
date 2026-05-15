/**
 * Shared utilities used by every spec handler.
 */
import { createHash } from "node:crypto";

const ACCEPT_HEADER = "application/aeo+json, application/json";

export function stripTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, "");
}

export async function fetchJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: ACCEPT_HEADER },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} (${url})`);
    }
    const text = await response.text();
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * SHA-256 over canonicalized UTF-8 bytes:
 *   - normalize line endings to LF
 *   - strip a single trailing newline
 * Matches the rule defined in the AI Evidence Format and Prompt
 * Provenance specifications.
 */
export function canonicalSha256(content: string): string {
  let normalized = content.replace(/\r\n/g, "\n");
  if (normalized.endsWith("\n")) {
    normalized = normalized.slice(0, -1);
  }
  const hex = createHash("sha256").update(normalized, "utf8").digest("hex");
  return `sha256:${hex}`;
}

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * SHA-256 over canonical JSON of a parsed value: sorted object keys,
 * no whitespace, UTF-8. This is the **structural** hash convention used
 * across the Kinetic Gain implementation stack (procurement-decision-api,
 * aeo-validator-service, aeo-graph-explorer-rs, hash-attestation-rs).
 *
 * Distinct from `canonicalSha256()` above, which hashes a *text content*
 * string after line-ending normalization (the AI Evidence / Prompt
 * Provenance convention).
 *
 * Identical JSON values produce identical hashes regardless of how the
 * input was originally serialised:
 *   { "foo": 1, "bar": 2 }  and  { "bar": 2, "foo": 1 }  -> same hash.
 */
export function canonicalJsonSha256(value: unknown): string {
  const canonical = canonicalJson(value);
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${hex}`;
}

/** Internal — canonical JSON: sorted keys, no whitespace. */
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    // JSON.stringify of a non-finite number is "null" — preserve that.
    if (!Number.isFinite(value)) return "null";
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]));
    return "{" + parts.join(",") + "}";
  }
  // undefined / symbol / function — JSON doesn't carry them; treat as null.
  return "null";
}

export function errorJson(error: string, details: Record<string, unknown> = {}): string {
  return pretty({ error, ...details });
}
