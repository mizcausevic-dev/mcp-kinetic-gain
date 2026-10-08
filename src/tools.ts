/**
 * MCP tool descriptors for every spec in the Kinetic Gain Protocol Suite.
 *
 * @tool-count 75  - CI-enforced (tests/tool-count.test.ts) to equal
 *   toolDescriptors.length. Bump this line whenever the array below changes.
 *
 * 75 tools as of v0.9.0 = 47 spec + 16 implementation-preview + 8 DefenseTech
 * + 4 AI Claims Decision Card (InsurTech), spanning all 12 Suite specs plus
 * cross-cutting ops (hash attestation, audit-stream event composition + chain
 * verification, cross-spec drift) and the DefenseTech runtime/invariant checkers.
 *
 * The authoritative count is always toolDescriptors.length - the ListTools
 * handler returns this array verbatim (see server.ts). A hand-maintained
 * per-spec tally used to live here and drifted (60 -> 71); it is intentionally
 * gone. The @tool-count sentinel above is the single lock that keeps the prose
 * honest against the array.
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
    description: "Classify a topic against the tutor's subject scope. Returns one of: primary, included, excluded, unknown, with the matched term when applicable.",
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
    description: "Surface the disclosure's declared policy posture and any aup_uri reference. Status is one of: declared_compliant, declared_non_compliant, aup_referenced_but_unclaimed, no_aup_reference. This does not verify compliance; aup_check_compliance evaluates eight declared AUP/Disclosure checks only.",
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
    description: "Compare an AUP with a Student AI Disclosure on eight declared checks: policy effective window, signature, artifact_hash, teacher acknowledgment, prompt evidence mode, permitted/prohibited roles, assistance-extent ceiling, and assistance_extent_max=none vs ai_used=true. Returns { allowed, policy_id, disclosure_id, violations[] }; allowed=true means only these checks passed. It does not verify policy scope, tool/vendor requirements, parent consent, Tutor Cards, or legal compliance, and is not an enforcement decision.",
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
    description: "HEADLINE TOOL, fetch a vendor's /.well-known/ai-incidents.json index and return a procurement-friendly summary: total count, breakdown by severity, breakdown by status, IDs sorted by disclosed_at descending. The cheapest way for a CISO or procurement reviewer to scan a vendor's incident history.",
    inputSchema: {
      type: "object",
      required: ["origin"],
      additionalProperties: false,
      properties: {
        origin: { type: "string", format: "uri", description: "Vendor origin (e.g. https://edu.kineticgain.com)." },
      },
    },
  },

  // --------------------------------------------------------------------------
  // AI Procurement Decision Card (cross-cutting, buyer-side — spec #11)
  // --------------------------------------------------------------------------
  {
    name: "decision_card_well_known_url",
    description: "Compute the canonical AI Procurement Decision Card well-known URL: /.well-known/decisions/<decision_id>.json.",
    inputSchema: {
      type: "object",
      required: ["origin", "decision_id"],
      additionalProperties: false,
      properties: {
        origin: { type: "string", format: "uri" },
        decision_id: { type: "string", description: "Buyer-issued identifier (e.g. SPRINGFIELD-DEC-2026-001)." },
      },
    },
  },
  {
    name: "decision_card_fetch",
    description: "Fetch an AI Procurement Decision Card from a URL. Returns the parsed, schema-validated JSON document.",
    inputSchema: {
      type: "object",
      required: ["url"],
      additionalProperties: false,
      properties: { url: { type: "string", format: "uri" } },
    },
  },
  {
    name: "decision_card_validate",
    description: "Validate an AI Procurement Decision Card JSON document against the v0.1 schema. Enforces conditional rules: status=approved-with-conditions and status=rejected-with-remediation require at least one entry in conditions; status=withdrawn requires a withdrawal block; publication.is_public=true requires publication_uri.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: { type: "string", description: "Decision Card as inline JSON." } },
    },
  },
  {
    name: "decision_card_inspect",
    description: "Structured summary of an AI Procurement Decision Card: buyer identity, decision status + scope, vendor + documents reviewed (by type and URL), rubric pass/partial/fail counts, conditions count, signatures count, publication posture, history event count, withdrawal flag.",
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
  // v0.6.0 — Decision Intelligence preview tools
  // --------------------------------------------------------------------------
  {
    name: "decision_card_infer_status",
    description:
      "Validate each rubric row, then infer a preview decision.status. Mirrors procurement-decision-api's rubric engine: any 'fail' -> 'rejected-with-remediation'; any 'partial' or 'pass-with-condition' -> 'approved-with-conditions'; all 'pass' -> 'approved'; empty or all 'n/a' -> 'pending'. An unsupported result returns an error, never an approval.",
    inputSchema: {
      type: "object",
      required: ["rubric"],
      additionalProperties: false,
      properties: {
        rubric: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "result"],
            additionalProperties: true,
            properties: {
              id: { type: "string", minLength: 1 },
              result: {
                type: "string",
                enum: ["pass", "pass-with-condition", "partial", "fail", "n/a"],
              },
            },
          },
        },
      },
    },
  },
  {
    name: "decision_card_to_policy_bundle",
    description:
      "Read-only deny preview for rejected, withdrawn, expired, or pending Decision Cards; returned bundles carry preview_only=true and enforceable=false. Approved statuses return an MCP error: only the live policy engine can check buyer identity and trusted attestation, vendor scope, allowed action, and effective window before producing an enforceable bundle. Do not use this tool output as an access grant.",
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
    name: "decision_card_signature_check",
    description:
      "Structural check on a Decision Card's signatures[] block: count signers, show their method/key/timestamp, and return the canonical-JSON hash of the card body (excluding signatures) so a caller can pair this with attestation_verify for cryptographic checking.",
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
  // v0.6.0 — AI Incident Card remediation tools
  // --------------------------------------------------------------------------
  {
    name: "incident_affected_walk",
    description:
      "Walk an Incident Card's `affected` block and return every referenced Suite document as { uri, kind }. Useful as the seed list for incident-correlation-rs or fan-out validation via aeo-validator-service.",
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
    name: "incident_remediation_plan",
    description:
      "Map each affected URI in an Incident Card to a recommended Action + Urgency. Single-hop preview of what incident-correlation-rs.correlate() would produce: agent/tutor/tool-card -> revalidate; vendor/product -> request_review. Urgency follows severity.",
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
  // v0.6.0 — Hash attestation tools (matches hash-attestation-rs wire format)
  // --------------------------------------------------------------------------
  {
    name: "attestation_canonical_hash",
    description:
      "Compute the SHA-256 canonical-JSON hash of an arbitrary value (sorted keys, no whitespace). This is the structural hash convention used by procurement-decision-api, aeo-validator-service, aeo-graph-explorer-rs, and hash-attestation-rs. Identical JSON values produce identical hashes regardless of original whitespace or key order.",
    inputSchema: {
      type: "object",
      required: ["body"],
      additionalProperties: false,
      properties: {
        body: { description: "Any JSON value to hash." },
      },
    },
  },
  {
    name: "attestation_verify",
    description:
      "Verify an ed25519 Attestation envelope against a body and caller-supplied public key. Recomputes the canonical hash and verifies the signature over the hash string. Does not verify that the supplied key belongs to the claimed key_url or signer. Public key accepted as 64-char hex or base64.",
    inputSchema: {
      type: "object",
      required: ["attestation", "body", "public_key"],
      additionalProperties: false,
      properties: {
        attestation: {
          type: "object",
          required: ["algorithm", "signed_hash", "signature", "key_url", "signed_at"],
          properties: {
            algorithm: { type: "string" },
            signed_hash: { type: "string" },
            signature: { type: "string" },
            key_url: { type: "string" },
            signed_at: { type: "string" },
          },
        },
        body: { description: "The body the attestation was minted over." },
        public_key: {
          type: "string",
          description: "32-byte ed25519 verifying key as 64-char hex OR base64.",
        },
      },
    },
  },
  {
    name: "attestation_inspect",
    description:
      "Pretty-print an Attestation envelope with structural validation: confirms every required field is present, reports the decoded signature byte-length (should be 64), and surfaces the key_url + signed_at fields a caller would use to find the matching public key.",
    inputSchema: {
      type: "object",
      required: ["attestation"],
      additionalProperties: false,
      properties: {
        attestation: { type: "object" },
      },
    },
  },

  // --------------------------------------------------------------------------
  // v0.6.0 — Audit-stream governance event tools
  // --------------------------------------------------------------------------
  {
    name: "audit_event_compose",
    description:
      "Build a ready-to-POST audit-stream-py GovernanceEvent: assigns event_id, computes the canonical hash, links to prev_hash (defaults to 64 zeros for event #1). Kind must be one of the 19 declared event kinds (decision_card_drafted, watch_drifted, request_denied, etc., plus 'other').",
    inputSchema: {
      type: "object",
      required: ["event_id", "kind", "source"],
      additionalProperties: false,
      properties: {
        event_id: { type: "integer", minimum: 1 },
        kind: { type: "string" },
        source: { type: "string" },
        payload: { type: "object" },
        prev_hash: { type: "string", description: "64-char hex; defaults to 64 zeros." },
        timestamp: { type: "string", description: "Optional ISO-8601; defaults to now." },
      },
    },
  },
  {
    name: "audit_chain_verify",
    description:
      "Walk an array of GovernanceEvents top-to-bottom and verify the hash chain: monotonic event_id, prev_hash linkage, self-consistency of each event's hash. Returns { valid, checked, first_break_at, reason }, the same shape audit-stream-py's GET /verify endpoint emits.",
    inputSchema: {
      type: "object",
      required: ["events"],
      additionalProperties: false,
      properties: {
        events: {
          type: "array",
          items: { type: "object" },
        },
      },
    },
  },
  {
    name: "audit_event_inspect",
    description:
      "Pretty-print one GovernanceEvent with structural validation: required fields, known/unknown kind, payload key list, and self-consistency check (does the event's `hash` match the recomputed canonical hash of the body?).",
    inputSchema: {
      type: "object",
      required: ["event"],
      additionalProperties: false,
      properties: {
        event: { type: "object" },
      },
    },
  },

  // --------------------------------------------------------------------------
  // v0.7.0 — Live audit-stream tools (talk to a running audit-stream-py)
  // --------------------------------------------------------------------------
  {
    name: "audit_event_emit",
    description:
      "POSTs a governance event to the audit-stream-py instance configured by AUDIT_STREAM_URL and AUDIT_STREAM_TOKEN. This sends kind, caller-asserted source, and payload to that service. The bearer token authenticates this MCP process, not the claimed producer or tenant. Obtain the user's approval before recording an event; omit secrets and personal data unless the service is approved for them. The server assigns event_id/timestamp/prev_hash/hash. Returns a validated service event receipt or a structured error; receipt does not prove durable storage or event completeness.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: "object",
      required: ["kind", "source"],
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          maxLength: 128,
          pattern: "^[a-z][a-z0-9_]*$",
          description:
            "The audit-stream-py service accepts only its declared event kinds (for example decision_card_drafted, request_denied, or watch_drifted). Use 'other' for ad-hoc kinds; unknown values are rejected by the sink.",
        },
        source: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$",
          description:
            "Caller-asserted ASCII producer label, not an authenticated identity. Use a stable identifier such as 'mcp-kinetic-gain' or 'manual'; do not claim another producer's identity without evidence.",
        },
        payload: {
          type: "object",
          description: "Optional plain-object payload to record alongside kind+source. Invalid supplied payloads are rejected, not dropped.",
        },
      },
    },
  },
  {
    name: "audit_events_query",
    description:
      "GET recent governance events from a running audit-stream-py instance (AUDIT_STREAM_URL and AUDIT_STREAM_TOKEN), optionally filtered by kind or source. The service does not combine both filters. Returns the events array plus a count field; recorded source labels are caller-asserted. Returns a structured error when unconfigured.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[a-z][a-z0-9_]*$",
          description: "Filter by event kind (exact match). Omit to get all kinds.",
        },
        source: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$",
          description: "Filter by source (exact match). Omit to get all sources.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 1000,
          description: "Cap the number of events requested to at most 1000. Responses are separately capped at 1 MB.",
        },
      },
    },
  },
  {
    name: "audit_chain_verify_live",
    description:
      "Ask the configured audit-stream service to check its full server-side hash chain. This checks chain continuity, not whether events are truthful, authorized, complete, or legally compliant. Returns valid, checked, first_break_at, and reason. Requires AUDIT_STREAM_URL and AUDIT_STREAM_TOKEN; returns a structured error otherwise.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },

  // --------------------------------------------------------------------------
  // v0.6.0 — Cross-spec Suite operations
  // --------------------------------------------------------------------------
  {
    name: "suite_doc_detect_spec",
    description:
      "Detect which Kinetic Gain Suite spec a JSON document is by sniffing its top-level *_version field. Returns { spec, version_field, version }. Recognises all 12 specs; returns spec='unknown' for anything else.",
    inputSchema: {
      type: "object",
      required: ["body"],
      additionalProperties: false,
      properties: {
        body: { type: "object" },
      },
    },
  },
  {
    name: "suite_doc_drift",
    description:
      "Structural diff between two versions of the same Suite document. Returns { drifted, spec_before, spec_after, spec_changed, content_hash_before, content_hash_after, added_fields, removed_fields, changed_fields }, mirrors the DriftReport shape aeo-validator-service emits for watch rechecks.",
    inputSchema: {
      type: "object",
      required: ["before", "after"],
      additionalProperties: false,
      properties: {
        before: { type: "object" },
        after: { type: "object" },
      },
    },
  },

  // --------------------------------------------------------------------------
  // v0.8.0 — DefenseTech 6-pack tooling
  // --------------------------------------------------------------------------
  {
    name: "defensetech_vault_resolve_3axis",
    description:
      "Deterministic preview of a DefenseTech 3-axis vault contract: intersect allowed_actions and OR requires_* flags. Unknown or incomparable human-user requirements return ok=false for an authorized policy owner to resolve. This does not verify identity, classification, licenses, or enforce access.",
    inputSchema: {
      type: "object",
      required: ["contract", "tuple"],
      additionalProperties: false,
      properties: {
        contract: { type: "object" },
        tuple: {
          type: "object",
          required: ["cui", "export_control", "foreign_person"],
          additionalProperties: false,
          properties: {
            cui: { type: "string" },
            export_control: { type: "string" },
            foreign_person: { type: "string" },
          },
        },
      },
    },
  },
  {
    name: "defensetech_audit_event_check_invariants",
    description:
      "Run three deterministic DefenseTech event checks: CUI distribution-statement presence, ITAR status with tokenized license for an authorized foreign person, and a 72-hour discovery-to-filing interval. The last check requires event.discovered_at; event.timestamp is not a substitute. Returns ok + errors + passed, not a legal compliance determination.",
    inputSchema: {
      type: "object",
      required: ["event"],
      additionalProperties: false,
      properties: { event: { type: "object" } },
    },
  },
  {
    name: "defensetech_check_dfars_72h_clock",
    description:
      "Calculate the DFARS 252.204-7012 discovery-to-filing 72-hour interval from supplied timezone-qualified timestamps. Requires discovered_at, not occurred_at. Invalid or pre-discovery filing timestamps return valid=false and within_window=false. This arithmetic preview does not establish a reporting duty or prove filing.",
    inputSchema: {
      type: "object",
      required: ["discovered_at", "filed_at"],
      additionalProperties: false,
      properties: {
        discovered_at: { type: "string", format: "date-time", description: "When the cyber incident was discovered; the reporting clock starts here." },
        filed_at: { type: "string", format: "date-time" },
      },
    },
  },
  {
    name: "defensetech_check_cui_distribution_statement",
    description:
      "Check that a CUI-Specified+ tier event carries the required distribution_statement (DoDI 5230.24). For PUBLIC / CUI-BASIC tiers reports applicable=false.",
    inputSchema: {
      type: "object",
      required: ["cui_categorization"],
      additionalProperties: false,
      properties: {
        cui_categorization: { type: "string" },
        distribution_statement: { type: "object" },
      },
    },
  },
  {
    name: "defensetech_check_itar_us_person",
    description:
      "Check that an ITAR resource event has US-PERSON-VERIFIED (or AUTHORIZED-FOREIGN-PERSON-WITH-LICENSE + DDTC license number tokenized) on the agent. Per 22 CFR 120.62 / 22 CFR 120.50 deemed-export rule.",
    inputSchema: {
      type: "object",
      required: ["export_control_status"],
      additionalProperties: false,
      properties: {
        export_control_status: { type: "string" },
        human_user_us_person_status: { type: "string" },
        ddtc_export_license_number_tokenized: { type: "string" },
      },
    },
  },
  {
    name: "defensetech_incident_classify_event_type",
    description:
      "Given a freeform description of a defense-AI incident, classify it into one of the 22 DefenseTech Incident Card event_type values (DFARS cyber / CUI spillage / ITAR violation / foreign-person breach / classified misuse / NISPOM insider-threat / CMMC POA&M / AI-tool supply-chain / etc.). Returns top 3 candidates with token-match scoring.",
    inputSchema: {
      type: "object",
      required: ["description"],
      additionalProperties: false,
      properties: { description: { type: "string" } },
    },
  },
  {
    name: "defensetech_summarize_cmmc_evidence_bundle",
    description:
      "Summarize a CMMC L2/L3 readiness evidence bundle: target level, assessment mode, evidence count, family coverage count, outcome distribution, orphan-failure count (not-satisfied without poam_ref), SPRS evidence presence, and quick invariant checks for POA&M traceability + SPRS-when-7019/7020-in-scope.",
    inputSchema: {
      type: "object",
      required: ["bundle"],
      additionalProperties: false,
      properties: { bundle: { type: "object" } },
    },
  },
  {
    name: "defensetech_vault_contract_cross_binding_check",
    description:
      "Verify the cross_binding_refs block on a DefenseTech vault contract is syntactically valid: all referenced repos are HTTPS URLs. Returns valid_refs + errors. Does NOT fetch remotely (syntactic check only).",
    inputSchema: {
      type: "object",
      required: ["contract"],
      additionalProperties: false,
      properties: { contract: { type: "object" } },
    },
  },
  // --------------------------------------------------------------------------
  // AI Claims Decision Card (InsurTech) — v0.9.0, 12th Suite spec
  // --------------------------------------------------------------------------
  {
    name: "claims_card_validate",
    description:
      "Validate an AI Claims Decision Card against the bundled v0.1 structural schema, including required fields, enums, ranges, and attestation field shapes. Returns the first schema issue or { valid, claims_card_id, version }. This does not verify signatures, evidence authenticity, the coverage decision, or legal compliance.",
    inputSchema: {
      type: "object",
      required: ["document"],
      additionalProperties: false,
      properties: {
        document: { type: "object", description: "The Claims Decision Card JSON (parsed object)." },
      },
    },
  },
  {
    name: "claims_card_inspect",
    description:
      "Structured summary of an AI Claims Decision Card: claim type, outcome, coverage, evidence count, model, jurisdiction, human-in-loop, chain position, and attestation status. Cheaper than reading the full card.",
    inputSchema: {
      type: "object",
      required: ["document"],
      additionalProperties: false,
      properties: {
        document: { type: "object", description: "The Claims Decision Card JSON (parsed object)." },
      },
    },
  },
  {
    name: "claims_card_sign",
    description:
      "Compute the canonical SHA-256 hash of an AI Claims Decision Card for ed25519 signing. Sorts object keys recursively and excludes attestation.card_hash + attestation.signature before hashing. Returns the 64-char lowercase hex card_hash; caller signs it offline.",
    inputSchema: {
      type: "object",
      required: ["document"],
      additionalProperties: false,
      properties: {
        document: {
          type: "object",
          description: "Claims Decision Card. attestation.card_hash and attestation.signature are stripped before hashing.",
        },
      },
    },
  },
  {
    name: "claims_card_chain",
    description:
      "Link a new AI Claims Decision Card to its predecessor: sets attestation.chain_index (prev + 1) and attestation.prev_card_hash. Validates the predecessor hash is 64-char hex and its index is a non-negative integer. Call claims_card_sign next.",
    inputSchema: {
      type: "object",
      required: ["card", "prev_card_hash", "prev_chain_index"],
      additionalProperties: false,
      properties: {
        card: { type: "object", description: "The new Claims Decision Card (attestation may be partial)." },
        prev_card_hash: { type: "string", description: "64-char lowercase hex SHA-256 of the previous card." },
        prev_chain_index: { type: "integer", description: "chain_index of the previous card." },
      },
    },
  },
];
