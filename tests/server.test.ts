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
// Cross-cutting
// ----------------------------------------------------------------------------
describe("Unknown tool", () => {
  it("server exposes exactly the 34 declared tools (5 core specs + 3 EdTech extensions)", () => {
    expect(Object.keys(handlers)).toHaveLength(34);
  });
});
