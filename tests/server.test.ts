import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";

import { handlers } from "../src/server.js";
import { canonicalSha256 } from "../src/common.js";

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------
const AEO_DOC = {
  aeo_version: "0.1",
  entity: {
    id: "https://example.com/#org",
    type: "Organization",
    name: "Example Org",
    canonical_url: "https://example.com/",
  },
  authority: {
    primary_sources: ["https://example.com/"],
    verifications: [{ type: "domain", value: "example.com" }],
  },
  claims: [
    { id: "tagline", predicate: "description", value: "test", confidence: "high" },
    { id: "year", predicate: "foundingDate", value: 2026, confidence: "high" },
  ],
  audit: { mode: "none" },
};

const AGENT_CARD = {
  agent_card_version: "0.1",
  agent: {
    id: "support-t1",
    name: "Tier-1 Support",
    version: "1.0.0",
    provider: "Kinetic Gain",
    description: "First-line customer support agent.",
  },
  capabilities: {
    primary_purpose: "Resolve common questions.",
    models_used: [{ name: "claude-sonnet-4-6", provider: "Anthropic", role: "executor" }],
    tools: [
      { name: "billing-lookup", side_effects: "read", mcp_tool_card_uri: "https://example.com/.well-known/mcp-tools/billing-lookup.json" },
      { name: "ticket-create", side_effects: "mutating" },
    ],
    max_context_tokens: 100000,
    memory_persistence: "session",
    autonomy_level: "supervised",
  },
  refusal_taxonomy: [{ category: "legal_advice", behavior: "refuse_and_explain" }],
  deployment: { environment: "production" },
  safety_posture: { human_in_loop_required: ["entitlement_change"] },
};

const TOOL_CARD = {
  tool_card_version: "0.1",
  tool: {
    server_id: "kg-billing-mcp",
    name: "billing-lookup",
    version: "1.4.0",
    mcp_server_uri: "https://billing.kineticgain.com/mcp",
    description: "Looks up billing.",
  },
  schema: {
    input_schema_inline: { type: "object", properties: { customer_id: { type: "string" } } },
  },
  safety: {
    side_effect_class: "read",
    reversible: true,
    rate_limited: true,
    pii_exposure: "low",
    secrets_exposure: "none",
    human_approval_required: false,
    refusal_modes: ["cross_tenant_access"],
  },
  tested_with: [
    { llm: "claude-opus-4-7", provider: "Anthropic", test_suite_uri: "https://eval.example.com/s/billing", pass_rate: 0.98, tested_at: "2026-05-08T10:00:00Z" },
    { llm: "gpt-4o-2024-08-06", provider: "OpenAI", test_suite_uri: "https://eval.example.com/s/billing", pass_rate: 0.93, tested_at: "2026-05-08T11:00:00Z" },
  ],
  performance: { p50_latency_ms: 120, p99_latency_ms: 580 },
};

const PROMPT_PROVENANCE = {
  provenance_version: "0.1",
  prompt: {
    id: "incident-summary",
    name: "Incident Summary",
    version: "1.0.0",
    hash: "sha256:abc",
    content_uri: "https://example.com/prompt.j2",
    content_type: "text/jinja2",
  },
  authorship: { created_by: "alice@example.com", created_at: "2026-05-12T00:00:00Z" },
  evaluations: [
    { suite: "quality-v3", result_uri: "https://eval.example.com/q3", score: 0.94, passed: true, ran_at: "2026-05-12T01:00:00Z" },
    { suite: "pii-v1", result_uri: "https://eval.example.com/p1", score: 1.0, passed: true, ran_at: "2026-05-12T01:01:00Z" },
  ],
  approval: { state: "approved" },
};

const AI_EVIDENCE = {
  evidence_version: "0.1",
  evidence_id: "ev-test-001",
  claim_text: "Cambridge is in Massachusetts.",
  source: {
    uri: "https://en.wikipedia.org/wiki/Cambridge,_Massachusetts",
    type: "webpage",
    fetched_at: "2026-05-12T00:00:00Z",
  },
  span: { selector_type: "text_quote", selector_value: "Cambridge is a city" },
  retrieval: { method: "vector", confidence: 0.92 },
  verification: { content_hash: canonicalSha256("Cambridge is a city in Massachusetts.") },
  synthesis_role: "supporting",
};

