/**
 * AI Claims Decision Card (InsurTech) — 12th Suite spec, v0.9.0.
 *
 * Covers the four claims_card_* handlers: validate, inspect, sign, chain.
 * The sign test hardcodes a known SHA-256 digest so any drift in the canonical
 * serialization is caught (not just self-consistency).
 */
import { describe, it, expect } from "vitest";

import {
  handleClaimsCardChain,
  handleClaimsCardInspect,
  handleClaimsCardSign,
  handleClaimsCardValidate,
} from "../src/handlers/claims-card.js";

// A structurally-valid, fully-fictional card. Matches the fixture used to
// precompute EXPECTED_CARD_HASH below.
function validCard(): Record<string, any> {
  return {
    claims_card_version: "0.1",
    claim: {
      claim_id: "c-test-1",
      policy_id: "POL-1",
      claimant_ref: "REF-1",
      claim_type: "auto",
      filed_at: "2026-06-01T00:00:00Z",
    },
    decision: {
      outcome: "approve",
      reasons: ["ok"],
      rule_refs: ["R1"],
      coverage: { covered: true, amount: 1000, currency: "USD" },
    },
    evidence_bundle: {
      sources: [
        {
          source_id: "E1",
          source_type: "document",
          content_hash: "a".repeat(64),
          retrieval_confidence: 0.9,
          synthesis_role: "primary",
        },
      ],
      model: { model_id: "m", model_version: "1", provider: "p" },
      synthesis_method: "rule",
    },
    governance: {
      underwriting_rules_version: "UW-1",
      jurisdiction: "US-CA",
      regulatory_refs: ["X"],
      human_in_loop: true,
      reviewer_ref: "RV-1",
    },
    attestation: {
      card_hash: "IGNORED",
      signature: "IGNORED",
      algorithm: "ed25519",
      signing_key_id: "k1",
      signed_at: "2026-06-02T00:00:00Z",
      chain_index: 0,
      prev_card_hash: null,
    },
    disclaimer: "This is a governance artifact, not legal advice, for testing only.",
  };
}

// Precomputed SHA-256 of the canonical (sorted-keys, whitespace-free) JSON of
// validCard() with attestation.card_hash + attestation.signature stripped.
const EXPECTED_CARD_HASH = "f399b417886d0c7bddc99346a6a50d8a62266b0959d107818ac1d589fcaf9bbf";

const parse = (s: string): any => JSON.parse(s);

describe("claims_card_validate", () => {
  it("accepts a valid card", async () => {
    const out = parse(await handleClaimsCardValidate({ document: validCard() }));
    expect(out.valid).toBe(true);
    expect(out.claims_card_id).toBe("c-test-1");
    expect(out.version).toBe("0.1");
  });

  it("rejects a card missing a required top-level field", async () => {
    const card = validCard();
    delete card.governance;
    const out = parse(await handleClaimsCardValidate({ document: card }));
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/governance/);
  });

  it("rejects a document with no claims_card_version (wrong spec)", async () => {
    const out = parse(await handleClaimsCardValidate({ document: { decision_card_version: "0.1" } as any }));
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/claims_card_version/);
  });

  it("rejects an invalid decision.outcome", async () => {
    const card = validCard();
    card.decision.outcome = "maybe";
    const out = parse(await handleClaimsCardValidate({ document: card }));
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/outcome/);
  });
});

describe("claims_card_inspect", () => {
  it("summarizes the card", async () => {
    const out = parse(await handleClaimsCardInspect({ document: validCard() }));
    expect(out.claims_card_version).toBe("0.1");
    expect(out.claim_type).toBe("auto");
    expect(out.outcome).toBe("approve");
    expect(out.covered).toBe(true);
    expect(out.coverage_amount).toBe(1000);
    expect(out.evidence_count).toBe(1);
    expect(out.jurisdiction).toBe("US-CA");
    expect(out.human_in_loop).toBe(true);
    expect(out.chain_index).toBe(0);
    expect(out.has_predecessor).toBe(false);
    expect(out.disclaimer_present).toBe(true);
  });
});

describe("claims_card_sign", () => {
  it("computes the known canonical SHA-256 (attestation-excluded)", async () => {
    const out = parse(await handleClaimsCardSign({ document: validCard() }));
    expect(out.card_hash).toBe(EXPECTED_CARD_HASH);
    expect(out.card_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(out.algorithm).toBe("SHA-256");
  });

  it("is invariant to the pre-existing card_hash/signature values", async () => {
    const a = validCard();
    const b = validCard();
    b.attestation.card_hash = "deadbeef";
    b.attestation.signature = "cafebabe";
    const ha = parse(await handleClaimsCardSign({ document: a })).card_hash;
    const hb = parse(await handleClaimsCardSign({ document: b })).card_hash;
    expect(ha).toBe(hb);
  });
});

describe("claims_card_chain", () => {
  it("links to a predecessor: chain_index prev+1 and prev_card_hash set", async () => {
    const card = validCard();
    const prev_card_hash = "b".repeat(64);
    const out = parse(await handleClaimsCardChain({ card, prev_card_hash, prev_chain_index: 3 }));
    expect(out.chain_index).toBe(4);
    expect(out.prev_card_hash).toBe(prev_card_hash);
    expect(out.ready_for_signing).toBe(true);
  });

  it("errors on a malformed predecessor hash", async () => {
    const out = parse(
      await handleClaimsCardChain({ card: validCard(), prev_card_hash: "not-hex", prev_chain_index: 0 }),
    );
    expect(out.error).toMatch(/prev_card_hash/);
  });

  it("errors on a negative predecessor index", async () => {
    const out = parse(
      await handleClaimsCardChain({ card: validCard(), prev_card_hash: "b".repeat(64), prev_chain_index: -1 }),
    );
    expect(out.error).toMatch(/prev_chain_index/);
  });
});
