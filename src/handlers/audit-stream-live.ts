/**
 * Live audit-stream-py tools — talk to a running audit-stream-py instance.
 *
 * Where the v0.6.0 audit-event tools (compose / inspect / verify) work
 * offline on locally-pasted event JSON, these v0.7.0 tools hit a real
 * audit-stream service over HTTP so Claude can:
 *
 *   - Emit a governance event from inside a chat
 *     (POST {AUDIT_STREAM_URL}/events)
 *   - Tail recent events with optional kind/source filters
 *     (GET {AUDIT_STREAM_URL}/events?kind=...&source=...&limit=...)
 *   - Ask audit-stream-py whether its chain is still intact
 *     (GET {AUDIT_STREAM_URL}/verify)
 *
 * The base URL comes from the `AUDIT_STREAM_URL` env var the rest of the
 * suite already uses. When unset, every tool returns a structured error
 * the agent can read and surface to the user.
 */
import { pretty } from "../common.js";

const DEFAULT_TIMEOUT_MS = 5_000;

function baseUrl(): string | null {
  const raw = (process.env.AUDIT_STREAM_URL ?? "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function notConfigured(): string {
  return pretty({
    error: "AUDIT_STREAM_URL is not set",
    detail:
      "Point this tool at your audit-stream-py instance by setting the AUDIT_STREAM_URL env var (e.g. http://audit-stream:8093) in the MCP server's environment, then restart the client.",
  });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * POST one event to audit-stream-py. The server assigns event_id +
 * timestamp + prev_hash + hash; callers only provide kind + source +
 * payload. Returns the persisted event as audit-stream-py wrote it.
 */
export async function handleAuditEventEmit(args: {
  kind: unknown;
  source: unknown;
  payload?: unknown;
}): Promise<string> {
  const url = baseUrl();
  if (!url) return notConfigured();
  if (typeof args.kind !== "string" || !args.kind) {
    return pretty({ error: "`kind` is required and must be a non-empty string" });
  }
  if (typeof args.source !== "string" || !args.source) {
    return pretty({ error: "`source` is required and must be a non-empty string" });
  }
  const payload =
    typeof args.payload === "object" && args.payload !== null && !Array.isArray(args.payload)
      ? (args.payload as Record<string, unknown>)
      : {};

  try {
    const resp = await fetchWithTimeout(`${url}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: args.kind, source: args.source, payload }),
    });
    const text = await resp.text();
    if (!resp.ok) {
      return pretty({
        error: `audit-stream returned HTTP ${resp.status}`,
        body: tryJson(text),
      });
    }
    return pretty({ ok: true, event: tryJson(text) });
  } catch (err) {
    return pretty({
      error: "failed to reach audit-stream",
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }
}

/**
 * GET events with optional kind / source / limit filters. The server
 * applies the filters server-side, so this stays cheap even on long
 * chains.
 */
export async function handleAuditEventsQuery(args: {
  kind?: unknown;
  source?: unknown;
  limit?: unknown;
  since_id?: unknown;
}): Promise<string> {
  const url = baseUrl();
  if (!url) return notConfigured();

  const params = new URLSearchParams();
  if (typeof args.kind === "string" && args.kind) params.set("kind", args.kind);
  if (typeof args.source === "string" && args.source) params.set("source", args.source);
  if (typeof args.limit === "number" && Number.isInteger(args.limit) && args.limit > 0) {
    params.set("limit", String(args.limit));
  }
  if (
    typeof args.since_id === "number" &&
    Number.isInteger(args.since_id) &&
    args.since_id >= 0
  ) {
    params.set("since_id", String(args.since_id));
  }

  const target = params.size > 0 ? `${url}/events?${params.toString()}` : `${url}/events`;
  try {
    const resp = await fetchWithTimeout(target, { method: "GET" });
    const text = await resp.text();
    if (!resp.ok) {
      return pretty({
        error: `audit-stream returned HTTP ${resp.status}`,
        body: tryJson(text),
      });
    }
    const events = tryJson(text);
    const count = Array.isArray(events) ? events.length : null;
    return pretty({ ok: true, count, events });
  } catch (err) {
    return pretty({
      error: "failed to reach audit-stream",
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }
}

/**
 * Ask audit-stream-py to walk its own chain end-to-end and report
 * whether it's still intact. This is the canonical compliance answer
 * — much stronger than the local audit_chain_verify because it covers
 * the full server-side history, not just the events the agent has
 * pasted into context.
 */
export async function handleAuditChainVerifyLive(_args: Record<string, never>): Promise<string> {
  const url = baseUrl();
  if (!url) return notConfigured();
  try {
    const resp = await fetchWithTimeout(`${url}/verify`, { method: "GET" });
    const text = await resp.text();
    if (!resp.ok) {
      return pretty({
        error: `audit-stream returned HTTP ${resp.status}`,
        body: tryJson(text),
      });
    }
    return pretty(tryJson(text));
  } catch (err) {
    return pretty({
      error: "failed to reach audit-stream",
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