// ----------------------------------------------------------------------------
// In-process HTTP server for the well-known-URL fetch tools
// ----------------------------------------------------------------------------
let server: HttpServer;
let origin: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/.well-known/aeo.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(AEO_DOC));
    } else if (req.url === "/.well-known/agents/support-t1.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(AGENT_CARD));
    } else if (req.url === "/.well-known/mcp-tools/billing-lookup.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(TOOL_CARD));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "object" && addr !== null) {
    origin = `http://127.0.0.1:${addr.port}`;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ----------------------------------------------------------------------------
// AEO Protocol tools
// ----------------------------------------------------------------------------
describe("AEO Protocol", () => {
  it("aeo_well_known_url builds the canonical path", async () => {
    const out = JSON.parse(await handlers.aeo_well_known_url!({ origin: "https://example.com" }));
    expect(out.url).toBe("https://example.com/.well-known/aeo.json");
  });

  it("aeo_fetch returns the full document", async () => {
    const out = JSON.parse(await handlers.aeo_fetch!({ origin }));
    expect(out.entity.name).toBe("Example Org");
    expect(out.claims).toHaveLength(2);
  });

  it("aeo_inspect returns a structured summary", async () => {
    const out = JSON.parse(await handlers.aeo_inspect!({ origin }));
    expect(out.protocol).toBe("0.1");
    expect(out.claim_count).toBe(2);
    expect(out.claim_ids).toEqual(["tagline", "year"]);
  });

  it("aeo_get_claim returns a single claim", async () => {
    const out = JSON.parse(await handlers.aeo_get_claim!({ origin, claim_id: "tagline" }));
    expect(out.value).toBe("test");
  });

  it("aeo_get_claim returns claim_not_found with available IDs", async () => {
    const out = JSON.parse(await handlers.aeo_get_claim!({ origin, claim_id: "nope" }));
    expect(out.error).toBe("claim_not_found");
    expect(out.available_claim_ids).toEqual(["tagline", "year"]);
  });
});

// ----------------------------------------------------------------------------
// Prompt Provenance tools
// ----------------------------------------------------------------------------
describe("Prompt Provenance", () => {
  const json = JSON.stringify(PROMPT_PROVENANCE);

  it("validate accepts a conforming document", async () => {
    const out = JSON.parse(await handlers.prompt_provenance_validate!({ document_json: json }));
    expect(out.valid).toBe(true);
    expect(out.prompt_id).toBe("incident-summary");
  });

  it("validate rejects garbage", async () => {
    const out = JSON.parse(await handlers.prompt_provenance_validate!({ document_json: "{ not json" }));
    expect(out.valid).toBe(false);
  });

  it("inspect summarizes evaluation suites", async () => {
    const out = JSON.parse(await handlers.prompt_provenance_inspect!({ document_json: json }));
    expect(out.evaluation_suites).toHaveLength(2);
    expect(out.approval_state).toBe("approved");
  });

  it("eval_result returns a specific suite", async () => {
    const out = JSON.parse(
      await handlers.prompt_provenance_eval_result!({ document_json: json, suite_name: "quality-v3" }),
    );
    expect(out.score).toBe(0.94);
  });

  it("eval_result returns not-found with available suites", async () => {
    const out = JSON.parse(
      await handlers.prompt_provenance_eval_result!({ document_json: json, suite_name: "missing" }),
    );
    expect(out.error).toBe("evaluation_not_found");
    expect(out.available_suites).toEqual(["quality-v3", "pii-v1"]);
  });
});

// ----------------------------------------------------------------------------
// Agent Cards tools
// ----------------------------------------------------------------------------
describe("Agent Cards", () => {
  const json = JSON.stringify(AGENT_CARD);

  it("well_known_url builds the path", async () => {
    const out = JSON.parse(
      await handlers.agent_card_well_known_url!({ origin: "https://example.com", agent_id: "support-t1" }),
    );
    expect(out.url).toBe("https://example.com/.well-known/agents/support-t1.json");
  });

  it("inspect accepts inline JSON", async () => {
    const out = JSON.parse(await handlers.agent_card_inspect!({ document_json: json }));
    expect(out.agent.id).toBe("support-t1");
    expect(out.tool_count).toBe(2);
    expect(out.autonomy_level).toBe("supervised");
  });

  it("inspect accepts a fetched URL", async () => {
    const out = JSON.parse(
      await handlers.agent_card_inspect!({ url: `${origin}/.well-known/agents/support-t1.json` }),
    );
    expect(out.agent.name).toBe("Tier-1 Support");
  });

  it("tool_disclosure lists declared tools", async () => {
    const out = JSON.parse(await handlers.agent_card_tool_disclosure!({ document_json: json }));
    expect(out.tools).toHaveLength(2);
    expect(out.tools[0].name).toBe("billing-lookup");
    expect(out.tools[0].mcp_tool_card_uri).toBeTruthy();
  });

  it("validate accepts a conforming document", async () => {
    const out = JSON.parse(await handlers.agent_card_validate!({ document_json: json }));
    expect(out.valid).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// AI Evidence tools
// ----------------------------------------------------------------------------
describe("AI Evidence", () => {
  const json = JSON.stringify(AI_EVIDENCE);

  it("validate accepts a conforming document", async () => {
    const out = JSON.parse(await handlers.ai_evidence_validate!({ document_json: json }));
    expect(out.valid).toBe(true);
    expect(out.synthesis_role).toBe("supporting");
  });

  it("inspect returns structured fields", async () => {
    const out = JSON.parse(await handlers.ai_evidence_inspect!({ document_json: json }));
    expect(out.evidence_id).toBe("ev-test-001");
    expect(out.synthesis_role).toBe("supporting");
    expect(out.signed).toBe(false);
  });

  it("verify_hash succeeds on matching candidate", async () => {
    const out = JSON.parse(
      await handlers.ai_evidence_verify_hash!({
        document_json: json,
        candidate_text: "Cambridge is a city in Massachusetts.",
      }),
    );
    expect(out.ok).toBe(true);
  });

  it("verify_hash fails on tampered candidate", async () => {
    const out = JSON.parse(
      await handlers.ai_evidence_verify_hash!({
        document_json: json,
        candidate_text: "Cambridge is NOT a city in Massachusetts.",
      }),
    );
    expect(out.error).toBe("hash_mismatch");
    expect(out.expected).toBe(AI_EVIDENCE.verification.content_hash);
  });
});

// ----------------------------------------------------------------------------
// MCP Tool Cards tools
// ----------------------------------------------------------------------------
describe("MCP Tool Cards", () => {
  const json = JSON.stringify(TOOL_CARD);

  it("well_known_url builds the path", async () => {
    const out = JSON.parse(
      await handlers.tool_card_well_known_url!({ mcp_server_origin: "https://example.com", tool_name: "billing-lookup" }),
    );
    expect(out.url).toBe("https://example.com/.well-known/mcp-tools/billing-lookup.json");
  });

  it("inspect summarizes safety profile", async () => {
    const out = JSON.parse(await handlers.tool_card_inspect!({ document_json: json }));
    expect(out.side_effect_class).toBe("read");
    expect(out.human_approval_required).toBe(false);
    expect(out.test_count).toBe(2);
  });

  it("inspect accepts a fetched URL", async () => {
    const out = JSON.parse(
      await handlers.tool_card_inspect!({ url: `${origin}/.well-known/mcp-tools/billing-lookup.json` }),
    );
    expect(out.tool.name).toBe("billing-lookup");
  });

  it("tested_with returns all entries by default", async () => {
    const out = JSON.parse(await handlers.tool_card_tested_with!({ document_json: json }));
    expect(out.matches).toHaveLength(2);
  });

  it("tested_with filters by LLM substring", async () => {
    const out = JSON.parse(
      await handlers.tool_card_tested_with!({ document_json: json, llm_filter: "claude" }),
    );
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].llm).toBe("claude-opus-4-7");
  });

  it("tested_with returns no_matching_tests when filter misses", async () => {
    const out = JSON.parse(
      await handlers.tool_card_tested_with!({ document_json: json, llm_filter: "gemini" }),
    );
    expect(out.error).toBe("no_matching_tests");
    expect(out.available_llms).toEqual(["claude-opus-4-7", "gpt-4o-2024-08-06"]);
  });

  it("validate accepts a conforming document", async () => {
    const out = JSON.parse(await handlers.tool_card_validate!({ document_json: json }));
    expect(out.valid).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// Cross-cutting
// ----------------------------------------------------------------------------
describe("Unknown tool", () => {
  it("server is built and only exposes the 18 declared tools", () => {
    expect(Object.keys(handlers)).toHaveLength(18);
  });
});
