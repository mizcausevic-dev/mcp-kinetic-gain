/**
 * MCP tool descriptors for every spec in the Kinetic Gain Protocol Suite.
 * 18 tools total: AEO (4), Prompt Provenance (3), Agent Cards (4),
 * AI Evidence (3), MCP Tool Cards (4).
 */
export const toolDescriptors = [
  // --------------------------------------------------------------------------
  // AEO Protocol
  // --------------------------------------------------------------------------
  {
    name: "aeo_fetch",
    description: "Fetch the full AEO Protocol declaration at an origin's /.well-known/aeo.json. Returns the raw conforming JSON document.",
    inputSchema: {
      type: "object",
      required: ["origin"],
      additionalProperties: false,
      properties: {
        origin: { type: "string", format: "uri", description: "Origin URL (e.g. 'https://mizcausevic-dev.github.io')." },
      },
    },
  },
  {
    name: "aeo_inspect",
    description: "Return a structured summary of an AEO declaration: entity, source/verification counts, claim IDs, audit mode. Cheaper than aeo_fetch for context-window-constrained agents.",
    inputSchema: {
      type: "object",
      required: ["origin"],
      additionalProperties: false,
      properties: {
        origin: { type: "string", format: "uri" },
      },
    },
  },
  {
    name: "aeo_get_claim",
    description: "Extract a single AEO claim by ID. Returns the claim object or a not-found error listing available claim IDs.",
    inputSchema: {
      type: "object",
      required: ["origin", "claim_id"],
      additionalProperties: false,
      properties: {
        origin: { type: "string", format: "uri" },
        claim_id: { type: "string" },
      },
    },
  },
  {
    name: "aeo_well_known_url",
    description: "Compute the canonical AEO well-known URL for an origin, without fetching.",
    inputSchema: {
      type: "object",
      required: ["origin"],
      additionalProperties: false,
      properties: { origin: { type: "string", format: "uri" } },
    },
  },

  // --------------------------------------------------------------------------
  // Prompt Provenance
  // --------------------------------------------------------------------------
  {
    name: "prompt_provenance_validate",
    description: "Validate a Prompt Provenance JSON document against the v0.1 schema. Returns { valid, prompt_id, version } or { valid: false, reason }.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string", description: "A Prompt Provenance JSON document as a string." } },
    },
  },
  {
    name: "prompt_provenance_inspect",
    description: "Structured summary of a Prompt Provenance document: prompt identity, lineage, approval state, evaluation suites.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string" } },
    },
  },
  {
    name: "prompt_provenance_eval_result",
    description: "Extract a single evaluation suite's result from a Prompt Provenance document.",
    inputSchema: {
      type: "object",
      required: ["document_json", "suite_name"],
      additionalProperties: false,
      properties: {
        document_json: { type: "string" },
        suite_name: { type: "string", description: "Name of the evaluation suite to extract." },
      },
    },
  },

  // --------------------------------------------------------------------------
  // Agent Cards
  // --------------------------------------------------------------------------
  {
    name: "agent_card_well_known_url",
    description: "Compute the canonical Agent Card well-known URL for a given origin + agent_id (convention: /.well-known/agents/<agent_id>.json).",
    inputSchema: {
      type: "object",
      required: ["origin", "agent_id"],
      additionalProperties: false,
      properties: {
        origin: { type: "string", format: "uri" },
        agent_id: { type: "string" },
      },
    },
  },
  {
    name: "agent_card_inspect",
    description: "Structured summary of an Agent Card document. Pass EITHER `url` (the server fetches it) OR `document_json` (already-fetched).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", format: "uri" },
        document_json: { type: "string" },
      },
    },
  },
  {
    name: "agent_card_tool_disclosure",
    description: "Return the list of tools an agent declares, with side-effect class and (when present) MCP Tool Card URI for each tool.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", format: "uri" },
        document_json: { type: "string" },
      },
    },
  },
  {
    name: "agent_card_validate",
    description: "Validate an Agent Card JSON document against the v0.1 schema.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string" } },
    },
  },

  // --------------------------------------------------------------------------
  // AI Evidence Format
  // --------------------------------------------------------------------------
  {
    name: "ai_evidence_validate",
    description: "Validate an AI Evidence object against the v0.1 schema.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string" } },
    },
  },
  {
    name: "ai_evidence_inspect",
    description: "Structured summary of an AI Evidence object: claim text, source metadata, retrieval method, synthesis role, hash, signed-or-not.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string" } },
    },
  },
  {
    name: "ai_evidence_verify_hash",
    description: "Compute SHA-256 over the canonical UTF-8 form of `candidate_text` (LF endings, no trailing newline) and compare against the evidence's verification.content_hash. Returns ok=true on match, or { error: hash_mismatch, expected, recomputed }.",
    inputSchema: {
      type: "object",
      required: ["document_json", "candidate_text"],
      additionalProperties: false,
      properties: {
        document_json: { type: "string" },
        candidate_text: { type: "string", description: "The text whose hash should match the evidence's content_hash." },
      },
    },
  },

  // --------------------------------------------------------------------------
  // MCP Tool Cards
  // --------------------------------------------------------------------------
  {
    name: "tool_card_well_known_url",
    description: "Compute the canonical MCP Tool Card well-known URL (convention: /.well-known/mcp-tools/<tool_name>.json).",
    inputSchema: {
      type: "object",
      required: ["mcp_server_origin", "tool_name"],
      additionalProperties: false,
      properties: {
        mcp_server_origin: { type: "string", format: "uri" },
        tool_name: { type: "string" },
      },
    },
  },
  {
    name: "tool_card_inspect",
    description: "Structured summary of an MCP Tool Card: tool identity, safety profile (side-effect class, PII/secrets exposure, approval requirement), test count, p99 latency.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", format: "uri" },
        document_json: { type: "string" },
      },
    },
  },
  {
    name: "tool_card_tested_with",
    description: "Return the tested-LLM entries for a tool, optionally filtered by a substring match on the LLM identifier.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", format: "uri" },
        document_json: { type: "string" },
        llm_filter: { type: "string", description: "Substring of the LLM identifier to filter by (case-insensitive). Optional." },
      },
    },
  },
  {
    name: "tool_card_validate",
    description: "Validate an MCP Tool Card JSON document against the v0.1 schema.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string" } },
    },
  },
];
