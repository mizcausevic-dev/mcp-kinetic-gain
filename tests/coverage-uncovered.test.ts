/**
 * Additive coverage for tools that had no direct test in server.test.ts.
 *
 * A cross-reference of tools/list against tests/server.test.ts found 16 tool
 * names that never appeared in a test: the 8 DefenseTech tools, the 3 live
 * audit-stream tools, and the 5 card-fetch tools. This file adds tests for
 * each WITHOUT modifying any existing test or any src/ file.
 *
 *   - DefenseTech (pure/deterministic): happy path + one error/edge path each.
 *   - Live audit-stream (network): the deterministic no-AUDIT_STREAM_URL error
 *     path (the happy path needs a running audit-stream-py; out of scope here).
 *   - Card fetch (network): the unreachable-URL error path. Their happy-path
 *     schema validation is already covered by the matching *_validate/*_inspect
 *     tests on inline JSON; only the HTTP layer was uncovered.
 */
import { describe, it, expect } from "vitest";

import { handlers } from "../src/server.js";

const call = async (name: string, args: unknown) =>
  JSON.parse(await handlers[name]!(args as any));

// ---------------------------------------------------------------------------
// DefenseTech (8) — pure, deterministic
// ---------------------------------------------------------------------------
describe("coverage: defensetech_vault_resolve_3axis", () => {
  const contract = {
    axis_policies: {
      cui_handling_policy: {
        "CUI-BASIC": { allowed_actions: ["read", "summarize"], minimum_human_user_status: "us-person-verified", requires_audit: true },
      },
      export_control_handling_policy: {
        EAR: { allowed_actions: ["read"], minimum_human_user_status: "any" },
      },
      foreign_person_handling_policy: {
        "US-PERSON": { allowed_actions: ["read", "summarize", "export"], minimum_human_user_status: "any" },
      },
    },
  };

  it("resolves the most-restrictive policy across the three axes", async () => {
    const out = await call("defensetech_vault_resolve_3axis", {
      contract,
      tuple: { cui: "CUI-BASIC", export_control: "EAR", foreign_person: "US-PERSON" },
    });
    expect(out.ok).toBe(true);
    expect(out.resolved_allowed_actions).toEqual(["read"]); // intersection of the three sets
    expect(out.resolved_minimum_human_user_status).toBe("us-person-verified"); // highest rank
    expect(out.requires_audit).toBe(true); // OR-ed requires_* flags
  });

  it("errors when the contract has no axis_policies", async () => {
    const out = await call("defensetech_vault_resolve_3axis", {
      contract: {},
      tuple: { cui: "CUI-BASIC", export_control: "EAR", foreign_person: "US-PERSON" },
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/axis_policies/);
  });
});

describe("coverage: defensetech_audit_event_check_invariants", () => {
  it("passes a clean event (all invariants N/A)", async () => {
    const out = await call("defensetech_audit_event_check_invariants", { event: {} });
    expect(out.ok).toBe(true);
    expect(out.errors).toEqual([]);
  });

  it("flags a CUI-Specified+ event missing a distribution_statement", async () => {
    const out = await call("defensetech_audit_event_check_invariants", {
      event: { resource: { cui_categorization: "CUI-SPECIFIED" } },
    });
    expect(out.ok).toBe(false);
    expect(out.errors.some((e: string) => e.includes("#1"))).toBe(true);
  });
});

describe("coverage: defensetech_check_dfars_72h_clock", () => {
  it("is within the window when filed under 72h after the incident", async () => {
    const out = await call("defensetech_check_dfars_72h_clock", {
      occurred_at: "2026-05-01T00:00:00Z",
      filed_at: "2026-05-02T00:00:00Z", // 24h
    });
    expect(out.within_window).toBe(true);
    expect(out.overrun_hours).toBe(0);
  });

  it("reports overrun when filed past 72h", async () => {
    const out = await call("defensetech_check_dfars_72h_clock", {
      occurred_at: "2026-05-01T00:00:00Z",
      filed_at: "2026-05-05T04:00:00Z", // 100h
    });
    expect(out.within_window).toBe(false);
    expect(out.overrun_hours).toBeGreaterThan(0);
  });
});

describe("coverage: defensetech_check_cui_distribution_statement", () => {
  it("passes when a Specified+ tier carries a distribution statement", async () => {
    const out = await call("defensetech_check_cui_distribution_statement", {
      cui_categorization: "CUI-SPECIFIED",
      distribution_statement: { statement: "DISTRIBUTION C" },
    });
    expect(out.distribution_statement_required).toBe(true);
    expect(out.ok).toBe(true);
  });

  it("fails when a Specified+ tier lacks a distribution statement", async () => {
    const out = await call("defensetech_check_cui_distribution_statement", {
      cui_categorization: "CUI-SPECIFIED",
    });
    expect(out.distribution_statement_required).toBe(true);
    expect(out.distribution_statement_present).toBe(false);
    expect(out.ok).toBe(false);
  });
});

describe("coverage: defensetech_check_itar_us_person", () => {
  it("passes an ITAR resource with a verified US person", async () => {
    const out = await call("defensetech_check_itar_us_person", {
      export_control_status: "ITAR",
      human_user_us_person_status: "US-PERSON-VERIFIED",
    });
    expect(out.applicable).toBe(true);
    expect(out.ok).toBe(true);
  });

  it("fails an ITAR resource with an unverified user", async () => {
    const out = await call("defensetech_check_itar_us_person", {
      export_control_status: "ITAR",
      human_user_us_person_status: "UNKNOWN",
    });
    expect(out.ok).toBe(false);
  });
});

describe("coverage: defensetech_incident_classify_event_type", () => {
  it("classifies a recognizable incident description", async () => {
    const out = await call("defensetech_incident_classify_event_type", {
      description: "An ITAR deemed export violation exposed data to a foreign person.",
    });
    expect(out.best_match).not.toBeNull();
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.all_known_event_types_count).toBe(22);
  });

  it("returns no match for an empty description", async () => {
    const out = await call("defensetech_incident_classify_event_type", { description: "" });
    expect(out.best_match).toBeNull();
    expect(out.candidates).toEqual([]);
  });
});

