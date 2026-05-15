/**
 * Audit-stream event tools — compose, inspect, and verify hash-chained
 * governance events from `audit-stream-py`.
 *
 * Wire format (same as `audit-stream-py`):
 *   {
 *     "event_id":   42,
 *     "timestamp":  "2026-05-15T03:14:15+00:00",
 *     "kind":       "watch_drifted",
 *     "source":     "aeo-validator-service",
 *     "payload":    {...},
 *     "prev_hash":  "9a3f...",
 *     "hash":       "b7d1..."
 *   }
 *
 * Chain rules:
 *   - event #1 carries `prev_hash` = 64 zeros.
 *   - every subsequent event's `prev_hash` is the previous event's `hash`.
 *   - `hash` is the SHA-256 hex of canonical JSON of every field except
 *     `hash` (sorted keys, no whitespace).
 */
import { createHash } from "node:crypto";

import { pretty } from "../common.js";

const GENESIS_HASH = "0".repeat(64);

const KNOWN_KINDS = new Set([
  "decision_card_drafted",
  "decision_card_signed",
  "decision_card_status_changed",
  "policy_bundle_registered",
  "request_denied",
  "request_allowed",
  "contract_promoted",
  "contract_deprecated",
  "contract_compatibility_failed",
  "watch_created",
  "watch_drifted",
  "watch_validity_flipped",
  "incident_filed",
  "remediation_planned",
  "attestation_verified",
  "attestation_tampered",
  "flag_swapped",
  "shadow_divergence_recorded",
  "other",
]);

interface EventBody {
  event_id: number;
  timestamp: string;
  kind: string;
  source: string;
  payload: Record<string, unknown>;
  prev_hash: string;
}

interface FullEvent extends EventBody {
  hash: string;
}

/**
 * Build a ready-to-POST event: assigns `event_id`, computes `hash`. The
 * caller passes everything else (or `prev_hash` for chain continuation).
 */
export async function handleAuditEventCompose(args: {
  event_id: number;
  kind: string;
  source: string;
  payload?: Record<string, unknown>;
  prev_hash?: string;
  timestamp?: string;
}): Promise<string> {
  if (!Number.isInteger(args.event_id) || args.event_id < 1) {
    return pretty({ error: "`event_id` must be a positive integer" });
  }
  if (typeof args.kind !== "string" || !args.kind) {
    return pretty({ error: "`kind` is required" });
  }
  if (!KNOWN_KINDS.has(args.kind)) {
    return pretty({
      error: `unknown event kind: ${args.kind}`,
      known: [...KNOWN_KINDS],
    });
  }
  if (typeof args.source !== "string" || !args.source) {
    return pretty({ error: "`source` is required" });
  }

  const prev_hash = args.prev_hash ?? GENESIS_HASH;
  if (typeof prev_hash !== "string" || prev_hash.length !== 64) {
    return pretty({ error: "`prev_hash` must be a 64-char hex string" });
  }

  const body: EventBody = {
    event_id: args.event_id,
    timestamp: args.timestamp ?? new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    kind: args.kind,
    source: args.source,
    payload: args.payload ?? {},
    prev_hash,
  };

  const event: FullEvent = { ...body, hash: hashBody(body) };
  return pretty(event);
}

/**
 * Walk an array of events and verify the chain. Returns the first break,
 * if any.
 */
export async function handleAuditChainVerify(args: { events: unknown }): Promise<string> {
  if (!Array.isArray(args.events)) {
    return pretty({ valid: false, reason: "`events` must be an array" });
  }
  const events = args.events as unknown[];

  let expectedPrev = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const ev = parseEvent(events[i]);
    if ("error" in ev) {
      return pretty({
        valid: false,
        checked: i,
        first_break_at: i + 1,
        reason: ev.error,
      });
    }
    if (ev.event_id !== i + 1) {
      return pretty({
        valid: false,
        checked: i,
        first_break_at: i + 1,
        reason: `event_id should be ${i + 1}, got ${ev.event_id}`,
      });
    }
    if (ev.prev_hash !== expectedPrev) {
      return pretty({
        valid: false,
        checked: i,
        first_break_at: i + 1,
        reason: `prev_hash mismatch at event #${i + 1}`,
      });
    }
    const body: EventBody = {
      event_id: ev.event_id,
      timestamp: ev.timestamp,
      kind: ev.kind,
      source: ev.source,
      payload: ev.payload,
      prev_hash: ev.prev_hash,
    };
    const recomputed = hashBody(body);
    if (recomputed !== ev.hash) {
      return pretty({
        valid: false,
        checked: i,
        first_break_at: i + 1,
        reason: `hash mismatch at event #${i + 1}`,
      });
    }
    expectedPrev = ev.hash;
  }

  return pretty({ valid: true, checked: events.length, first_break_at: null, reason: null });
}

/**
 * Pretty-print one event with a structural validation summary.
 */
export async function handleAuditEventInspect(args: { event: unknown }): Promise<string> {
  const ev = parseEvent(args.event);
  if ("error" in ev) return pretty(ev);

  const body: EventBody = {
    event_id: ev.event_id,
    timestamp: ev.timestamp,
    kind: ev.kind,
    source: ev.source,
    payload: ev.payload,
    prev_hash: ev.prev_hash,
  };
  const recomputed = hashBody(body);

  return pretty({
    valid_envelope: true,
    event_id: ev.event_id,
    timestamp: ev.timestamp,
    kind: ev.kind,
    known_kind: KNOWN_KINDS.has(ev.kind),
    source: ev.source,
    payload_keys: Object.keys(ev.payload),
    prev_hash: ev.prev_hash,
    hash: ev.hash,
    self_consistent: recomputed === ev.hash,
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function hashBody(body: EventBody): string {
  const canonical = canonicalJson(body);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function parseEvent(raw: unknown): FullEvent | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "event must be an object" };
  }
  const e = raw as Record<string, unknown>;
  if (typeof e.event_id !== "number" || !Number.isInteger(e.event_id) || e.event_id < 1) {
    return { error: "event.event_id must be a positive integer" };
  }
  if (typeof e.timestamp !== "string") return { error: "event.timestamp must be a string" };
  if (typeof e.kind !== "string") return { error: "event.kind must be a string" };
  if (typeof e.source !== "string") return { error: "event.source must be a string" };
  if (typeof e.prev_hash !== "string" || e.prev_hash.length !== 64) {
    return { error: "event.prev_hash must be a 64-char hex string" };
  }
  if (typeof e.hash !== "string" || e.hash.length !== 64) {
    return { error: "event.hash must be a 64-char hex string" };
  }
  const payload =
    typeof e.payload === "object" && e.payload !== null && !Array.isArray(e.payload)
      ? (e.payload as Record<string, unknown>)
      : {};
  return {
    event_id: e.event_id,
    timestamp: e.timestamp,
    kind: e.kind,
    source: e.source,
    payload,
    prev_hash: e.prev_hash,
    hash: e.hash,
  };
}

/** Same canonical-JSON convention as audit-stream-py. */
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
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
    return (
      "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}"
    );
  }
  return "null";
}
