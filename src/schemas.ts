/**
 * Minimal zod schemas for each Kinetic Gain Protocol Suite spec.
 * Only the fields we actually use in handlers are validated strictly;
 * unknown fields are tolerated (specs may add fields in minor versions).
 */
import { z } from "zod";

// ----------------------------------------------------------------------------
// AEO Protocol
// ----------------------------------------------------------------------------
export const aeoDocumentSchema = z.object({
  aeo_version: z.string(),
  entity: z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    aliases: z.array(z.string()).optional(),
    canonical_url: z.string(),
  }),
  authority: z.object({
    primary_sources: z.array(z.string()).min(1),
    evidence_links: z.array(z.string()).optional(),
    verifications: z
      .array(
        z.object({
          type: z.string(),
          value: z.string(),
          proof_uri: z.string().optional(),
        }),
      )
      .optional(),
  }),
  claims: z
    .array(
      z.object({
        id: z.string(),
        predicate: z.string(),
        value: z.unknown(),
        evidence: z.array(z.string()).optional(),
        valid_from: z.string().optional(),
        valid_until: z.union([z.string(), z.null()]).optional(),
        confidence: z.enum(["high", "medium", "low"]).optional(),
      }),
    )
    .min(1),
  audit: z
    .object({
      mode: z.enum(["none", "signature", "endpoint"]),
      signing_key_uri: z.string().optional(),
      signature: z.string().optional(),
      endpoint_uri: z.string().optional(),
    })
    .optional(),
});
export type AeoDocument = z.infer<typeof aeoDocumentSchema>;

// ----------------------------------------------------------------------------
// Prompt Provenance
// ----------------------------------------------------------------------------
export const promptProvenanceSchema = z.object({
  provenance_version: z.string(),
  prompt: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    hash: z.string(),
    content_uri: z.string(),
    content_type: z.string(),
  }),
  lineage: z
    .object({
      parent: z.string().optional(),
      derivation: z.enum(["fork", "tune", "patch"]).optional(),
      change_summary: z.string().optional(),
    })
    .optional(),
  authorship: z
    .object({
      created_by: z.string(),
      reviewed_by: z.array(z.string()).optional(),
      approved_by: z.string().optional(),
      created_at: z.string(),
      approved_at: z.string().optional(),
    })
    .optional(),
  intent: z
    .object({
      purpose: z.string().optional(),
      in_scope: z.array(z.string()).optional(),
      out_of_scope: z.array(z.string()).optional(),
      models_supported: z.array(z.string()).optional(),
    })
    .optional(),
  evaluations: z
    .array(
      z.object({
        suite: z.string(),
        result_uri: z.string(),
        score: z.number().optional(),
        passed: z.boolean(),
        ran_at: z.string(),
      }),
    )
    .optional(),
  approval: z
    .object({
      state: z.enum(["draft", "under_review", "approved", "rejected", "deprecated"]),
      policy_uri: z.string().optional(),
    })
    .optional(),
});
export type PromptProvenance = z.infer<typeof promptProvenanceSchema>;

// ----------------------------------------------------------------------------
// Agent Card
// ----------------------------------------------------------------------------
export const agentCardSchema = z.object({
  agent_card_version: z.string(),
  agent: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    provider: z.string(),
    homepage: z.string().optional(),
    description: z.string(),
  }),
  capabilities: z.object({
    primary_purpose: z.string(),
    models_used: z
      .array(
        z.object({
          name: z.string(),
          provider: z.string().optional(),
          role: z.string(),
        }),
      )
      .min(1),
    tools: z
      .array(
        z.object({
          name: z.string(),
          mcp_tool_card_uri: z.string().optional(),
          side_effects: z.string(),
        }),
      )
      .optional(),
    max_context_tokens: z.number(),
    memory_persistence: z.enum(["none", "session", "persistent"]),
    autonomy_level: z.enum(["assistive", "supervised", "autonomous"]),
    prompts_used: z.array(z.string()).optional(),
  }),
  refusal_taxonomy: z.array(
    z.object({
      category: z.string(),
      behavior: z.string(),
      example_prompts: z.array(z.string()).optional(),
    }),
  ),
  evaluations: z
    .array(
      z.object({
        suite: z.string(),
        result_uri: z.string(),
        metrics: z.record(z.unknown()).optional(),
        ran_at: z.string(),
      }),
    )
    .optional(),
  deployment: z.object({
    environment: z.string(),
    uptime_sla: z.string().optional(),
    regions: z.array(z.string()).optional(),
  }),
  safety_posture: z.object({
    human_in_loop_required: z.array(z.string()),
    audit_log_uri: z.string().optional(),
    incident_response_uri: z.string().optional(),
  }),
});
export type AgentCard = z.infer<typeof agentCardSchema>;