describe("coverage: defensetech_summarize_cmmc_evidence_bundle", () => {
  it("summarizes a bundle and flags no orphan failures when none exist", async () => {
    const out = await call("defensetech_summarize_cmmc_evidence_bundle", {
      bundle: {
        bundle_id: "B1",
        assessment: { target_cmmc_level: "L2", assessment_mode: "self" },
        evidence: [{ control_family: "AC", outcome: "satisfied" }],
      },
    });
    expect(out.evidence_count).toBe(1);
    expect(out.invariant_checks.no_orphan_failures).toBe(true);
  });

  it("flags an orphan failure (not-satisfied without a poam_ref)", async () => {
    const out = await call("defensetech_summarize_cmmc_evidence_bundle", {
      bundle: { evidence: [{ control_family: "AC", outcome: "not-satisfied" }] },
    });
    expect(out.orphan_failures_count).toBe(1);
    expect(out.invariant_checks.no_orphan_failures).toBe(false);
  });
});

describe("coverage: defensetech_vault_contract_cross_binding_check", () => {
  it("passes when every cross_binding_ref is an HTTPS URL", async () => {
    const out = await call("defensetech_vault_contract_cross_binding_check", {
      contract: { cross_binding_refs: { incident_card: "https://x.example/inc.json" } },
    });
    expect(out.ok).toBe(true);
    expect(out.ref_count).toBe(1);
  });

  it("fails when a cross_binding_ref is not a URL", async () => {
    const out = await call("defensetech_vault_contract_cross_binding_check", {
      contract: { cross_binding_refs: { incident_card: "not-a-url" } },
    });
    expect(out.ok).toBe(false);
    expect(out.errors.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Live audit-stream (3) — deterministic no-AUDIT_STREAM_URL error path
// ---------------------------------------------------------------------------
describe("coverage: live audit-stream tools without AUDIT_STREAM_URL", () => {
  async function withoutUrl(fn: () => Promise<any>) {
    const prev = process.env.AUDIT_STREAM_URL;
    delete process.env.AUDIT_STREAM_URL;
    try {
      return await fn();
    } finally {
      if (prev !== undefined) process.env.AUDIT_STREAM_URL = prev;
    }
  }

  it("audit_event_emit returns a structured not-configured error", async () => {
    const out = await withoutUrl(() => call("audit_event_emit", { kind: "k", source: "s" }));
    expect(out.error).toMatch(/AUDIT_STREAM_URL is not set/);
  });

  it("audit_events_query returns a structured not-configured error", async () => {
    const out = await withoutUrl(() => call("audit_events_query", {}));
    expect(out.error).toMatch(/AUDIT_STREAM_URL is not set/);
  });

  it("audit_chain_verify_live returns a structured not-configured error", async () => {
    const out = await withoutUrl(() => call("audit_chain_verify_live", {}));
    expect(out.error).toMatch(/AUDIT_STREAM_URL is not set/);
  });
});

// ---------------------------------------------------------------------------
// Card fetch (5) — unreachable-URL error path
// ---------------------------------------------------------------------------
describe("coverage: card-fetch tools reject on an unreachable URL", () => {
  const DEAD = "http://127.0.0.1:1/nope.json"; // connection refused
  for (const name of [
    "tutor_card_fetch",
    "aup_fetch",
    "clinical_ai_fetch",
    "incident_fetch",
    "decision_card_fetch",
  ]) {
    it(`${name} rejects when the URL cannot be fetched`, async () => {
      await expect(handlers[name]!({ url: DEAD } as any)).rejects.toThrow();
    });
  }
});
