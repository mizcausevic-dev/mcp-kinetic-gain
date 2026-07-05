import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handlers } from "../src/server.js";
import { canonicalSha256 } from "../src/common.js";
import { dispatchCli, runValidate, PACKAGE_VERSION } from "../src/cli.js";

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
// AI Tutor Cards (EdTech extension)
// ----------------------------------------------------------------------------
const TUTOR_CARD = {
  tutor_card_version: "0.1",
  tutor: {
    id: "k12-math-tutor",
    name: "K-12 Math Tutor",
    version: "1.0.0",
    provider: "Kinetic Gain Edu",
    description: "Personal AI math tutor for K-12.",
  },
  audience: {
    age_range_min: 5,
    age_range_max: 18,
    grade_range_min: "K",
    grade_range_max: "12",
    language_codes: ["en", "es"],
  },
  subject_scope: {
    primary_subjects: ["Math"],
    topics_included: ["arithmetic", "algebra", "geometry"],
    topics_excluded: ["calculus"],
  },
  pedagogy: {
    approach: "socratic",
    homework_policy: "guide_only",
    assessment_policy: "refuse",
  },
  safety: {
    content_filter_strength: "strict",
    mandated_reporter_protocol: true,
    human_in_loop_required: ["abuse_disclosure"],
  },
  data_privacy: {
    ferpa_compliant: true,
    coppa_compliant: true,
    gdpr_compliant: true,
    retention_days: 90,
    data_sharing_with_parents: "summaries_only",
    data_sharing_with_school: "summaries_only",
    third_party_data_sharing: false,
  },
};

const COPPA_VIOLATING_TUTOR_CARD = {
  ...TUTOR_CARD,
  tutor: { ...TUTOR_CARD.tutor, id: "broken-card" },
  audience: { ...TUTOR_CARD.audience, age_range_min: 8 },
  data_privacy: { ...TUTOR_CARD.data_privacy, coppa_compliant: false },
};

describe("AI Tutor Cards", () => {
  const json = JSON.stringify(TUTOR_CARD);

  it("well_known_url builds the canonical path", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_well_known_url!({
        origin: "https://edu.example.com",
        tutor_id: "k12-math-tutor",
      }),
    );
    expect(out.url).toBe("https://edu.example.com/.well-known/tutors/k12-math-tutor.json");
  });

  it("validate accepts a conforming card", async () => {
    const out = JSON.parse(await handlers.tutor_card_validate!({ document_json: json }));
    expect(out.valid).toBe(true);
    expect(out.coppa_check.ok).toBe(true);
  });

  it("validate flags the COPPA conditional violation", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_validate!({
        document_json: JSON.stringify(COPPA_VIOLATING_TUTOR_CARD),
      }),
    );
    expect(out.coppa_check.ok).toBe(false);
    expect(out.coppa_check.reason).toContain("SPEC VIOLATION");
  });

  it("inspect returns procurement summary", async () => {
    const out = JSON.parse(await handlers.tutor_card_inspect!({ document_json: json }));
    expect(out.audience.ages).toBe("5-18");
    expect(out.pedagogy.homework_policy).toBe("guide_only");
    expect(out.privacy.ferpa_compliant).toBe(true);
    expect(out.coppa_check.ok).toBe(true);
  });

  it("subject_check classifies primary / included / excluded / unknown", async () => {
    const primary = JSON.parse(
      await handlers.tutor_card_subject_check!({ document_json: json, query: "math" }),
    );
    expect(primary.classification).toBe("primary");

    const included = JSON.parse(
      await handlers.tutor_card_subject_check!({ document_json: json, query: "algebra" }),
    );
    expect(included.classification).toBe("included");

    const excluded = JSON.parse(
      await handlers.tutor_card_subject_check!({ document_json: json, query: "calculus" }),
    );
    expect(excluded.classification).toBe("excluded");

    const unknown = JSON.parse(
      await handlers.tutor_card_subject_check!({ document_json: json, query: "creative writing" }),
    );
    expect(unknown.classification).toBe("unknown");
  });

  it("coppa_check passes when age_range_min < 13 and coppa_compliant", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_coppa_check!({ document_json: json }),
    );
    expect(out.ok).toBe(true);
  });

  it("coppa_check fails when age_range_min < 13 and !coppa_compliant", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_coppa_check!({
        document_json: JSON.stringify(COPPA_VIOLATING_TUTOR_CARD),
      }),
    );
    expect(out.error).toBe("coppa_violation");
  });
});

// ----------------------------------------------------------------------------
// Student AI Disclosure (EdTech extension)
// ----------------------------------------------------------------------------
const NO_AI_DISCLOSURE = {
  disclosure_version: "0.1",
  disclosure_id: "d-test-no-ai",
  created_at: "2026-05-12T14:30:00Z",
  student: { id: "stu-1", grade_or_year: "10" },
  assignment: { id: "a1", title: "Essay", course_id: "c1", lms: "canvas" },
  ai_used: false,
  artifact_hash: "sha256:" + "a".repeat(64),
  signed_by_student: true,
  student_signature_at: "2026-05-12T14:30:00Z",
};

const HASHED_PROMPT_DISCLOSURE = {
  disclosure_version: "0.1",
  disclosure_id: "d-test-hashed",
  created_at: "2026-05-12T16:42:00Z",
  student: { id: "stu-2", grade_or_year: "11" },
  assignment: { id: "a2", title: "Lab Report", course_id: "c2", lms: "canvas" },
  ai_used: true,
  tools_used: [{ name: "Claude.ai", provider: "Anthropic", version: "claude-sonnet-4-6" }],
  roles: ["edit"],
  assistance_extent: "minor",
  assistance_pct: 8,
  prompt_evidence_mode: "hashed",
  prompts: [
    {
      id: "p1",
      hash: canonicalSha256("Please fix grammar in this paragraph: ..."),
      at: "2026-05-12T15:55:00Z",
      tool_index: 0,
    },
  ],
  artifact_hash: "sha256:" + "b".repeat(64),
  signed_by_student: true,
  student_signature_at: "2026-05-12T16:42:00Z",
};

const FULL_PROMPT_DISCLOSURE = {
  disclosure_version: "0.1",
  disclosure_id: "d-test-full",
  created_at: "2026-05-12T20:05:00Z",
  student: { id: "stu-3", grade_or_year: "undergrad" },
  assignment: { id: "a3", title: "Final Project", course_id: "cs180", lms: "moodle" },
  ai_used: true,
  tools_used: [{ name: "Claude.ai", provider: "Anthropic" }],
  roles: ["draft"],
  assistance_extent: "primary_author",
  prompt_evidence_mode: "full",
  prompts: [{ id: "p1", text: "Write a web scraper." }],
  artifact_hash: canonicalSha256("print('hello')"),
  signed_by_student: true,
  student_signature_at: "2026-05-12T20:05:00Z",
};

