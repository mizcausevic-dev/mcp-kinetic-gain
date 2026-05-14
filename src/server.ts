#!/usr/bin/env node
/**
 * Unified MCP server for the Kinetic Gain Protocol Suite.
 *
 * v0.5.1: Same 43-tool MCP surface as v0.5.0, plus a CLI mode.
 *   `mcp-kinetic-gain validate <paths...>` validates Suite JSON files
 *   against the bundled zod schemas. No-arg invocation still launches the
 *   stdio MCP server (unchanged for existing Claude Desktop / Cursor configs).
 *
 * v0.5.0: Exposes 43 tools across all ten specs:
 *   - AEO Protocol            (4 tools)
 *   - Prompt Provenance       (3 tools)
 *   - Agent Cards             (4 tools)
 *   - AI Evidence Format      (3 tools)
 *   - MCP Tool Cards          (4 tools)
 *   - AI Tutor Cards          (6 tools — EdTech extension)
 *   - Student AI Disclosure   (5 tools — EdTech extension)
 *   - Classroom AI AUP        (5 tools — EdTech extension, closes the EdTech trio)
 *   - Clinical AI Disclosure  (4 tools — HealthTech extension)
 *   - AI Incident Card        (5 tools — cross-cutting, includes index_fetch)
 *
 * Drop into Claude Desktop / Cursor / any MCP-compatible client via stdio.
 */
import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { toolDescriptors } from "./tools.js";

import {
  handleAeoFetch,
  handleAeoGetClaim,
  handleAeoInspect,
  handleAeoWellKnownUrl,
} from "./handlers/aeo.js";

import {
  handlePromptProvenanceEvalResult,
  handlePromptProvenanceInspect,
  handlePromptProvenanceValidate,
} from "./handlers/prompt-provenance.js";

import {
  handleAgentCardInspect,
  handleAgentCardToolDisclosure,
  handleAgentCardValidate,
  handleAgentCardWellKnownUrl,
} from "./handlers/agent-card.js";

import {
  handleAiEvidenceInspect,
  handleAiEvidenceValidate,
  handleAiEvidenceVerifyHash,
} from "./handlers/ai-evidence.js";

import {
  handleToolCardInspect,
  handleToolCardTestedWith,
  handleToolCardValidate,
  handleToolCardWellKnownUrl,
} from "./handlers/tool-card.js";

import {
  handleTutorCardCoppaCheck,
  handleTutorCardFetch,
  handleTutorCardInspect,
  handleTutorCardSubjectCheck,
  handleTutorCardValidate,
  handleTutorCardWellKnownUrl,
} from "./handlers/tutor-card.js";

import {
  handleDisclosureAupCheck,
  handleDisclosureInspect,
  handleDisclosureValidate,
  handleDisclosureVerifyArtifactHash,
  handleDisclosureVerifyPromptHash,
} from "./handlers/disclosure.js";

import {
  handleClassroomAupCheckCompliance,
  handleClassroomAupFetch,
  handleClassroomAupInspect,
  handleClassroomAupValidate,
  handleClassroomAupWellKnownUrl,
} from "./handlers/classroom-aup.js";

import {
  handleClinicalAiFetch,
  handleClinicalAiInspect,
  handleClinicalAiValidate,
  handleClinicalAiWellKnownUrl,
} from "./handlers/clinical-ai.js";

import {
  handleIncidentFetch,
  handleIncidentIndexFetch,
  handleIncidentInspect,
  handleIncidentValidate,
  handleIncidentWellKnownUrl,
} from "./handlers/ai-incident.js";

