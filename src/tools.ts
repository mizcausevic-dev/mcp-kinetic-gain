/**
 * MCP tool descriptors for every spec in the Kinetic Gain Protocol Suite.
 * 43 tools total across 10 specs (v0.5.0):
 *   AEO Protocol            (4)
 *   Prompt Provenance       (3)
 *   Agent Cards             (4)
 *   AI Evidence Format      (3)
 *   MCP Tool Cards          (4)
 *   AI Tutor Cards          (6) — EdTech extension
 *   Student AI Disclosure   (5) — EdTech extension
 *   Classroom AI AUP        (5) — EdTech extension (closes the EdTech trio)
 *   Clinical AI Disclosure  (4) — HealthTech extension
 *   AI Incident Card        (5) — cross-cutting (includes index_fetch)
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

  // --------------------------------------------------------------------------
  // AI Tutor Cards (EdTech extension)
  // --------------------------------------------------------------------------
  {
    name: "tutor_card_well_known_url",
    description: "Compute the canonical AI Tutor Card well-known URL (convention: /.well-known/tutors/<tutor_id>.json).",
    inputSchema: {
      type: "object",
      required: ["origin", "tutor_id"],
      additionalProperties: false,
      properties: {
        origin: { type: "string", format: "uri" },
        tutor_id: { type: "string" },
      },
    },
  },
  {
    name: "tutor_card_fetch",
    description: "Fetch a Tutor Card from a URL. Returns the parsed, schema-validated JSON.",
    inputSchema: {
      type: "object",
      required: ["url"],
      additionalProperties: false,
      properties: { url: { type: "string", format: "uri" } },
    },
  },
  {
    name: "tutor_card_validate",
    description: "Validate an AI Tutor Card JSON document against the v0.1 schema, including the COPPA conditional rule (age_range_min < 13 ⇒ coppa_compliant must be true).",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string" } },
    },
  },
  {
    name: "tutor_card_inspect",
    description: "Structured summary of a Tutor Card: tutor identity, audience, pedagogy, subject scope counts, safety strength, FERPA/COPPA/GDPR posture, evaluation count, COPPA-rule check.",
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
    name: "tutor_card_subject_check",
    description: "Classify a topic against the tutor's subject scope. Returns one of: primary, included, excluded, unknown — with the matched term when applicable.",
    inputSchema: {
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: {
        url: { type: "string", format: "uri" },
        document_json: { type: "string" },
        query: { type: "string", description: "Topic to classify, e.g. 'algebra' or 'differential equations'." },
      },
    },
  },
  {
    name: "tutor_card_coppa_check",
    description: "Enforce the spec's COPPA conditional rule: if audience.age_range_min < 13, data_privacy.coppa_compliant MUST be true. Returns { ok: true } or { error: coppa_violation, reason }.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", format: "uri" },
        document_json: { type: "string" },
      },
    },
  },

  // --------------------------------------------------------------------------
  // Student AI Disclosure (EdTech extension)
  // --------------------------------------------------------------------------
  {
    name: "disclosure_validate",
    description: "Validate a Student AI Disclosure JSON document against the v0.1 schema. Enforces conditional rules (ai_used true requires tools/roles/extent/prompt_mode; ai_used false forbids them; prompt mode gates prompts presence).",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string" } },
    },
  },
  {
    name: "disclosure_inspect",
    description: "Structured summary of a Student AI Disclosure: assignment identity, AI usage facts, tools used (with back-refs to agent / tutor cards), role taxonomy, assistance extent, prompt-mode + count, artifact hash, policy posture, signature + acknowledgment.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string" } },
    },
  },
  {
    name: "disclosure_verify_artifact_hash",
    description: "Recompute SHA-256 over a candidate artifact and compare to disclosure.artifact_hash. Pass either `candidate_text` (canonical SHA-256: LF, no trailing newline) for text artifacts, or `candidate_bytes_base64` (raw-bytes SHA-256) for binary artifacts like PDFs / images. Returns ok=true on match, otherwise { error: artifact_hash_mismatch, expected, recomputed }.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: {
        document_json: { type: "string" },
        candidate_text: { type: "string", description: "Text artifact (canonical-text mode)." },
        candidate_bytes_base64: { type: "string", description: "Base64-encoded raw artifact bytes (raw-bytes mode)." },
      },
    },
  },
  {
    name: "disclosure_verify_prompt_hash",
    description: "Verify a single prompt hash in a hashed-mode disclosure. Looks up prompt_id and compares canonical SHA-256 of candidate_text. Returns ok=true on match or { error: prompt_hash_mismatch, expected, recomputed }. Errors with wrong_prompt_mode if prompt_evidence_mode is not 'hashed'.",
    inputSchema: {
      type: "object",
      required: ["document_json", "prompt_id", "candidate_text"],
      additionalProperties: false,
      properties: {
        document_json: { type: "string" },
        prompt_id: { type: "string" },
        candidate_text: { type: "string" },
      },
    },
  },
  {
    name: "disclosure_aup_check",
    description: "Surface the disclosure's policy posture: whether an aup_uri is referenced and what the student declared. Status is one of: declared_compliant, declared_non_compliant, aup_referenced_but_unclaimed, no_aup_reference. Reports declared posture only; for the actual three-way join use aup_check_compliance.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string" } },
    },
  },

  // --------------------------------------------------------------------------
  // Classroom AI AUP (EdTech extension — closes the trio)
  // --------------------------------------------------------------------------
  {
    name: "aup_well_known_url",
    description: "Compute the canonical Classroom AI AUP well-known URL: /.well-known/ai-aup.json.",
    inputSchema: {
      type: "object",
      required: ["origin"],
      additionalProperties: false,
      properties: { origin: { type: "string", format: "uri" } },
    },
  },
  {
    name: "aup_fetch",
    description: "Fetch a Classroom AI AUP from a URL. Returns the parsed, schema-validated JSON document.",
    inputSchema: {
      type: "object",
      required: ["url"],
      additionalProperties: false,
      properties: { url: { type: "string", format: "uri" } },
    },
  },
  {
    name: "aup_validate",
    description: "Validate a Classroom AI AUP JSON document against the v0.1 schema. Enforces conditional rules: course scope requires non-empty course_ids; assignment scope requires non-empty assignment_ids; assistance_extent_max=none forbids any permitted_roles; expires_at must follow effective_at; roles cannot be both permitted and prohibited.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string" } },
    },
  },
  {
    name: "aup_inspect",
    description: "Structured summary of a Classroom AI AUP: policy identity, scope, permitted-use counts, prohibited-use counts, disclosure requirements, supervision level, vendor requirements posture, parent-consent gating.",
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
    name: "aup_check_compliance",
    description: "HEADLINE TOOL — joins an AUP with a Student AI Disclosure and decides whether the submission complies with the operative policy. Eight gates: policy effective window, signature, artifact_hash, teacher acknowledgment, prompt evidence mode, permitted/prohibited roles, assistance-extent ceiling, and assistance_extent_max=none vs ai_used=true. Returns { allowed, policy_id, disclosure_id, violations[] } with one entry per failed gate. The three-document join (Tutor Card + AUP + Disclosure) reduces to a single allow/deny call.",
    inputSchema: {
      type: "object",
      required: ["disclosure_json"],
      additionalProperties: false,
      properties: {
        aup_json: { type: "string", description: "AUP as inline JSON." },
        aup_url: { type: "string", format: "uri", description: "AUP URL — server fetches it." },
        disclosure_json: { type: "string", description: "Student AI Disclosure as inline JSON." },
      },
    },
  },

  // --------------------------------------------------------------------------
  // Clinical AI Disclosure (HealthTech extension)
  // --------------------------------------------------------------------------
  {
    name: "clinical_ai_well_known_url",
    description: "Compute the canonical Clinical AI Card well-known URL: /.well-known/clinical-ai/<system_id>.json.",
    inputSchema: {
      type: "object",
      required: ["origin", "system_id"],
      additionalProperties: false,
      properties: {
        origin: { type: "string", format: "uri" },
        system_id: { type: "string", description: "Vendor's stable system identifier (kebab-case)." },
      },
    },
  },
  {
    name: "clinical_ai_fetch",
    description: "Fetch a Clinical AI Card from a URL. Returns the parsed, schema-validated JSON document.",
    inputSchema: {
      type: "object",
      required: ["url"],
      additionalProperties: false,
      properties: { url: { type: "string", format: "uri" } },
    },
  },
  {
    name: "clinical_ai_validate",
    description: "Validate a Clinical AI Card JSON document against the v0.1 schema. Enforces the headline rules: autonomy ⇔ medical device, SaMD completeness, FDA-clearance documentation, PHI ⇒ explicit HIPAA + BAA posture, and bias_audit_uri requirement for SaMD class II+ / autonomous / pre-authorization use.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string", description: "Clinical AI Card as inline JSON." } },
    },
  },
  {
    name: "clinical_ai_inspect",
    description: "Structured summary of a Clinical AI Card: system identity, clinical context (indication / care settings / patient population), regulatory posture (FDA / SaMD), clinical role, evidence (validation studies + bias audit + performance metrics), HIPAA + BAA posture, EHR integration (FHIR / SMART / CDS Hooks), safety + mandated reporting.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", format: "uri" },
        document_json: { type: "string" },
      },
    },
  },

  // --------------------------------------------------------------------------
  // AI Incident Card (cross-cutting)
  // --------------------------------------------------------------------------
  {
    name: "incident_well_known_url",
    description: "Compute the canonical AI Incident Card well-known URL: /.well-known/ai-incidents/<id>.json.",
    inputSchema: {
      type: "object",
      required: ["origin", "incident_id"],
      additionalProperties: false,
      properties: {
        origin: { type: "string", format: "uri" },
        incident_id: { type: "string", description: "Convention: INC-<YYYY-MM-DD>-<vendor>-<seq>" },
      },
    },
  },
  {
    name: "incident_fetch",
    description: "Fetch an AI Incident Card from a URL. Returns the parsed, schema-validated JSON document.",
    inputSchema: {
      type: "object",
      required: ["url"],
      additionalProperties: false,
      properties: { url: { type: "string", format: "uri" } },
    },
  },
  {
    name: "incident_validate",
    description: "Validate an AI Incident Card JSON document against the v0.1 schema. Enforces conditional rules: status=resolved requires resolved_at; status=withdrawn requires withdrawal block; non-empty regulatory.reported_to requires non-empty regulatory_filing_uris; root_cause.category=other and categories containing 'other' both require the corresponding _other_text fields.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string", description: "Incident Card as inline JSON." } },
    },
  },
  {
    name: "incident_inspect",
    description: "Structured summary of an AI Incident Card: incident identity (id, title, severity, categories, status, timeline), affected products + versions + Agent/Tutor/Tool Card cross-references, root cause, harm, mitigation, regulatory filings, withdrawal posture, revision metadata.",
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
    name: "incident_index_fetch",
    description: "HEADLINE TOOL — fetch a vendor's /.well-known/ai-incidents.json index and return a procurement-friendly summary: total count, breakdown by severity, breakdown by status, IDs sorted by disclosed_at descending. The cheapest way for a CISO or procurement reviewer to scan a vendor's incident history.",
    inputSchema: {
      type: "object",
      required: ["origin"],
      additionalProperties: false,
      properties: {
        origin: { type: "string", format: "uri", description: "Vendor origin (e.g. https://edu.kineticgain.com)." },
      },
    },
  },
];
