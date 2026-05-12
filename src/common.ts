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

export function errorJson(error: string, details: Record<string, unknown> = {}): string {
  return pretty({ error, ...details });
}