export const handlers: Record<string, (args: any) => Promise<string>> = {
  // AEO
  aeo_fetch: handleAeoFetch,
  aeo_inspect: handleAeoInspect,
  aeo_get_claim: handleAeoGetClaim,
  aeo_well_known_url: handleAeoWellKnownUrl,
  // Prompt Provenance
  prompt_provenance_validate: handlePromptProvenanceValidate,
  prompt_provenance_inspect: handlePromptProvenanceInspect,
  prompt_provenance_eval_result: handlePromptProvenanceEvalResult,
  // Agent Cards
  agent_card_well_known_url: handleAgentCardWellKnownUrl,
  agent_card_inspect: handleAgentCardInspect,
  agent_card_tool_disclosure: handleAgentCardToolDisclosure,
  agent_card_validate: handleAgentCardValidate,
  // AI Evidence
  ai_evidence_validate: handleAiEvidenceValidate,
  ai_evidence_inspect: handleAiEvidenceInspect,
  ai_evidence_verify_hash: handleAiEvidenceVerifyHash,
  // MCP Tool Cards
  tool_card_well_known_url: handleToolCardWellKnownUrl,
  tool_card_inspect: handleToolCardInspect,
  tool_card_tested_with: handleToolCardTestedWith,
  tool_card_validate: handleToolCardValidate,
  // AI Tutor Cards (EdTech extension)
  tutor_card_well_known_url: handleTutorCardWellKnownUrl,
  tutor_card_fetch: handleTutorCardFetch,
  tutor_card_validate: handleTutorCardValidate,
  tutor_card_inspect: handleTutorCardInspect,
  tutor_card_subject_check: handleTutorCardSubjectCheck,
  tutor_card_coppa_check: handleTutorCardCoppaCheck,
  // Student AI Disclosure (EdTech extension)
  disclosure_validate: handleDisclosureValidate,
  disclosure_inspect: handleDisclosureInspect,
  disclosure_verify_artifact_hash: handleDisclosureVerifyArtifactHash,
  disclosure_verify_prompt_hash: handleDisclosureVerifyPromptHash,
  disclosure_aup_check: handleDisclosureAupCheck,
  // Classroom AI AUP (EdTech extension — closes the trio)
  aup_well_known_url: handleClassroomAupWellKnownUrl,
  aup_fetch: handleClassroomAupFetch,
  aup_validate: handleClassroomAupValidate,
  aup_inspect: handleClassroomAupInspect,
  aup_check_compliance: handleClassroomAupCheckCompliance,
  // Clinical AI Disclosure (HealthTech extension)
  clinical_ai_well_known_url: handleClinicalAiWellKnownUrl,
  clinical_ai_fetch: handleClinicalAiFetch,
  clinical_ai_validate: handleClinicalAiValidate,
  clinical_ai_inspect: handleClinicalAiInspect,
  // AI Incident Card (cross-cutting)
  incident_well_known_url: handleIncidentWellKnownUrl,
  incident_fetch: handleIncidentFetch,
  incident_validate: handleIncidentValidate,
  incident_inspect: handleIncidentInspect,
  incident_index_fetch: handleIncidentIndexFetch,
};

export function buildServer(): Server {
  const server = new Server(
    { name: "mcp-kinetic-gain", version: "0.5.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDescriptors,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = handlers[name];
    if (!handler) {
      return {
        content: [{ type: "text", text: `unknown tool: ${name}` }],
        isError: true,
      };
    }
    try {
      const result = await handler(args ?? {});
      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  });

  return server;
}

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `mcp-kinetic-gain v0.5.1: listening on stdio (${toolDescriptors.length} tools across 10 specs)\n`,
  );
}

// Robust entry-point check that works on Windows + Unix. The previous
// `file://${argv[1]}` string comparison failed on Windows because Node emits
// `file:///C:/...` (three slashes) for absolute Windows paths.
const isEntryPoint = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return pathToFileURL(arg).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  // Dispatch CLI subcommands (validate, --help, --version) before falling
  // through to MCP stdio server mode. Keeps the no-arg invocation behavior
  // identical to pre-0.5.1 for existing Claude Desktop / Cursor configs.
  const { dispatchCli } = await import("./cli.js");
  const dispatched = await dispatchCli(process.argv);
  if (dispatched.handled) {
    process.exit(dispatched.exitCode ?? 0);
  }
  main().catch((err) => {
    process.stderr.write(`mcp-kinetic-gain: fatal: ${err}\n`);
    process.exit(1);
  });
}