// ----------------------------------------------------------------------------
// AI Evidence Format
// ----------------------------------------------------------------------------
export const aiEvidenceSchema = z.object({
  evidence_version: z.string(),
  evidence_id: z.string(),
  claim_text: z.string(),
  source: z.object({
    uri: z.string(),
    type: z.string(),
    title: z.string().optional(),
    publisher: z.string().optional(),
    fetched_at: z.string(),
  }),
  span: z.object({
    selector_type: z.string(),
    selector_value: z.string().optional(),
    exact_text: z.string().optional(),
  }),
  retrieval: z.object({
    method: z.string(),
    confidence: z.number().optional(),
    rank: z.number().optional(),
    freshness_age_seconds: z.number().optional(),
  }),
  verification: z.object({
    content_hash: z.string(),
    signature: z.string().optional(),
  }),
  synthesis_role: z.enum(["supporting", "contradicting", "partial", "background"]),
});
export type AiEvidence = z.infer<typeof aiEvidenceSchema>;

// ----------------------------------------------------------------------------
// MCP Tool Card
// ----------------------------------------------------------------------------
export const mcpToolCardSchema = z.object({
  tool_card_version: z.string(),
  tool: z.object({
    server_id: z.string(),
    name: z.string(),
    version: z.string(),
    mcp_server_uri: z.string(),
    description: z.string(),
  }),
  schema: z.object({
    input_schema_uri: z.string().optional(),
    input_schema_inline: z.record(z.unknown()).optional(),
  }),
  safety: z.object({
    side_effect_class: z.enum(["read", "mutating", "external", "destructive"]),
    reversible: z.boolean(),
    rate_limited: z.boolean(),
    pii_exposure: z.string(),
    secrets_exposure: z.string(),
    human_approval_required: z.boolean(),
    refusal_modes: z.array(z.string()).optional(),
  }),
  tested_with: z
    .array(
      z.object({
        llm: z.string(),
        provider: z.string().optional(),
        test_suite_uri: z.string(),
        pass_rate: z.number(),
        tested_at: z.string(),
      }),
    )
    .optional(),
  performance: z
    .object({
      p50_latency_ms: z.number().optional(),
      p99_latency_ms: z.number().optional(),
      measurement_window: z.string().optional(),
    })
    .optional(),
});
export type McpToolCard = z.infer<typeof mcpToolCardSchema>;

