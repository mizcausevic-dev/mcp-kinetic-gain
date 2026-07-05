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

// ----------------------------------------------------------------------------
// Classroom AI AUP (EdTech extension of the Suite)
// ----------------------------------------------------------------------------
const ROLE_ENUM = [
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
] as const;

export const classroomAupSchema = z
  .object({
    aup_version: z.string(),
    policy_id: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
    policy_name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+].+)?$/),
    effective_at: z.string(),
    expires_at: z.string().optional(),
    replaces: z.string().optional(),
    scope: z.object({
      type: z.enum(["district", "school", "course", "assignment"]),
      institution_id: z.string().min(1),
      grade_bands: z
        .array(z.enum(["K-5", "6-8", "9-12", "undergrad", "grad", "adult-ed"]))
        .optional(),
      course_ids: z.array(z.string().min(1)).optional(),
      assignment_ids: z.array(z.string().min(1)).optional(),
      parent_policy_uri: z.string().optional(),
    }),
    permitted_use: z.object({
      permitted_roles: z.array(z.enum(ROLE_ENUM)),
      permitted_tool_categories: z
        .array(
          z.enum([
            "text_chat",
            "tutoring",
            "code_assistant",
            "image_generation",
            "translation",
            "research_synthesis",
            "data_analysis",
            "general",
          ]),
        )
        .optional(),
      permitted_tools: z
        .array(
          z.object({
            name: z.string().min(1),
            agent_card_uri: z.string().optional(),
            tutor_card_uri: z.string().optional(),
            notes: z.string().min(1).optional(),
          }),
        )
        .optional(),
      assistance_extent_max: z.enum(["none", "minor", "substantial", "primary_author"]),
    }),
    prohibited_use: z
      .object({
        prohibited_roles: z.array(z.enum(ROLE_ENUM)).optional(),
        prohibited_uses: z.array(z.string().min(1)).optional(),
      })
      .optional(),
    disclosure_requirements: z.object({
      required_when: z.enum(["always", "when_used", "never"]),
      required_prompt_evidence_mode: z
        .enum(["full", "hashed", "omitted", "any"])
        .optional(),
      signature_required: z.boolean(),
      teacher_acknowledgment_required: z.boolean().optional(),
      artifact_hash_required: z.boolean().optional(),
    }),
    supervision: z
      .object({
        level: z.enum(["unsupervised", "teacher_visible", "teacher_approved", "proctored"]),
        human_in_loop_categories: z.array(z.string().min(1)).optional(),
      })
      .optional(),
    vendor_requirements: z
      .object({
        requires_tutor_card: z.boolean().optional(),
        requires_agent_card: z.boolean().optional(),
        required_compliance: z
          .array(z.enum(["ferpa", "coppa", "gdpr", "state-specific"]))
          .optional(),
        state_specific_laws: z.array(z.string().min(1)).optional(),
        required_content_filter_strength_min: z.enum(["strict", "moderate", "light"]).optional(),
        requires_mandated_reporter_protocol: z.boolean().optional(),
        requires_human_in_loop_for: z.array(z.string().min(1)).optional(),
        retention_days_max: z.number().int().min(0).optional(),
        prohibits_third_party_data_sharing: z.boolean().optional(),
        prohibits_model_training_on_student_data: z.boolean().optional(),
      })
      .optional(),
    parent_notification: z
      .object({
        notification_level: z.enum(["none", "at_enrollment", "per_assignment", "per_use"]),
        parent_consent_required: z.boolean(),
        consent_age_threshold: z.number().int().min(0).max(25).optional(),
      })
      .optional(),
    enforcement: z
      .object({
        violation_response: z.array(z.string().min(1)).optional(),
        appeals_process_uri: z.string().optional(),
      })
      .optional(),
    published_by: z.object({
      name: z.string().min(1),
      role: z.string().min(1).optional(),
      contact_uri: z.string().optional(),
    }),
    published_at: z.string(),
    audit_log_uri: z.string().optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    // Scope completeness
    if (doc.scope.type === "course" && (!doc.scope.course_ids || doc.scope.course_ids.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "scope.type=course requires non-empty course_ids" });
    }
    if (doc.scope.type === "assignment" && (!doc.scope.assignment_ids || doc.scope.assignment_ids.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "scope.type=assignment requires non-empty assignment_ids" });
    }
    // Extent vs. roles
    if (doc.permitted_use.assistance_extent_max === "none" && doc.permitted_use.permitted_roles.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "assistance_extent_max=none forbids any permitted_roles (must be empty)",
      });
    }
    // Effective window
    if (doc.expires_at && doc.expires_at <= doc.effective_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expires_at must be strictly after effective_at",
      });
    }
    // Role disjointness
    if (doc.prohibited_use?.prohibited_roles) {
      const overlap = doc.prohibited_use.prohibited_roles.filter((r) =>
        doc.permitted_use.permitted_roles.includes(r),
      );
      if (overlap.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Roles cannot be both permitted and prohibited: ${overlap.join(", ")}`,
        });
      }
    }
  });

export type ClassroomAup = z.infer<typeof classroomAupSchema>;

// ----------------------------------------------------------------------------
// Clinical AI Disclosure (HealthTech extension)
// ----------------------------------------------------------------------------
export const clinicalAiCardSchema = z
  .object({
    clinical_ai_card_version: z.string(),
    system: z.object({
      id: z.string(),
      name: z.string(),
      version: z.string(),
      provider: z.string(),
      homepage: z.string().optional(),
      description: z.string(),
    }),
    clinical_context: z.object({
      indication: z.string(),
      care_settings: z.array(
        z.enum([
          "inpatient", "outpatient", "icu", "ed", "home", "telehealth",
          "research", "pharmacy", "radiology", "pathology",
        ]),
      ).min(1),
      patient_population: z.object({
        age_range_min: z.number().int().min(0),
        age_range_max: z.number().int().max(130),
        exclusions: z.array(z.string()).optional(),
      }),
      intended_use: z.string(),
      off_label_uses_prohibited: z.boolean(),
    }),
    regulatory: z.object({
      fda_status: z.enum([
        "510k_cleared", "de_novo", "pma", "enforcement_discretion",
        "research_use_only", "not_applicable",
      ]),
      fda_clearance_number: z.string().optional(),
      fda_clearance_uri: z.string().optional(),
      iso_certifications: z.array(z.string()).optional(),
      is_medical_device: z.boolean(),
      is_clinical_decision_support: z.boolean(),
      is_software_as_medical_device: z.boolean(),
      samd_class: z.enum(["I", "II", "III", "IV"]).optional(),
      samd_classification_rationale: z.string().optional(),
      regional_authorizations: z.array(z.object({
        region: z.string(),
        status: z.string(),
        identifier: z.string().optional(),
        uri: z.string().optional(),
      })).optional(),
      notes: z.string().optional(),
    }),
    clinical_role: z.object({
      decision_support_level: z.enum(["informational", "advisory", "autonomous"]),
      clinician_override_required: z.boolean(),
      patient_facing_only: z.boolean(),
      transparency_to_patient_required: z.boolean(),
      pre_authorization_use: z.boolean().optional(),
    }),
    evidence: z.object({
      validation_studies: z.array(z.object({
        title: z.string(),
        uri: z.string(),
        population_size: z.number().int().min(1),
        primary_outcome: z.string(),
        results_summary: z.string(),
        peer_reviewed: z.boolean(),
        published_at: z.string().optional(),
      })).min(1),
      training_data_sources: z.array(z.string()).min(1),
      bias_audit_uri: z.string().optional(),
      performance_metrics: z.object({
        measurement_population: z.string(),
        sensitivity: z.number().min(0).max(1).optional(),
        specificity: z.number().min(0).max(1).optional(),
        auc: z.number().min(0).max(1).optional(),
        accuracy: z.number().min(0).max(1).optional(),
        false_positive_rate: z.number().min(0).max(1).optional(),
        false_negative_rate: z.number().min(0).max(1).optional(),
        precision: z.number().min(0).max(1).optional(),
        recall: z.number().min(0).max(1).optional(),
        f1: z.number().min(0).max(1).optional(),
        ppv: z.number().min(0).max(1).optional(),
        npv: z.number().min(0).max(1).optional(),
      }),
    }),
    patient_data: z.object({
      phi_processed: z.boolean(),
      hipaa_compliant: z.boolean().optional(),
      baa_required: z.boolean().optional(),
      de_identification_method: z.enum([
        "safe-harbor", "expert-determination", "none", "not-applicable",
      ]).optional(),
      retention_days: z.number().int().min(0),
      patient_consent_required: z.boolean(),
      consent_flow_uri: z.string().optional(),
      third_party_data_sharing: z.boolean(),
      model_training_consent_required: z.boolean().optional(),
    }),
    safety: z.object({
      human_in_loop_required_for: z.array(z.string()),
      escalation_protocols: z.array(z.string()).optional(),
      mandatory_reporting_categories: z.array(z.string()),
      blocks_diagnostic_claims: z.boolean().optional(),
      treatment_recommendation_disclaimer_required: z.boolean().optional(),
    }),
    ehr_integration: z.object({
      fhir_version: z.enum(["R4", "R5", "STU3", "DSTU2"]).optional(),
      supports_smart_on_fhir: z.boolean().optional(),
      supports_cds_hooks: z.boolean().optional(),
      ehr_vendors_supported: z.array(z.string()).optional(),
    }).optional(),
    agent_card_uri: z.string().optional(),
    evaluations: z.array(z.object({
      suite: z.string(),
      result_uri: z.string(),
      metrics: z.record(z.unknown()).optional(),
      ran_at: z.string(),
      accreditation_body: z.string().optional(),
    })).optional(),
    audit: z.object({
      audit_log_uri: z.string().optional(),
      incident_response_uri: z.string().optional(),
      incident_card_index_uri: z.string().optional(),
      disclosure_uri: z.string().optional(),
    }).optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    // Headline rule: autonomy ⇔ medical device
    if (doc.clinical_role.decision_support_level === "autonomous" && !doc.regulatory.is_medical_device) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "SPEC RULE: decision_support_level=autonomous requires is_medical_device=true (FDA position)",
      });
    }
    // SaMD completeness
    if (doc.regulatory.is_software_as_medical_device) {
      if (!doc.regulatory.samd_class || !doc.regulatory.samd_classification_rationale) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "SaMD requires both samd_class and samd_classification_rationale",
        });
      }
    }
    // FDA clearance documentation
    if (["510k_cleared", "de_novo", "pma"].includes(doc.regulatory.fda_status)) {
      if (!doc.regulatory.fda_clearance_number || !doc.regulatory.fda_clearance_uri) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `fda_status=${doc.regulatory.fda_status} requires fda_clearance_number + fda_clearance_uri`,
        });
      }
    }
    // PHI gating
    if (doc.patient_data.phi_processed) {
      if (doc.patient_data.hipaa_compliant === undefined || doc.patient_data.baa_required === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "phi_processed=true requires explicit hipaa_compliant and baa_required",
        });
      }
    }
    // Bias audit triggers
    const triggers: string[] = [];
    if (doc.regulatory.samd_class && ["II", "III", "IV"].includes(doc.regulatory.samd_class)) {
      triggers.push(`samd_class=${doc.regulatory.samd_class}`);
    }
    if (doc.clinical_role.decision_support_level === "autonomous") triggers.push("decision_support_level=autonomous");
    if (doc.clinical_role.pre_authorization_use) triggers.push("pre_authorization_use=true");
    if (triggers.length > 0 && !doc.evidence.bias_audit_uri) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `bias_audit_uri is required when: ${triggers.join(", ")}`,
      });
    }
  });

export type ClinicalAiCard = z.infer<typeof clinicalAiCardSchema>;

// ----------------------------------------------------------------------------
// AI Incident Card (cross-cutting)
// ----------------------------------------------------------------------------
export const aiIncidentCardSchema = z
  .object({
    incident_card_version: z.string(),
    incident: z.object({
      id: z.string(),
      title: z.string(),
      severity: z.enum(["low", "medium", "high", "critical"]),
      categories: z.array(z.enum([
        "misinformation", "pii_leak", "bias", "copyright_violation",
        "mandated_reporter_failure", "prompt_injection_success", "tool_abuse",
        "jailbreak_success", "hallucination_with_consequences",
        "refusal_taxonomy_violation", "content_filter_failure",
        "availability_outage", "tampering", "other",
      ])).min(1),
      discovered_at: z.string(),
      occurred_at: z.string().optional(),
      disclosed_at: z.string(),
      resolved_at: z.string().optional(),
      status: z.enum(["active", "mitigated", "resolved", "withdrawn"]),
    }),
    categories_other_text: z.string().optional(),
    affected: z.object({
      vendor: z.string(),
      products: z.array(z.string()).min(1),
      versions: z.array(z.string()).optional(),
      agent_card_uris: z.array(z.string()).optional(),
      tutor_card_uris: z.array(z.string()).optional(),
      tool_card_uris: z.array(z.string()).optional(),
      affected_user_count: z.object({
        kind: z.enum(["exact", "approximate", "unknown"]),
        count: z.number().int().min(0).optional(),
      }).optional(),
      affected_populations: z.array(z.string()).optional(),
    }),
    summary: z.string(),
    root_cause: z.object({
      category: z.enum([
        "training_data", "prompt_injection", "tool_abuse",
        "refusal_taxonomy_gap", "content_filter_gap", "retrieval_failure",
        "evaluation_gap", "deployment_misconfiguration", "supply_chain", "other",
      ]),
      description: z.string(),
      category_other_text: z.string().optional(),
    }),
    harm: z.object({
      severity_justification: z.string(),
      manifested: z.boolean(),
      narrative: z.string().optional(),
    }),
    mitigation: z.object({
      actions_taken: z.array(z.string()).min(1),
      permanent_fix: z.boolean(),
      rollout_status: z.enum(["planned", "in_progress", "deployed"]),
      workaround_for_users: z.string().optional(),
    }),
    evidence: z.object({
      evidence_uris: z.array(z.string()).optional(),
      prompt_provenance_uri: z.string().optional(),
      reproduction_uri: z.string().optional(),
      internal_postmortem_uri: z.string().optional(),
    }).optional(),
    references: z.array(z.object({
      type: z.enum(["blog_post", "regulatory_filing", "academic_paper", "press_release", "customer_notice", "other"]),
      title: z.string(),
      uri: z.string(),
      published_at: z.string().optional(),
    })).optional(),
    regulatory: z.object({
      reported_to: z.array(z.enum([
        "eu-ai-act-art-73", "us-omb-m-24-10", "ferpa", "coppa", "hipaa",
        "gdpr", "state-attorney-general", "fda-21-cfr-11", "other",
      ])).optional(),
      reporting_deadline_met: z.boolean().optional(),
      regulatory_filing_uris: z.array(z.string()).optional(),
      not_reportable_justification: z.string().optional(),
    }).optional(),
    withdrawal: z.object({
      withdrawn_at: z.string(),
      reason: z.string(),
      replacement_incident_uri: z.string().optional(),
    }).optional(),
    published_by: z.object({
      name: z.string(),
      role: z.enum(["vendor", "third-party-researcher", "user", "regulator", "auditor"]),
      contact_uri: z.string().optional(),
      pgp_fingerprint: z.string().optional(),
    }),
    published_at: z.string(),
    last_updated_at: z.string(),
    revision: z.object({
      number: z.number().int().min(1),
      change_summary: z.string(),
    }).optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    // Resolved requires resolved_at
    if (doc.incident.status === "resolved" && !doc.incident.resolved_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status=resolved requires resolved_at",
      });
    }
    // Withdrawn requires withdrawal block
    if (doc.incident.status === "withdrawn" && !doc.withdrawal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status=withdrawn requires withdrawal block",
      });
    }
    // Regulatory filings require URIs
    if (doc.regulatory?.reported_to && doc.regulatory.reported_to.length > 0) {
      if (!doc.regulatory.regulatory_filing_uris || doc.regulatory.regulatory_filing_uris.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "non-empty regulatory.reported_to requires non-empty regulatory_filing_uris",
        });
      }
    }
    // root_cause=other requires text
    if (doc.root_cause.category === "other" && !doc.root_cause.category_other_text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "root_cause.category=other requires category_other_text",
      });
    }
    // categories contains "other" requires top-level text
    if (doc.incident.categories.includes("other") && !doc.categories_other_text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "incident.categories containing 'other' requires top-level categories_other_text",
      });
    }
  });

export type AiIncidentCard = z.infer<typeof aiIncidentCardSchema>;

// Index format at /.well-known/ai-incidents.json — array of compact entries.
export const aiIncidentIndexSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string().optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    status: z.enum(["active", "mitigated", "resolved", "withdrawn"]).optional(),
    disclosed_at: z.string().optional(),
    uri: z.string().optional(),
  }),
);
export type AiIncidentIndex = z.infer<typeof aiIncidentIndexSchema>;

// ============================================================================
// AI Procurement Decision Card — buyer-side artifact (spec #11)
// ============================================================================
export const decisionCardSchema = z
  .object({
    decision_card_version: z.literal("0.1"),
    decision_id: z.string().min(1).max(128),
    issued_at: z.string(),
    buyer: z.object({
      name: z.string().min(1),
      type: z.enum([
        "organization", "agency", "school-district", "school", "hospital",
        "health-system", "research-institution", "auditor", "individual",
      ]),
      category: z.string().optional(),
      jurisdiction: z.string().optional(),
      url: z.string().optional(),
      contact: z.string().optional(),
      id: z.string().optional(),
    }).strict(),
    decision_maker: z.object({
      role: z.string().min(1),
      name: z.string().optional(),
      department: z.string().optional(),
      authority: z.string().optional(),
    }).strict().optional(),
    decision: z.object({
      status: z.enum([
        "approved", "approved-with-conditions",
        "rejected", "rejected-with-remediation",
        "pending", "withdrawn", "expired",
      ]),
      effective_from: z.string().optional(),
      effective_until: z.string().optional(),
      scope: z.string().optional(),
    }).strict(),
    subject: z.object({
      vendor_name: z.string().min(1),
      product_name: z.string().optional(),
      vendor_id: z.string().optional(),
      documents_reviewed: z.array(
        z.object({
          type: z.enum([
            "aeo", "prompt-provenance", "agent-card", "ai-evidence",
            "tool-card", "tutor-card", "student-ai-disclosure",
            "classroom-aup", "clinical-ai-card", "incident-card", "other",
          ]),
          url: z.string(),
          fetched_at: z.string().optional(),
          content_hash: z.string().optional(),
          version: z.string().optional(),
        }).strict(),
      ).optional(),
    }).strict(),
    criteria: z.object({
      policy_uris: z.array(z.string()).optional(),
      rubric: z.array(
        z.object({
          id: z.string().min(1),
          description: z.string().optional(),
          weight: z.number().min(0).max(1).optional(),
          result: z.enum(["pass", "pass-with-condition", "partial", "fail", "n/a"]),
          notes: z.string().optional(),
        }).strict(),
      ).optional(),
    }).strict().optional(),
    conditions: z.array(
      z.object({
        id: z.string().min(1),
        description: z.string().min(1),
        enforcement: z.enum([
          "contractual", "technical", "audit", "self-attestation", "regulatory", "other",
        ]).optional(),
        violation_response: z.string().optional(),
        verification_uri: z.string().optional(),
      }).strict(),
    ).optional(),
    rationale: z.string().min(1),
    history: z.array(
      z.object({
        event: z.enum([
          "review_started", "documents_collected", "review_completed",
          "approved", "approved-with-conditions",
          "rejected", "rejected-with-remediation",
          "pending", "withdrawn", "expired", "appealed", "amended", "other",
        ]),
        at: z.string(),
        actor: z.string().optional(),
        note: z.string().optional(),
      }).strict(),
    ).optional(),
    appeals: z.object({
      deadline: z.string().optional(),
      process_uri: z.string().optional(),
      contact: z.string().optional(),
    }).strict().optional(),
    publication: z.object({
      publication_uri: z.string().optional(),
      is_public: z.boolean().optional(),
      visibility_notes: z.string().optional(),
    }).strict().optional(),
    signatures: z.array(
      z.object({
        signer: z.string().min(1),
        signed_at: z.string(),
        method: z.enum(["digital", "wet-ink", "electronic-attestation", "cryptographic", "other"]).optional(),
        key_uri: z.string().optional(),
        signature_value: z.string().optional(),
      }).strict(),
    ).optional(),
    withdrawal: z.object({
      at: z.string(),
      reason: z.string().min(1),
      replaces: z.string().optional(),
    }).strict().optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    // status=approved-with-conditions or rejected-with-remediation requires conditions array with ≥1 entry
    if (
      (doc.decision.status === "approved-with-conditions" || doc.decision.status === "rejected-with-remediation")
      && (!doc.conditions || doc.conditions.length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conditions"],
        message: `decision.status=${doc.decision.status} requires at least one entry in conditions`,
      });
    }
    // status=withdrawn requires withdrawal block
    if (doc.decision.status === "withdrawn" && !doc.withdrawal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["withdrawal"],
        message: "decision.status=withdrawn requires a withdrawal block (at + reason)",
      });
    }
    // publication.is_public=true requires publication_uri
    if (doc.publication?.is_public === true && !doc.publication?.publication_uri) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publication", "publication_uri"],
        message: "publication.is_public=true requires publication.publication_uri",
      });
    }
  });

export type DecisionCard = z.infer<typeof decisionCardSchema>;

// ---------------------------------------------------------------------------
// AI Claims Decision Card (InsurTech) — 12th Suite spec.
// Buyer/insurer-side artifact: records that an AI system adjudicated an
// insurance claim, with a signed, hash-chained evidence bundle. Detection key
// is `claims_card_version` (distinct from decision_card_version). Mirrors
// github.com/mizcausevic-dev/ai-claims-decision-card-spec v0.1.
// ---------------------------------------------------------------------------
export const claimsCardSchema = z.object({
  claims_card_version: z.literal("0.1"),
  claim: z.object({
    claim_id: z.string().min(1),
    policy_id: z.string().min(1),
    claimant_ref: z.string().min(1),
    claim_type: z.enum(["property_damage", "medical", "auto", "life", "liability", "other"]),
    filed_at: z.string(),
  }),
  decision: z.object({
    outcome: z.enum(["approve", "deny", "pend", "refer"]),
    reasons: z.array(z.string().min(1)).min(1),
    rule_refs: z.array(z.string()),
    coverage: z.object({
      covered: z.boolean(),
      amount: z.number().nullable(),
      currency: z.string(),
    }),
  }),
  evidence_bundle: z.object({
    sources: z
      .array(
        z.object({
          source_id: z.string().min(1),
          source_type: z.enum([
            "document", "image", "database_record", "external_api", "structured_data",
          ]),
          content_hash: z.string().regex(/^[a-f0-9]{64}$/),
          retrieval_confidence: z.number().min(0).max(1),
          synthesis_role: z.enum(["primary", "supporting", "excluded"]),
        }),
      )
      .min(1),
    model: z.object({
      model_id: z.string().min(1),
      model_version: z.string().min(1),
      provider: z.string().min(1),
    }),
    synthesis_method: z.string().min(1),
  }),
  governance: z.object({
    underwriting_rules_version: z.string().min(1),
    jurisdiction: z.string().min(2),
    regulatory_refs: z.array(z.string()),
    human_in_loop: z.boolean(),
    reviewer_ref: z.string().nullable(),
  }),
  attestation: z.object({
    card_hash: z.string().regex(/^[a-f0-9]{64}$/),
    signature: z.string().regex(/^[a-f0-9]{128}$/),
    algorithm: z.literal("ed25519"),
    signing_key_id: z.string().min(1),
    signed_at: z.string(),
    chain_index: z.number().int().min(0),
    prev_card_hash: z.string().length(64).nullable(),
  }),
  disclaimer: z.string().min(20),
});

export type ClaimsCard = z.infer<typeof claimsCardSchema>;