describe("Student AI Disclosure", () => {
  it("validate accepts a no-AI disclosure", async () => {
    const out = JSON.parse(
      await handlers.disclosure_validate!({
        document_json: JSON.stringify(NO_AI_DISCLOSURE),
      }),
    );
    expect(out.valid).toBe(true);
    expect(out.ai_used).toBe(false);
  });

  it("validate accepts a hashed-mode AI disclosure", async () => {
    const out = JSON.parse(
      await handlers.disclosure_validate!({
        document_json: JSON.stringify(HASHED_PROMPT_DISCLOSURE),
      }),
    );
    expect(out.valid).toBe(true);
    expect(out.ai_used).toBe(true);
    expect(out.prompt_evidence_mode).toBe("hashed");
  });

  it("validate rejects ai_used=true with missing required fields", async () => {
    const bad = { ...NO_AI_DISCLOSURE, ai_used: true };
    const out = JSON.parse(
      await handlers.disclosure_validate!({ document_json: JSON.stringify(bad) }),
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/tools_used|roles|assistance_extent|prompt_evidence_mode/);
  });

  it("validate rejects ai_used=false with forbidden AI fields", async () => {
    const bad = { ...NO_AI_DISCLOSURE, ai_used: false, tools_used: [{ name: "X" }] };
    const out = JSON.parse(
      await handlers.disclosure_validate!({ document_json: JSON.stringify(bad) }),
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/forbids/);
  });

  it("validate rejects prompt mode mismatch (full mode with hash field)", async () => {
    const bad = {
      ...FULL_PROMPT_DISCLOSURE,
      prompts: [{ id: "p1", hash: "sha256:" + "c".repeat(64) }],
    };
    const out = JSON.parse(
      await handlers.disclosure_validate!({ document_json: JSON.stringify(bad) }),
    );
    expect(out.valid).toBe(false);
  });

  it("inspect returns a procurement-friendly summary", async () => {
    const out = JSON.parse(
      await handlers.disclosure_inspect!({
        document_json: JSON.stringify(HASHED_PROMPT_DISCLOSURE),
      }),
    );
    expect(out.ai_used).toBe(true);
    expect(out.tools_used).toHaveLength(1);
    expect(out.tools_used[0].name).toBe("Claude.ai");
    expect(out.roles).toContain("edit");
    expect(out.prompt_count).toBe(1);
    expect(out.artifact_hash).toBe(HASHED_PROMPT_DISCLOSURE.artifact_hash);
  });

  it("verify_artifact_hash matches when canonical text recomputes to stored hash", async () => {
    const out = JSON.parse(
      await handlers.disclosure_verify_artifact_hash!({
        document_json: JSON.stringify(FULL_PROMPT_DISCLOSURE),
        candidate_text: "print('hello')",
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.mode).toBe("canonical_text");
  });

  it("verify_artifact_hash mismatches when candidate text is different", async () => {
    const out = JSON.parse(
      await handlers.disclosure_verify_artifact_hash!({
        document_json: JSON.stringify(FULL_PROMPT_DISCLOSURE),
        candidate_text: "print('goodbye')",
      }),
    );
    expect(out.error).toBe("artifact_hash_mismatch");
    expect(out.expected).toBe(FULL_PROMPT_DISCLOSURE.artifact_hash);
  });

  it("verify_artifact_hash supports raw-bytes (base64) mode for binary artifacts", async () => {
    const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const expected =
      "sha256:" +
      require("node:crypto").createHash("sha256").update(bytes).digest("hex");
    const doc = { ...NO_AI_DISCLOSURE, artifact_hash: expected };
    const out = JSON.parse(
      await handlers.disclosure_verify_artifact_hash!({
        document_json: JSON.stringify(doc),
        candidate_bytes_base64: bytes.toString("base64"),
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.mode).toBe("raw_bytes");
  });

  it("verify_prompt_hash matches when candidate text recomputes to stored prompt hash", async () => {
    const out = JSON.parse(
      await handlers.disclosure_verify_prompt_hash!({
        document_json: JSON.stringify(HASHED_PROMPT_DISCLOSURE),
        prompt_id: "p1",
        candidate_text: "Please fix grammar in this paragraph: ...",
      }),
    );
    expect(out.ok).toBe(true);
  });

  it("verify_prompt_hash errors when disclosure is not in hashed mode", async () => {
    const out = JSON.parse(
      await handlers.disclosure_verify_prompt_hash!({
        document_json: JSON.stringify(FULL_PROMPT_DISCLOSURE),
        prompt_id: "p1",
        candidate_text: "anything",
      }),
    );
    expect(out.error).toBe("wrong_prompt_mode");
  });

  it("verify_prompt_hash errors when prompt_id is unknown", async () => {
    const out = JSON.parse(
      await handlers.disclosure_verify_prompt_hash!({
        document_json: JSON.stringify(HASHED_PROMPT_DISCLOSURE),
        prompt_id: "p-unknown",
        candidate_text: "anything",
      }),
    );
    expect(out.error).toBe("prompt_not_found");
    expect(out.available_ids).toEqual(["p1"]);
  });

  it("aup_check reports declared_compliant when aup_uri + policy_compliant.declared=true", async () => {
    const doc = {
      ...NO_AI_DISCLOSURE,
      aup_uri: "https://example.edu/.well-known/ai-aup.json",
      policy_compliant: { declared: true },
    };
    const out = JSON.parse(
      await handlers.disclosure_aup_check!({ document_json: JSON.stringify(doc) }),
    );
    expect(out.status).toBe("declared_compliant");
  });

  it("aup_check reports no_aup_reference when aup_uri is absent", async () => {
    const out = JSON.parse(
      await handlers.disclosure_aup_check!({
        document_json: JSON.stringify(NO_AI_DISCLOSURE),
      }),
    );
    expect(out.status).toBe("no_aup_reference");
  });
});

// ----------------------------------------------------------------------------
// Classroom AI AUP (EdTech extension — closes the trio)
// ----------------------------------------------------------------------------
const STRICT_K12_AUP = {
  aup_version: "0.1",
  policy_id: "test-district-aup",
  policy_name: "Test District AUP",
  version: "1.0.0",
  effective_at: "2020-01-01T00:00:00Z",
  scope: { type: "district", institution_id: "test-district" },
  permitted_use: {
    permitted_roles: ["edit", "cite_check", "translate"],
    assistance_extent_max: "minor",
  },
  prohibited_use: { prohibited_roles: ["draft", "image_generation"] },
  disclosure_requirements: {
    required_when: "when_used",
    required_prompt_evidence_mode: "hashed",
    signature_required: true,
    teacher_acknowledgment_required: true,
    artifact_hash_required: true,
  },
  published_by: { name: "Test District" },
  published_at: "2020-01-01T00:00:00Z",
};

const PROCTORED_NO_AI_AUP = {
  aup_version: "0.1",
  policy_id: "test-proctored-aup",
  policy_name: "Proctored Exam AUP",
  version: "1.0.0",
  effective_at: "2020-01-01T00:00:00Z",
  scope: { type: "assignment", institution_id: "test", assignment_ids: ["midterm-1"] },
  permitted_use: { permitted_roles: [], assistance_extent_max: "none" },
  disclosure_requirements: {
    required_when: "always",
    signature_required: true,
    artifact_hash_required: true,
  },
  published_by: { name: "Test Instructor" },
  published_at: "2020-01-01T00:00:00Z",
};

const COMPLIANT_DISCLOSURE_FOR_K12 = {
  ...HASHED_PROMPT_DISCLOSURE,
  teacher_acknowledged: {
    acknowledged: true,
    by: "teacher-x",
    at: "2026-05-13T08:15:00Z",
  },
};

describe("Classroom AI AUP", () => {
  it("validate accepts a well-formed district AUP", async () => {
    const out = JSON.parse(
      await handlers.aup_validate!({ document_json: JSON.stringify(STRICT_K12_AUP) }),
    );
    expect(out.valid).toBe(true);
    expect(out.policy_id).toBe("test-district-aup");
    expect(out.scope_type).toBe("district");
    expect(out.assistance_extent_max).toBe("minor");
  });

  it("validate rejects assistance_extent_max=none with non-empty permitted_roles", async () => {
    const bad = {
      ...PROCTORED_NO_AI_AUP,
      permitted_use: { permitted_roles: ["edit"], assistance_extent_max: "none" },
    };
    const out = JSON.parse(
      await handlers.aup_validate!({ document_json: JSON.stringify(bad) }),
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/forbids any permitted_roles/);
  });

  it("validate rejects course scope without course_ids", async () => {
    const bad = {
      ...STRICT_K12_AUP,
      scope: { type: "course", institution_id: "test" },
    };
    const out = JSON.parse(
      await handlers.aup_validate!({ document_json: JSON.stringify(bad) }),
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/course_ids/);
  });

  it("validate rejects role disjointness violation", async () => {
    const bad = {
      ...STRICT_K12_AUP,
      prohibited_use: { prohibited_roles: ["edit"] },
    };
    const out = JSON.parse(
      await handlers.aup_validate!({ document_json: JSON.stringify(bad) }),
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/both permitted and prohibited/);
  });

  it("well_known_url returns canonical /.well-known/ai-aup.json", async () => {
    const out = JSON.parse(
      await handlers.aup_well_known_url!({ origin: "https://example.edu" }),
    );
    expect(out.url).toBe("https://example.edu/.well-known/ai-aup.json");
  });

  it("inspect returns scope, permitted-role count, and vendor posture", async () => {
    const out = JSON.parse(
      await handlers.aup_inspect!({ document_json: JSON.stringify(STRICT_K12_AUP) }),
    );
    expect(out.scope.type).toBe("district");
    expect(out.permitted_use.role_count).toBe(3);
    expect(out.disclosure_requirements.required_when).toBe("when_used");
  });

  it("check_compliance allows a fully compliant disclosure", async () => {
    const out = JSON.parse(
      await handlers.aup_check_compliance!({
        aup_json: JSON.stringify(STRICT_K12_AUP),
        disclosure_json: JSON.stringify(COMPLIANT_DISCLOSURE_FOR_K12),
      }),
    );
    expect(out.allowed).toBe(true);
    expect(out.violations).toEqual([]);
  });

  it("check_compliance flags missing teacher acknowledgment", async () => {
    const out = JSON.parse(
      await handlers.aup_check_compliance!({
        aup_json: JSON.stringify(STRICT_K12_AUP),
        disclosure_json: JSON.stringify(HASHED_PROMPT_DISCLOSURE),
      }),
    );
    expect(out.allowed).toBe(false);
    expect(out.violations.some((v: { code: string }) => v.code === "teacher_acknowledgment_missing")).toBe(true);
  });

  it("check_compliance flags wrong prompt evidence mode", async () => {
    const out = JSON.parse(
      await handlers.aup_check_compliance!({
        aup_json: JSON.stringify(STRICT_K12_AUP),
        disclosure_json: JSON.stringify(FULL_PROMPT_DISCLOSURE),
      }),
    );
    expect(out.allowed).toBe(false);
    expect(
      out.violations.some((v: { code: string }) => v.code === "wrong_prompt_evidence_mode"),
    ).toBe(true);
  });

  it("check_compliance flags disallowed role (draft) used under K-12 AUP", async () => {
    const bad = {
      ...COMPLIANT_DISCLOSURE_FOR_K12,
      roles: ["draft"],
      assistance_extent: "substantial",
    };
    const out = JSON.parse(
      await handlers.aup_check_compliance!({
        aup_json: JSON.stringify(STRICT_K12_AUP),
        disclosure_json: JSON.stringify(bad),
      }),
    );
    expect(out.allowed).toBe(false);
    const codes = out.violations.map((v: { code: string }) => v.code);
    expect(codes).toContain("roles_not_permitted");
    expect(codes).toContain("roles_prohibited");
    expect(codes).toContain("assistance_extent_exceeded");
  });

  it("check_compliance flags any AI use under a no-AI proctored AUP", async () => {
    const out = JSON.parse(
      await handlers.aup_check_compliance!({
        aup_json: JSON.stringify(PROCTORED_NO_AI_AUP),
        disclosure_json: JSON.stringify(HASHED_PROMPT_DISCLOSURE),
      }),
    );
    expect(out.allowed).toBe(false);
    expect(out.violations.some((v: { code: string }) => v.code === "no_ai_permitted")).toBe(true);
  });

  it("check_compliance allows a no-AI disclosure under a proctored AUP", async () => {
    const noAi = {
      ...NO_AI_DISCLOSURE,
      teacher_acknowledged: { acknowledged: true, by: "teacher-x", at: "2026-03-11T08:00:00Z" },
    };
    const out = JSON.parse(
      await handlers.aup_check_compliance!({
        aup_json: JSON.stringify({
          ...PROCTORED_NO_AI_AUP,
          disclosure_requirements: {
            ...PROCTORED_NO_AI_AUP.disclosure_requirements,
            teacher_acknowledgment_required: true,
          },
        }),
        disclosure_json: JSON.stringify(noAi),
      }),
    );
    expect(out.allowed).toBe(true);
  });

  it("check_compliance returns disclosure_invalid for malformed disclosure JSON", async () => {
    const out = JSON.parse(
      await handlers.aup_check_compliance!({
        aup_json: JSON.stringify(STRICT_K12_AUP),
        disclosure_json: JSON.stringify({ disclosure_version: "0.1" }),
      }),
    );
    expect(out.error).toBe("disclosure_invalid");
  });
});

// ----------------------------------------------------------------------------
// Clinical AI Disclosure (HealthTech extension)
// ----------------------------------------------------------------------------
const SEPSIS_CARD = {
  clinical_ai_card_version: "0.1",
  system: {
    id: "kineticgain-sepsis-ews",
    name: "Kinetic Gain Sepsis EWS",
    version: "2.3.1",
    provider: "Kinetic Gain Health",
    description: "Continuous sepsis EWS.",
  },
  clinical_context: {
    indication: "Early detection of adult inpatient sepsis.",
    care_settings: ["inpatient", "icu"],
    patient_population: { age_range_min: 18, age_range_max: 89 },
    intended_use: "CDS for adult inpatient providers.",
    off_label_uses_prohibited: true,
  },
  regulatory: {
    fda_status: "510k_cleared",
    fda_clearance_number: "K233456",
    fda_clearance_uri: "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=K233456",
    is_medical_device: true,
    is_clinical_decision_support: true,
    is_software_as_medical_device: true,
    samd_class: "II",
    samd_classification_rationale: "Serious situation, drive clinical management.",
  },
  clinical_role: {
    decision_support_level: "advisory",
    clinician_override_required: true,
    patient_facing_only: false,
    transparency_to_patient_required: true,
  },
  evidence: {
    validation_studies: [
      { title: "Multi-site validation", uri: "https://x/study.pdf", population_size: 48217,
        primary_outcome: "Sepsis detection ≥6h before MEWS",
        results_summary: "Sens 0.84, Spec 0.78, AUC 0.89", peer_reviewed: true },
    ],
    training_data_sources: ["MIMIC-IV", "Internal N=287k"],
    bias_audit_uri: "https://x/bias-audit.pdf",
    performance_metrics: { measurement_population: "Adult inpatient", sensitivity: 0.84, specificity: 0.78, auc: 0.89 },
  },
  patient_data: {
    phi_processed: true, hipaa_compliant: true, baa_required: true,
    retention_days: 365, patient_consent_required: false, third_party_data_sharing: false,
  },
  safety: {
    human_in_loop_required_for: ["pediatric-routed"],
    mandatory_reporting_categories: ["adverse-drug-event"],
  },
  ehr_integration: { fhir_version: "R4", supports_smart_on_fhir: true },
};

describe("Clinical AI Disclosure", () => {
  it("validate accepts a 510(k)-cleared SaMD class II card", async () => {
    const out = JSON.parse(await handlers.clinical_ai_validate!({ document_json: JSON.stringify(SEPSIS_CARD) }));
    expect(out.valid).toBe(true);
    expect(out.system_id).toBe("kineticgain-sepsis-ews");
    expect(out.fda_status).toBe("510k_cleared");
    expect(out.samd_class).toBe("II");
    expect(out.bias_audited).toBe(true);
  });

  it("validate rejects autonomous decision support without is_medical_device", async () => {
    const bad = JSON.parse(JSON.stringify(SEPSIS_CARD));
    bad.clinical_role.decision_support_level = "autonomous";
    bad.regulatory.is_medical_device = false;
    const out = JSON.parse(await handlers.clinical_ai_validate!({ document_json: JSON.stringify(bad) }));
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/autonomous.*is_medical_device/i);
  });

  it("validate rejects SaMD class II+ without bias_audit_uri", async () => {
    const bad = JSON.parse(JSON.stringify(SEPSIS_CARD));
    delete bad.evidence.bias_audit_uri;
    const out = JSON.parse(await handlers.clinical_ai_validate!({ document_json: JSON.stringify(bad) }));
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/bias_audit_uri/);
  });

  it("validate rejects 510k-cleared without clearance number", async () => {
    const bad = JSON.parse(JSON.stringify(SEPSIS_CARD));
    delete bad.regulatory.fda_clearance_number;
    const out = JSON.parse(await handlers.clinical_ai_validate!({ document_json: JSON.stringify(bad) }));
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/fda_clearance_number/);
  });

  it("well_known_url computes canonical path", async () => {
    const out = JSON.parse(await handlers.clinical_ai_well_known_url!({
      origin: "https://health.kineticgain.com",
      system_id: "kineticgain-sepsis-ews",
    }));
    expect(out.url).toBe("https://health.kineticgain.com/.well-known/clinical-ai/kineticgain-sepsis-ews.json");
  });

  it("inspect returns clinical-context + evidence summary", async () => {
    const out = JSON.parse(await handlers.clinical_ai_inspect!({ document_json: JSON.stringify(SEPSIS_CARD) }));
    expect(out.regulatory.fda_status).toBe("510k_cleared");
    expect(out.clinical_role.decision_support_level).toBe("advisory");
    expect(out.evidence.validation_study_count).toBe(1);
    expect(out.evidence.bias_audit_uri).toBeTruthy();
    expect(out.patient_data.phi_processed).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// AI Incident Card (cross-cutting)
// ----------------------------------------------------------------------------
const MR_INCIDENT = {
  incident_card_version: "0.1",
  incident: {
    id: "INC-2026-04-22-kineticgain-001",
    title: "K-12 tutor failed to escalate self-harm disclosure",
    severity: "critical",
    categories: ["mandated_reporter_failure"],
    discovered_at: "2026-04-22T14:30:00Z",
    disclosed_at: "2026-04-23T09:00:00Z",
    resolved_at: "2026-04-25T16:00:00Z",
    status: "resolved",
  },
  affected: {
    vendor: "Kinetic Gain Edu",
    products: ["K-12 Math Tutor"],
    versions: ["1.4.0"],
    tutor_card_uris: ["https://edu.kineticgain.com/.well-known/tutors/k12-math-tutor.json"],
  },
  summary: "Tutor failed to escalate self-harm disclosure embedded in a word problem.",
  root_cause: { category: "refusal_taxonomy_gap", description: "Classifier short-circuited on math classification." },
  harm: { severity_justification: "K-12 mandated-reporter failure.", manifested: true },
  mitigation: {
    actions_taken: ["Added parallel classifier.", "Added regression corpus."],
    permanent_fix: true,
    rollout_status: "deployed",
  },
  regulatory: {
    reported_to: ["ferpa"],
    reporting_deadline_met: true,
    regulatory_filing_uris: ["https://edu.kineticgain.com/regulatory/ferpa.pdf"],
  },
  published_by: { name: "Kinetic Gain Edu", role: "vendor" },
  published_at: "2026-04-23T09:00:00Z",
  last_updated_at: "2026-04-26T16:30:00Z",
};

describe("AI Incident Card", () => {
  it("validate accepts a critical-severity mandated-reporter incident", async () => {
    const out = JSON.parse(await handlers.incident_validate!({ document_json: JSON.stringify(MR_INCIDENT) }));
    expect(out.valid).toBe(true);
    expect(out.severity).toBe("critical");
    expect(out.status).toBe("resolved");
    expect(out.permanent_fix).toBe(true);
  });

  it("validate rejects status=resolved without resolved_at", async () => {
    const bad = JSON.parse(JSON.stringify(MR_INCIDENT));
    delete bad.incident.resolved_at;
    const out = JSON.parse(await handlers.incident_validate!({ document_json: JSON.stringify(bad) }));
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/resolved_at/);
  });

  it("validate rejects regulatory.reported_to without filing URIs", async () => {
    const bad = JSON.parse(JSON.stringify(MR_INCIDENT));
    delete bad.regulatory.regulatory_filing_uris;
    const out = JSON.parse(await handlers.incident_validate!({ document_json: JSON.stringify(bad) }));
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/regulatory_filing_uris/);
  });

  it("validate rejects status=withdrawn without withdrawal block", async () => {
    const bad = JSON.parse(JSON.stringify(MR_INCIDENT));
    bad.incident.status = "withdrawn";
    delete bad.incident.resolved_at;
    const out = JSON.parse(await handlers.incident_validate!({ document_json: JSON.stringify(bad) }));
    expect(out.valid).toBe(false);
    expect(out.reason).toMatch(/withdrawal/i);
  });

  it("well_known_url computes canonical path", async () => {
    const out = JSON.parse(await handlers.incident_well_known_url!({
      origin: "https://edu.kineticgain.com",
      incident_id: "INC-2026-04-22-kineticgain-001",
    }));
    expect(out.url).toBe("https://edu.kineticgain.com/.well-known/ai-incidents/INC-2026-04-22-kineticgain-001.json");
  });

  it("inspect returns affected vendor + categories + cross-spec ref counts", async () => {
    const out = JSON.parse(await handlers.incident_inspect!({ document_json: JSON.stringify(MR_INCIDENT) }));
    expect(out.affected.vendor).toBe("Kinetic Gain Edu");
    expect(out.affected.tutor_card_count).toBe(1);
    expect(out.affected.agent_card_count).toBe(0);
    expect(out.incident.severity).toBe("critical");
  });

  it("index_fetch summary correctly parses an index served as an HTTP response", async () => {
    // Spin up a tiny local server that returns a synthetic index.
    const { createServer } = await import("node:http");
    const indexJson = JSON.stringify([
      { id: "INC-A", severity: "critical", status: "resolved", disclosed_at: "2026-04-23T09:00:00Z" },
      { id: "INC-B", severity: "high",     status: "mitigated", disclosed_at: "2026-04-15T12:00:00Z" },
      { id: "INC-C", severity: "critical", status: "active",    disclosed_at: "2026-05-01T08:00:00Z" },
    ]);
    const server = createServer((req, res) => {
      if (req.url === "/.well-known/ai-incidents.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(indexJson);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    try {
      const out = JSON.parse(await handlers.incident_index_fetch!({ origin: `http://127.0.0.1:${port}` }));
      expect(out.total).toBe(3);
      expect(out.by_severity.critical).toBe(2);
      expect(out.by_severity.high).toBe(1);
      expect(out.by_status.resolved).toBe(1);
      expect(out.by_status.active).toBe(1);
      // Sorted descending by disclosed_at — newest first
      expect(out.incidents_sorted_by_disclosed_at_desc[0].id).toBe("INC-C");
      expect(out.incidents_sorted_by_disclosed_at_desc[2].id).toBe("INC-B");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// ----------------------------------------------------------------------------
// AI Procurement Decision Card (spec #11 — buyer-side)
// ----------------------------------------------------------------------------
const DECISION_CARD = {
  decision_card_version: "0.1",
  decision_id: "TEST-DEC-001",
  issued_at: "2026-05-14T19:00:00Z",
  buyer: {
    name: "Test District",
    type: "school-district",
    jurisdiction: "US-CA",
  },
  decision: {
    status: "approved-with-conditions",
    scope: "K-12 classroom use",
  },
  subject: {
    vendor_name: "AcmeTutor Inc.",
    product_name: "AcmeTutor 3.0",
    documents_reviewed: [
      { type: "tutor-card", url: "https://acmetutor.example/.well-known/tutor-card.json" },
    ],
  },
  conditions: [
    { id: "no-training", description: "Must not train on student data.", enforcement: "contractual" },
  ],
  rationale: "Approved with one condition.",
};

describe("AI Procurement Decision Card", () => {
  it("well-known URL is /.well-known/decisions/<decision_id>.json", async () => {
    const out = JSON.parse(await handlers.decision_card_well_known_url!({
      origin: "https://springfield.edu",
      decision_id: "SPRINGFIELD-DEC-2026-001",
    }));
    expect(out.url).toBe("https://springfield.edu/.well-known/decisions/SPRINGFIELD-DEC-2026-001.json");
  });

  it("URL-encodes special characters in decision_id", async () => {
    const out = JSON.parse(await handlers.decision_card_well_known_url!({
      origin: "https://example.com",
      decision_id: "DEC#with/slashes",
    }));
    expect(out.url).toBe("https://example.com/.well-known/decisions/DEC%23with%2Fslashes.json");
  });

  it("strips trailing slash from origin", async () => {
    const out = JSON.parse(await handlers.decision_card_well_known_url!({
      origin: "https://example.com//",
      decision_id: "X",
    }));
    expect(out.url).toBe("https://example.com/.well-known/decisions/X.json");
  });

  it("validates a happy-path approved-with-conditions card", async () => {
    const out = JSON.parse(await handlers.decision_card_validate!({
      document_json: JSON.stringify(DECISION_CARD),
    }));
    expect(out.valid).toBe(true);
    expect(out.decision_id).toBe("TEST-DEC-001");
    expect(out.status).toBe("approved-with-conditions");
    expect(out.buyer).toBe("Test District");
    expect(out.vendor).toBe("AcmeTutor Inc.");
    expect(out.has_conditions).toBe(true);
    expect(out.condition_count).toBe(1);
  });

  it("rejects approved-with-conditions WITHOUT a conditions array", async () => {
    const bad = { ...DECISION_CARD, conditions: [] };
    const out = JSON.parse(await handlers.decision_card_validate!({
      document_json: JSON.stringify(bad),
    }));
    expect(out.valid).toBe(false);
    expect(out.reason).toContain("conditions");
  });

  it("rejects rejected-with-remediation WITHOUT a conditions array", async () => {
    const bad = {
      ...DECISION_CARD,
      decision: { status: "rejected-with-remediation" },
      conditions: undefined,
    };
    delete (bad as { conditions?: unknown }).conditions;
    const out = JSON.parse(await handlers.decision_card_validate!({
      document_json: JSON.stringify(bad),
    }));
    expect(out.valid).toBe(false);
    expect(out.reason).toContain("conditions");
  });

  it("rejects withdrawn status without a withdrawal block", async () => {
    const bad = { ...DECISION_CARD, decision: { status: "withdrawn" }, conditions: undefined };
    delete (bad as { conditions?: unknown }).conditions;
    const out = JSON.parse(await handlers.decision_card_validate!({
      document_json: JSON.stringify(bad),
    }));
    expect(out.valid).toBe(false);
    expect(out.reason).toContain("withdrawal");
  });

  it("accepts withdrawn status when withdrawal block is present", async () => {
    const good = {
      ...DECISION_CARD,
      decision: { status: "withdrawn" },
      conditions: undefined,
      withdrawal: { at: "2026-06-01T00:00:00Z", reason: "Vendor exited the market." },
    };
    delete (good as { conditions?: unknown }).conditions;
    const out = JSON.parse(await handlers.decision_card_validate!({
      document_json: JSON.stringify(good),
    }));
    expect(out.valid).toBe(true);
    expect(out.status).toBe("withdrawn");
  });

  it("rejects publication.is_public=true without a publication_uri", async () => {
    const bad = {
      ...DECISION_CARD,
      publication: { is_public: true },
    };
    const out = JSON.parse(await handlers.decision_card_validate!({
      document_json: JSON.stringify(bad),
    }));
    expect(out.valid).toBe(false);
    expect(out.reason).toContain("publication_uri");
  });

  it("inspects produce a procurement-grade summary including rubric counts", async () => {
    const cardWithRubric = {
      ...DECISION_CARD,
      criteria: {
        rubric: [
          { id: "a", result: "pass" },
          { id: "b", result: "partial" },
          { id: "c", result: "fail" },
          { id: "d", result: "pass" },
        ],
      },
    };
    const out = JSON.parse(await handlers.decision_card_inspect!({
      document_json: JSON.stringify(cardWithRubric),
    }));
    expect(out.decision_id).toBe("TEST-DEC-001");
    expect(out.decision.status).toBe("approved-with-conditions");
    expect(out.subject.vendor).toBe("AcmeTutor Inc.");
    expect(out.subject.documents_reviewed_count).toBe(1);
    expect(out.subject.reviewed_document_types).toEqual(["tutor-card"]);
    expect(out.rubric_summary.total_criteria).toBe(4);
    expect(out.rubric_summary.pass).toBe(2);
    expect(out.rubric_summary.partial).toBe(1);
    expect(out.rubric_summary.fail).toBe(1);
    expect(out.conditions_count).toBe(1);
    expect(out.withdrawn).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// Cross-cutting
// ----------------------------------------------------------------------------
describe("Unknown tool", () => {
  it("server exposes exactly the 75 declared tools (12 specs + 5 cross-cutting ops + 3 live audit-stream tools + 8 DefenseTech + 4 claims-card, v0.9.0)", () => {
    expect(Object.keys(handlers)).toHaveLength(75);
  });
});

// ----------------------------------------------------------------------------
// CLI mode (v0.5.1)
// ----------------------------------------------------------------------------
describe("CLI dispatch", () => {
  it("returns handled=false when no subcommand is given (falls through to MCP server)", async () => {
    const out = await dispatchCli(["node", "server.js"]);
    expect(out.handled).toBe(false);
  });

  it("handles --version and exits 0", async () => {
    const out = await dispatchCli(["node", "server.js", "--version"]);
    expect(out.handled).toBe(true);
    expect(out.exitCode).toBe(0);
  });

  it("handles --help and exits 0", async () => {
    const out = await dispatchCli(["node", "server.js", "--help"]);
    expect(out.handled).toBe(true);
    expect(out.exitCode).toBe(0);
  });

  it("rejects unknown flags with exit code 3", async () => {
    const out = await dispatchCli(["node", "server.js", "--bogus"]);
    expect(out.handled).toBe(true);
    expect(out.exitCode).toBe(3);
  });

  it("exposes the package version", () => {
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("CLI validate command", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "kg-cli-test-"));
    // Valid AEO doc (mirrors the AEO_DOC fixture above)
    await writeFile(join(workDir, "valid-aeo.json"), JSON.stringify(AEO_DOC));
    // Invalid AEO doc — entity is a string instead of an object
    await writeFile(
      join(workDir, "invalid-aeo.json"),
      JSON.stringify({ aeo_version: "0.1", entity: "should be an object" }),
    );
    // Document with no recognized version field
    await writeFile(
      join(workDir, "unrecognized.json"),
      JSON.stringify({ hello: "world" }),
    );
    // Document that fails JSON parsing
    await writeFile(join(workDir, "broken.json"), "{ not valid json");
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("validates a passing document and exits 0", async () => {
    const code = await runValidate([join(workDir, "valid-aeo.json")]);
    expect(code).toBe(0);
  });

  it("fails the run when a document violates its schema (exit 1)", async () => {
    const code = await runValidate([join(workDir, "invalid-aeo.json")]);
    expect(code).toBe(1);
  });

  it("fails the run on unparseable JSON (exit 1)", async () => {
    const code = await runValidate([join(workDir, "broken.json")]);
    expect(code).toBe(1);
  });

  it("returns exit 2 when no input has a recognized version field", async () => {
    const code = await runValidate([join(workDir, "unrecognized.json")]);
    expect(code).toBe(2);
  });

  it("returns exit 3 when called with no paths", async () => {
    const code = await runValidate([]);
    expect(code).toBe(3);
  });

  it("returns exit 0 (no files matched) when given a non-matching glob", async () => {
    const code = await runValidate([join(workDir, "no-such-pattern-*.xyz")]);
    expect(code).toBe(0);
  });

  it("aggregates: one failing file in a mixed batch makes the run fail", async () => {
    const code = await runValidate([
      join(workDir, "valid-aeo.json"),
      join(workDir, "invalid-aeo.json"),
    ]);
    expect(code).toBe(1);
  });
});

// ============================================================================
// v0.6.0 — Decision Intelligence preview tools
// ============================================================================

describe("v0.6.0: decision_card_infer_status", () => {
  it("returns 'approved' when every result is pass", async () => {
    const out = JSON.parse(
      await handlers.decision_card_infer_status({
        rubric: [
          { id: "a", result: "pass" },
          { id: "b", result: "pass" },
        ],
      }),
    );
    expect(out.status).toBe("approved");
  });

  it("returns 'rejected-with-remediation' when any result is fail", async () => {
    const out = JSON.parse(
      await handlers.decision_card_infer_status({
        rubric: [
          { id: "a", result: "pass" },
          { id: "b", result: "fail" },
          { id: "c", result: "partial" },
        ],
      }),
    );
    expect(out.status).toBe("rejected-with-remediation");
  });

  it("returns 'approved-with-conditions' on partial", async () => {
    const out = JSON.parse(
      await handlers.decision_card_infer_status({
        rubric: [
          { id: "a", result: "pass" },
          { id: "b", result: "partial" },
        ],
      }),
    );
    expect(out.status).toBe("approved-with-conditions");
  });

  it("returns 'pending' for empty rubric", async () => {
    const out = JSON.parse(await handlers.decision_card_infer_status({ rubric: [] }));
    expect(out.status).toBe("pending");
  });

  it("returns 'pending' when every result is n/a", async () => {
    const out = JSON.parse(
      await handlers.decision_card_infer_status({
        rubric: [
          { id: "a", result: "n/a" },
          { id: "b", result: "n/a" },
        ],
      }),
    );
    expect(out.status).toBe("pending");
  });
});

const VALID_DECISION_CARD = {
  decision_card_version: "0.1",
  decision_id: "TEST-DEC-001",
  issued_at: "2026-05-15T00:00:00Z",
  buyer: { name: "Springfield USD", type: "school-district" },
  decision: { status: "approved" },
  subject: { vendor_name: "AcmeTutor" },
  rationale: "Looks fine.",
};

describe("v0.6.0: decision_card_to_policy_bundle", () => {
  it("approved card -> single allow-all policy", async () => {
    const out = JSON.parse(
      await handlers.decision_card_to_policy_bundle({
        document_json: JSON.stringify(VALID_DECISION_CARD),
      }),
    );
    expect(out.policies).toHaveLength(1);
    expect(out.policies[0].default_effect).toBe("allow");
  });

  it("rejected card -> single deny-all policy", async () => {
    const card = { ...VALID_DECISION_CARD, decision: { status: "rejected" } };
    const out = JSON.parse(
      await handlers.decision_card_to_policy_bundle({ document_json: JSON.stringify(card) }),
    );
    expect(out.policies[0].default_effect).toBe("deny");
  });

  it("approved-with-conditions emits one policy per condition", async () => {
    const card = {
      ...VALID_DECISION_CARD,
      decision: { status: "approved-with-conditions" },
      conditions: [
        { id: "dpa-signed", description: "DPA must be on file" },
        { id: "bias-audit", description: "Bias audit refreshed" },
      ],
    };
    const out = JSON.parse(
      await handlers.decision_card_to_policy_bundle({ document_json: JSON.stringify(card) }),
    );
    expect(out.policies).toHaveLength(2);
    expect(out.policies[0].default_effect).toBe("deny");
    expect(out.policies[0].rules[0].when_field).toBe("conditions_satisfied.dpa-signed");
  });
});

describe("v0.6.0: decision_card_signature_check", () => {
  it("reports no signature when signatures[] is absent", async () => {
    const out = JSON.parse(
      await handlers.decision_card_signature_check({
        document_json: JSON.stringify(VALID_DECISION_CARD),
      }),
    );
    expect(out.has_signature).toBe(false);
  });

  it("reports each signer with their method + key + timestamp", async () => {
    const card = {
      ...VALID_DECISION_CARD,
      signatures: [
        {
          signer: "AVL Board",
          signed_at: "2026-05-15T01:00:00Z",
          method: "cryptographic",
          key_uri: "https://buyer.example/keys/avl",
        },
      ],
    };
    const out = JSON.parse(
      await handlers.decision_card_signature_check({ document_json: JSON.stringify(card) }),
    );
    expect(out.has_signature).toBe(true);
    expect(out.signers[0].signer).toBe("AVL Board");
    expect(out.signers[0].method).toBe("cryptographic");
    expect(out.expected_canonical_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

// ============================================================================
// v0.6.0 — Incident remediation
// ============================================================================

const VALID_INCIDENT_CARD = {
  incident_card_version: "0.1",
  incident: {
    id: "INC-2026-05-15-001",
    title: "lookup_homework returned PII under prompt injection",
    severity: "high",
    categories: ["pii_leak", "prompt_injection_success"],
    discovered_at: "2026-05-15T03:00:00Z",
    disclosed_at: "2026-05-15T04:00:00Z",
    status: "active",
  },
  published_by: {
    name: "AcmeTutor Inc.",
    role: "vendor",
    contact_uri: "mailto:security@acmetutor.example",
  },
  published_at: "2026-05-15T04:30:00Z",
  last_updated_at: "2026-05-15T04:30:00Z",
  affected: {
    vendor: "AcmeTutor Inc.",
    products: ["AcmeTutor 3.0"],
    tool_card_uris: ["https://acmetutor.example/.well-known/mcp-tools/lookup_homework.json"],
    agent_card_uris: ["https://acmetutor.example/.well-known/agents/tutor.json"],
  },
  summary: "Crafted prompt extracted student PII",
  root_cause: {
    category: "prompt_injection",
    description: "Tool call did not sanitize student records before return.",
  },
  harm: { severity_justification: "Student PII leaked", manifested: true },
  mitigation: {
    actions_taken: ["disabled tool", "rotated keys"],
    permanent_fix: false,
    rollout_status: "in_progress",
  },
};

describe("v0.6.0: incident_affected_walk", () => {
  it("returns one entry per affected URI plus vendor + product synth", async () => {
    const out = JSON.parse(
      await handlers.incident_affected_walk({
        document_json: JSON.stringify(VALID_INCIDENT_CARD),
      }),
    );
    expect(out.affected.length).toBe(4); // vendor + product + 1 tool + 1 agent
    expect(out.counts_by_kind.vendor).toBe(1);
    expect(out.counts_by_kind.product).toBe(1);
    expect(out.counts_by_kind["tool-card"]).toBe(1);
    expect(out.counts_by_kind["agent-card"]).toBe(1);
  });
});

describe("v0.6.0: incident_remediation_plan", () => {
  it("maps vendor + product to request_review, cards to revalidate", async () => {
    const out = JSON.parse(
      await handlers.incident_remediation_plan({
        document_json: JSON.stringify(VALID_INCIDENT_CARD),
      }),
    );
    expect(out.steps.length).toBe(4);
    const byAction: Record<string, number> = {};
    for (const step of out.steps) {
      byAction[step.action] = (byAction[step.action] ?? 0) + 1;
    }
    expect(byAction.request_review).toBe(2);
    expect(byAction.revalidate).toBe(2);
  });

  it("urgency matches incident severity", async () => {
    const out = JSON.parse(
      await handlers.incident_remediation_plan({
        document_json: JSON.stringify(VALID_INCIDENT_CARD),
      }),
    );
    expect(out.steps[0].urgency).toBe("high");
  });

  it("critical severity bumps every step to critical", async () => {
    const card = {
      ...VALID_INCIDENT_CARD,
      incident: { ...VALID_INCIDENT_CARD.incident, severity: "critical" },
    };
    const out = JSON.parse(
      await handlers.incident_remediation_plan({ document_json: JSON.stringify(card) }),
    );
    for (const step of out.steps) {
      expect(step.urgency).toBe("critical");
    }
  });
});

// ============================================================================
// v0.6.0 — Hash attestation
// ============================================================================

describe("v0.6.0: attestation_canonical_hash", () => {
  it("hashes identical JSON values to the same digest regardless of key order", async () => {
    const a = JSON.parse(
      await handlers.attestation_canonical_hash({ body: { foo: 1, bar: "x" } }),
    );
    const b = JSON.parse(
      await handlers.attestation_canonical_hash({ body: { bar: "x", foo: 1 } }),
    );
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("different inputs hash differently", async () => {
    const a = JSON.parse(
      await handlers.attestation_canonical_hash({ body: { foo: 1 } }),
    );
    const b = JSON.parse(
      await handlers.attestation_canonical_hash({ body: { foo: 2 } }),
    );
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("v0.6.0: attestation_inspect + attestation_verify", () => {
  it("inspect validates the envelope shape", async () => {
    const out = JSON.parse(
      await handlers.attestation_inspect({
        attestation: {
          algorithm: "ed25519",
          signed_hash: "sha256:" + "0".repeat(64),
          signature: Buffer.alloc(64).toString("base64"),
          key_url: "https://acme.example/keys/aeo",
          signed_at: "2026-05-15T00:00:00Z",
        },
      }),
    );
    expect(out.valid_envelope).toBe(true);
    expect(out.algorithm).toBe("ed25519");
    expect(out.signature_length_bytes).toBe(64);
  });

  it("verify rejects bad algorithm immediately", async () => {
    const out = JSON.parse(
      await handlers.attestation_verify({
        attestation: {
          algorithm: "rsa-sha256",
          signed_hash: "sha256:00",
          signature: "AAAA",
          key_url: "https://x/",
          signed_at: "2026-05-15T00:00:00Z",
        },
        body: { foo: 1 },
        public_key: "0".repeat(64),
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/unsupported algorithm/);
  });

  it("verify rejects hash mismatch before touching the signature", async () => {
    const body = { foo: 1 };
    const out = JSON.parse(
      await handlers.attestation_verify({
        attestation: {
          algorithm: "ed25519",
          signed_hash: "sha256:" + "f".repeat(64),
          signature: Buffer.alloc(64).toString("base64"),
          key_url: "https://x/",
          signed_at: "2026-05-15T00:00:00Z",
        },
        body,
        public_key: "0".repeat(64),
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("hash_mismatch");
  });

  it("verify ok=true for a real ed25519 signature it generates itself", async () => {
    const { getPublicKeyAsync, signAsync } = await import("@noble/ed25519");
    const privateKey = new Uint8Array(32).map((_, i) => (i + 1) % 256);
    const publicKey = await getPublicKeyAsync(privateKey);

    const body = { aeo_version: "0.1", entity: { id: "x", name: "Acme" } };
    const hashOut = JSON.parse(
      await handlers.attestation_canonical_hash({ body }),
    );
    const signedHash: string = hashOut.hash;
    const sig = await signAsync(new TextEncoder().encode(signedHash), privateKey);

    const out = JSON.parse(
      await handlers.attestation_verify({
        attestation: {
          algorithm: "ed25519",
          signed_hash: signedHash,
          signature: Buffer.from(sig).toString("base64"),
          key_url: "https://x/",
          signed_at: "2026-05-15T00:00:00Z",
        },
        body,
        public_key: Buffer.from(publicKey).toString("hex"),
      }),
    );
    expect(out.ok).toBe(true);
  });
});

// ============================================================================
// v0.6.0 — Audit-stream events
// ============================================================================

describe("v0.6.0: audit_event_compose + audit_chain_verify", () => {
  it("compose returns a complete event with a 64-char hash", async () => {
    const out = JSON.parse(
      await handlers.audit_event_compose({
        event_id: 1,
        kind: "decision_card_drafted",
        source: "procurement-decision-api",
        payload: { decision_id: "DEC-1" },
      }),
    );
    expect(out.event_id).toBe(1);
    expect(out.prev_hash).toBe("0".repeat(64));
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(out.kind).toBe("decision_card_drafted");
  });

  it("compose rejects unknown event kinds", async () => {
    const out = JSON.parse(
      await handlers.audit_event_compose({
        event_id: 1,
        kind: "made_up_kind",
        source: "x",
      }),
    );
    expect(out.error).toMatch(/unknown event kind/);
  });

  it("chain_verify accepts a properly chained pair", async () => {
    const e1 = JSON.parse(
      await handlers.audit_event_compose({
        event_id: 1,
        kind: "request_allowed",
        source: "policy-as-code-engine",
      }),
    );
    const e2 = JSON.parse(
      await handlers.audit_event_compose({
        event_id: 2,
        kind: "request_denied",
        source: "policy-as-code-engine",
        prev_hash: e1.hash,
      }),
    );
    const out = JSON.parse(
      await handlers.audit_chain_verify({ events: [e1, e2] }),
    );
    expect(out.valid).toBe(true);
    expect(out.checked).toBe(2);
  });

  it("chain_verify detects a tampered payload", async () => {
    const e1 = JSON.parse(
      await handlers.audit_event_compose({
        event_id: 1,
        kind: "request_allowed",
        source: "policy-as-code-engine",
        payload: { x: 1 },
      }),
    );
    e1.payload = { x: 999 }; // tamper
    const out = JSON.parse(
      await handlers.audit_chain_verify({ events: [e1] }),
    );
    expect(out.valid).toBe(false);
    expect(out.first_break_at).toBe(1);
  });

  it("inspect surfaces self-consistency check", async () => {
    const e1 = JSON.parse(
      await handlers.audit_event_compose({
        event_id: 1,
        kind: "watch_drifted",
        source: "aeo-validator-service",
      }),
    );
    const out = JSON.parse(await handlers.audit_event_inspect({ event: e1 }));
    expect(out.valid_envelope).toBe(true);
    expect(out.self_consistent).toBe(true);
    expect(out.known_kind).toBe(true);
  });
});

// ============================================================================
// v0.6.0 — Cross-spec Suite operations
// ============================================================================

describe("v0.6.0: suite_doc_detect_spec", () => {
  it("detects every Suite spec by its *_version field", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ aeo_version: "0.1" }, "aeo"],
      [{ provenance_version: "0.1" }, "prompt-provenance"],
      [{ agent_card_version: "0.1" }, "agent-card"],
      [{ evidence_version: "0.1" }, "ai-evidence"],
      [{ tool_card_version: "0.1" }, "tool-card"],
      [{ tutor_card_version: "0.1" }, "tutor-card"],
      [{ disclosure_version: "0.1" }, "student-ai-disclosure"],
      [{ aup_version: "0.1" }, "classroom-aup"],
      [{ clinical_ai_card_version: "0.1" }, "clinical-ai"],
      [{ incident_card_version: "0.1" }, "incident-card"],
      [{ decision_card_version: "0.1" }, "decision-card"],
    ];
    for (const [body, expected] of cases) {
      const out = JSON.parse(await handlers.suite_doc_detect_spec({ body }));
      expect(out.spec).toBe(expected);
    }
  });

  it("returns unknown when no *_version field is recognised", async () => {
    const out = JSON.parse(
      await handlers.suite_doc_detect_spec({ body: { foo: "bar" } }),
    );
    expect(out.spec).toBe("unknown");
  });
});

describe("v0.6.0: suite_doc_drift", () => {
  it("no drift when bodies are identical", async () => {
    const body = { aeo_version: "0.1", entity: { name: "Acme" } };
    const out = JSON.parse(
      await handlers.suite_doc_drift({ before: body, after: body }),
    );
    expect(out.drifted).toBe(false);
    expect(out.added_fields).toEqual([]);
    expect(out.removed_fields).toEqual([]);
    expect(out.changed_fields).toEqual([]);
  });

  it("detects added + removed + changed fields", async () => {
    const before = { aeo_version: "0.1", entity: { name: "Acme" } };
    const after = { aeo_version: "0.1", entity: { name: "AcmeCorp" }, claims: [] };
    const out = JSON.parse(
      await handlers.suite_doc_drift({ before, after }),
    );
    expect(out.drifted).toBe(true);
    expect(out.added_fields).toContain("claims");
    expect(out.changed_fields).toContain("entity");
    expect(out.removed_fields).toEqual([]);
  });

  it("detects spec change", async () => {
    const before = { aeo_version: "0.1" };
    const after = { agent_card_version: "0.1" };
    const out = JSON.parse(
      await handlers.suite_doc_drift({ before, after }),
    );
    expect(out.spec_changed).toBe(true);
    expect(out.spec_before).toBe("aeo");
    expect(out.spec_after).toBe("agent-card");
  });
});