// ----------------------------------------------------------------------------
// AI Tutor Card (EdTech extension of the Suite)
// ----------------------------------------------------------------------------
export const tutorCardSchema = z
  .object({
    tutor_card_version: z.string(),
    tutor: z.object({
      id: z.string(),
      name: z.string(),
      version: z.string(),
      provider: z.string(),
      homepage: z.string().optional(),
      description: z.string(),
    }),
    audience: z.object({
      age_range_min: z.number().int().min(3).max(99),
      age_range_max: z.number().int().min(3).max(99),
      grade_range_min: z.string(),
      grade_range_max: z.string(),
      language_codes: z.array(z.string()).min(1),
    }),
    subject_scope: z.object({
      primary_subjects: z.array(z.string()).min(1),
      topics_included: z.array(z.string()).optional(),
      topics_excluded: z.array(z.string()).optional(),
    }),
    pedagogy: z.object({
      approach: z.enum(["socratic", "direct_instruction", "scaffolded", "personalized", "mixed"]),
      homework_policy: z.enum(["complete", "guide_only", "refuse"]),
      assessment_policy: z.enum(["complete", "guide_only", "refuse"]),
      supports_visual_explanations: z.boolean().optional(),
      supports_step_by_step_breakdown: z.boolean().optional(),
      supports_alternative_explanations: z.boolean().optional(),
    }),
    curriculum_alignment: z
      .array(
        z.object({
          framework: z.string(),
          version: z.string().optional(),
          coverage_uri: z.string().optional(),
        }),
      )
      .optional(),
    safety: z.object({
      content_filter_strength: z.enum(["strict", "moderate", "light"]),
      mandated_reporter_protocol: z.boolean(),
      human_in_loop_required: z.array(z.string()),
      blocks_explicit_content: z.boolean().optional(),
      blocks_drug_alcohol_content: z.boolean().optional(),
      blocks_violence_content: z.boolean().optional(),
      blocks_political_advocacy: z.boolean().optional(),
    }),
    data_privacy: z.object({
      ferpa_compliant: z.boolean(),
      coppa_compliant: z.boolean(),
      gdpr_compliant: z.boolean(),
      retention_days: z.number().int().min(0),
      data_sharing_with_parents: z.enum(["full_transcript", "summaries_only", "none"]),
      data_sharing_with_school: z.enum(["full_transcript", "summaries_only", "none"]),
      third_party_data_sharing: z.boolean(),
      model_training_consent_required: z.boolean().optional(),
    }),
    agent_card_uri: z.string().optional(),
    evaluations: z
      .array(
        z.object({
          suite: z.string(),
          result_uri: z.string(),
          metrics: z.record(z.unknown()).optional(),
          ran_at: z.string(),
        }),
      )
      .optional(),
    audit: z
      .object({
        audit_log_uri: z.string().optional(),
        incident_response_uri: z.string().optional(),
        disclosure_uri: z.string().optional(),
      })
      .optional(),
  })
  .strict();
export type TutorCard = z.infer<typeof tutorCardSchema>;

