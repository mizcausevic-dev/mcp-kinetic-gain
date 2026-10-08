/**
 * Live audit-stream-py tools — talk to a running audit-stream-py instance.
 *
 * Where the v0.6.0 audit-event tools (compose / inspect / verify) work
 * offline on locally-pasted event JSON, these v0.7.0 tools hit a real
 * audit-stream service over HTTP so Claude can:
 *
 *   - Emit a governance event from inside a chat
 *     (POST {AUDIT_STREAM_URL}/events)
 *   - Read recent events with one optional kind/source filter
 *     (GET {AUDIT_STREAM_URL}/events?kind=...&limit=...)
 *   - Ask audit-stream-py whether its chain is still intact
 *     (GET {AUDIT_STREAM_URL}/verify)
 *
 * The base URL and bearer token come from AUDIT_STREAM_URL and
 * AUDIT_STREAM_TOKEN. Both are required for live calls; offline tools do not
 * need either setting.
 */
import { pretty } from "../common.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EVENT_BYTES = 64_000;

function connection(): { url: string; token: string } | { error: string } {
  const raw = (process.env.AUDIT_STREAM_URL ?? "").trim();
  if (!raw) return { error: "AUDIT_STREAM_URL is not set" };
  const token = process.env.AUDIT_STREAM_TOKEN ?? "";
  // Match the audit-stream-py bearer-token contract. Never echo this value.
  if (!/^[!-~]{32,}$/.test(token)) {
    return { error: "AUDIT_STREAM_TOKEN must be set to at least 32 visible ASCII characters" };
  }
  try {
    const target = new URL(raw);
    if (target.username || target.password || target.search || target.hash) {
      return { error: "AUDIT_STREAM_URL must not contain credentials, a query, or a fragment" };
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
    if (target.protocol !== "https:" && !(target.protocol === "http:" && loopback)) {
      return { error: "AUDIT_STREAM_URL must use HTTPS, or HTTP on loopback" };
    }
    return { url: target.href.replace(/\/+$/, ""), token };
  } catch {
    return { error: "AUDIT_STREAM_URL is invalid" };
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    // A configured audit-stream origin must never forward event payloads or
    // returned event data to a different origin through a redirect.
    const resp = await fetch(url, { ...init, signal: ctrl.signal, redirect: "error" });
    const contentLength = resp.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      ctrl.abort();
      throw new Error(`audit-stream response exceeds ${MAX_RESPONSE_BYTES} byte limit`);
    }
    const reader = resp.body?.getReader();
    if (!reader) return { ok: resp.ok, status: resp.status, text: "" };
    const decoder = new TextDecoder();
    let received = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        ctrl.abort();
        throw new Error(`audit-stream response exceeds ${MAX_RESPONSE_BYTES} byte limit`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return { ok: resp.ok, status: resp.status, text: text + decoder.decode() };
  } finally {
    clearTimeout(t);
  }
}

/**
 * POST one event to audit-stream-py. The server assigns event_id +
 * timestamp + prev_hash + hash; callers only provide kind + source +
 * payload. Returns the service's event receipt after validating its shape.
 */
export async function handleAuditEventEmit(args: {
  kind: unknown;
  source: unknown;
  payload?: unknown;
}): Promise<string> {
  const config = connection();
  if ("error" in config) return pretty(config);
  if (typeof args.kind !== "string" || !/^[a-z][a-z0-9_]{0,127}$/.test(args.kind)) {
    return pretty({ error: "`kind` must be a non-empty ASCII event-kind identifier" });
  }
  if (typeof args.source !== "string" || !args.source) {
    return pretty({ error: "`source` is required and must be a non-empty string" });
  }
  if (args.source.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(args.source)) {
    return pretty({ error: "`source` must be an ASCII service identifier of at most 128 characters" });
  }
  const hasPayload = Object.prototype.hasOwnProperty.call(args, "payload");
  if (hasPayload && !isPlainRecord(args.payload)) {
    return pretty({ error: "`payload` must be a plain object when supplied" });
  }
  const payload = hasPayload ? args.payload : {};
  let body: string;
  try {
    body = JSON.stringify({ kind: args.kind, source: args.source, payload });
  } catch {
    return pretty({ error: "`payload` must be JSON-serializable" });
  }
  if (Buffer.byteLength(body, "utf8") > MAX_EVENT_BYTES) {
    return pretty({ error: `event exceeds ${MAX_EVENT_BYTES} byte limit` });
  }

  try {
    const resp = await fetchWithTimeout(`${config.url}/events`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
      body,
    });
    if (resp.status !== 201) {
      return pretty({ error: `audit-stream returned HTTP ${resp.status}` });
    }
    const event = tryJson(resp.text);
    if (
      !isPlainRecord(event) ||
      !Number.isInteger(event.event_id) ||
      (event.event_id as number) < 1 ||
      typeof event.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(event.hash) ||
      event.kind !== args.kind ||
      event.source !== args.source
    ) {
      return pretty({ error: "audit-stream returned an invalid event receipt" });
    }
    return pretty({ ok: true, event });
  } catch (err) {
    return pretty({
      error: "failed to reach audit-stream",
      detail: safeRequestError(err),
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
  const config = connection();
  if ("error" in config) return pretty(config);
  const hasKind = Object.prototype.hasOwnProperty.call(args, "kind");
  const hasSource = Object.prototype.hasOwnProperty.call(args, "source");
  const hasLimit = Object.prototype.hasOwnProperty.call(args, "limit");
  if (Object.prototype.hasOwnProperty.call(args, "since_id")) {
    return pretty({ error: "audit-stream-py does not support since_id on GET /events" });
  }
  if (hasKind && (typeof args.kind !== "string" || !/^[a-z][a-z0-9_]{0,127}$/.test(args.kind))) {
    return pretty({ error: "`kind` must be a non-empty ASCII event-kind identifier" });
  }
  if (
    hasSource &&
    (typeof args.source !== "string" ||
      args.source.length > 128 ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(args.source))
  ) {
    return pretty({ error: "`source` must be an ASCII service identifier of at most 128 characters" });
  }
  if (hasKind && hasSource) {
    return pretty({ error: "audit-stream-py does not combine kind and source filters" });
  }
  if (
    hasLimit &&
    (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 1_000)
  ) {
    return pretty({ error: "`limit` must be an integer in 1..1000" });
  }

  const params = new URLSearchParams();
  if (hasKind) params.set("kind", args.kind as string);
  if (hasSource) params.set("source", args.source as string);
  if (hasLimit) {
    params.set("limit", String(args.limit));
  }
  const target = params.size > 0 ? `${config.url}/events?${params.toString()}` : `${config.url}/events`;
  try {
    const resp = await fetchWithTimeout(target, {
      method: "GET",
      headers: { authorization: `Bearer ${config.token}` },
    });
    if (resp.status !== 200) {
      return pretty({ error: `audit-stream returned HTTP ${resp.status}` });
    }
    const events = tryJson(resp.text);
    if (!Array.isArray(events)) {
      return pretty({ error: "audit-stream returned an invalid events response" });
    }
    return pretty({ ok: true, count: events.length, events });
  } catch (err) {
    return pretty({
      error: "failed to reach audit-stream",
      detail: safeRequestError(err),
    });
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Ask audit-stream-py to check its full server-side hash chain rather than
 * only the events pasted into context. Chain continuity cannot prove that
 * events are truthful, authorized, complete, or legally compliant.
 */
export async function handleAuditChainVerifyLive(_args: Record<string, never>): Promise<string> {
  const config = connection();
  if ("error" in config) return pretty(config);
  try {
    const resp = await fetchWithTimeout(`${config.url}/verify`, {
      method: "GET",
      headers: { authorization: `Bearer ${config.token}` },
    });
    if (resp.status !== 200) {
      return pretty({ error: `audit-stream returned HTTP ${resp.status}` });
    }
    const verification = tryJson(resp.text);
    if (
      !isPlainRecord(verification) ||
      typeof verification.valid !== "boolean" ||
      !Number.isInteger(verification.checked) ||
      (verification.checked as number) < 0
    ) {
      return pretty({ error: "audit-stream returned an invalid verification response" });
    }
    return pretty(verification);
  } catch (err) {
    return pretty({
      error: "failed to reach audit-stream",
      detail: safeRequestError(err),
    });
  }
}

function safeRequestError(err: unknown): string {
  if (err instanceof Error && err.message.startsWith("audit-stream response exceeds ")) {
    return err.message;
  }
  if (err instanceof Error && err.name === "AbortError") return "request timed out";
  // fetch errors can include implementation-specific request details. Do not
  // return those details to an MCP client when the request carried a secret.
  return "connection failed";
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
