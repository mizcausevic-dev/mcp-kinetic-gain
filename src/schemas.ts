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