// ----------------------------------------------------------------------------
// Student AI Disclosure (EdTech extension of the Suite)
// ----------------------------------------------------------------------------
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export const studentDisclosureSchema = z
  .object({
    disclosure_version: z.string(),
    disclosure_id: z.string().min(1),
    created_at: z.string(),
    student: z.object({
      id: z.string().min(1),
      display_name: z.string().min(1).optional(),
      grade_or_year: z.string().min(1).optional(),
      institution_id: z.string().min(1).optional(),
    }),
    assignment: z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      course_id: z.string().min(1),
      lms: z
        .enum([
          "canvas",
          "schoology",
          "google-classroom",
          "moodle",
          "d2l-brightspace",
          "blackboard",
          "other",
        ])
        .optional(),
      due_at: z.string().optional(),
    }),
    ai_used: z.boolean(),
    tools_used: z
      .array(
        z.object({
          name: z.string().min(1),
          provider: z.string().min(1).optional(),
          version: z.string().min(1).optional(),
          agent_card_uri: z.string().optional(),
          tutor_card_uri: z.string().optional(),
        }),
      )
      .min(1)
      .optional(),
    roles: z
      .array(
        z.enum([
          "brainstorm",
          "outline",
          "draft",
          "edit",
          "translate",
          "cite_check",
          "code_completion",
          "code_review",
          "research_synthesis",
          "tutor_dialog",
          "image_generation",
          "data_analysis",
          "other",
        ]),
      )
      .min(1)
      .optional(),
    roles_other_text: z.string().min(1).optional(),
    assistance_extent: z.enum(["minor", "substantial", "primary_author"]).optional(),
    assistance_pct: z.number().int().min(0).max(100).optional(),
    prompt_evidence_mode: z.enum(["full", "hashed", "omitted"]).optional(),
    prompts: z
      .array(
        z.object({
          id: z.string().min(1),
          text: z.string().min(1).optional(),
          hash: z.string().regex(SHA256_PATTERN).optional(),
          at: z.string().optional(),
          tool_index: z.number().int().min(0).optional(),
        }),
      )
      .min(1)
      .optional(),
    artifact_hash: z.string().regex(SHA256_PATTERN),
    artifact_uri: z.string().optional(),
    aup_uri: z.string().optional(),
    policy_compliant: z
      .object({
        declared: z.boolean(),
        reason: z.string().min(1).optional(),
      })
      .optional(),
    signed_by_student: z.literal(true),
    student_signature_at: z.string(),
    teacher_acknowledged: z
      .object({
        acknowledged: z.boolean(),
        by: z.string().min(1),
        at: z.string(),
        note: z.string().min(1).optional(),
      })
      .optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    // Conditional rule: ai_used true ⇒ tools_used / roles / assistance_extent / prompt_evidence_mode required.
    if (doc.ai_used) {
      const missing: string[] = [];
      if (!doc.tools_used || doc.tools_used.length === 0) missing.push("tools_used");
      if (!doc.roles || doc.roles.length === 0) missing.push("roles");
      if (!doc.assistance_extent) missing.push("assistance_extent");
      if (!doc.prompt_evidence_mode) missing.push("prompt_evidence_mode");
      if (missing.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `ai_used=true requires fields: ${missing.join(", ")}`,
        });
      }
    } else {
      // ai_used false ⇒ AI-only fields MUST NOT be present.
      const forbidden: string[] = [];
      if (doc.tools_used !== undefined) forbidden.push("tools_used");
      if (doc.roles !== undefined) forbidden.push("roles");
      if (doc.assistance_extent !== undefined) forbidden.push("assistance_extent");
      if (doc.assistance_pct !== undefined) forbidden.push("assistance_pct");
      if (doc.prompt_evidence_mode !== undefined) forbidden.push("prompt_evidence_mode");
      if (doc.prompts !== undefined) forbidden.push("prompts");
      if (forbidden.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `ai_used=false forbids fields: ${forbidden.join(", ")}`,
        });
      }
    }
    // Conditional rule: prompt_evidence_mode in {full, hashed} ⇒ prompts present.
    if (
      doc.prompt_evidence_mode === "full" ||
      doc.prompt_evidence_mode === "hashed"
    ) {
      if (!doc.prompts || doc.prompts.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `prompt_evidence_mode=${doc.prompt_evidence_mode} requires prompts[]`,
        });
      } else {
        const field = doc.prompt_evidence_mode === "full" ? "text" : "hash";
        const opposite = doc.prompt_evidence_mode === "full" ? "hash" : "text";
        for (let i = 0; i < doc.prompts.length; i++) {
          const p = doc.prompts[i]!;
          if (p[field as "text" | "hash"] === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `prompts[${i}] missing required '${field}' (mode=${doc.prompt_evidence_mode})`,
            });
          }
          if (p[opposite as "text" | "hash"] !== undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `prompts[${i}] must not include '${opposite}' (mode=${doc.prompt_evidence_mode})`,
            });
          }
        }
      }
    }
    if (doc.prompt_evidence_mode === "omitted" && doc.prompts !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "prompt_evidence_mode=omitted forbids prompts[]",
      });
    }
    // Conditional rule: roles contains 'other' ⇒ roles_other_text required.
    if (doc.roles?.includes("other") && !doc.roles_other_text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "roles contains 'other' but roles_other_text is missing",
      });
    }
  });

export type StudentDisclosure = z.infer<typeof studentDisclosureSchema>;
