#!/usr/bin/env node
/**
 * Unified MCP server for the Kinetic Gain Protocol Suite.
 *
 * Exposes 18 tools across five specs:
 *   - AEO Protocol            (4 tools)
 *   - Prompt Provenance       (3 tools)
 *   - Agent Cards             (4 tools)
 *   - AI Evidence Format      (3 tools)
 *   - MCP Tool Cards          (4 tools)
 *
 * Drop into Claude Desktop / Cursor / any MCP-compatible client via stdio.
 */
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
};

export function buildServer(): Server {
  const server = new Server(
    { name: "mcp-kinetic-gain", version: "0.1.0" },
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
    `mcp-kinetic-gain v0.1.0: listening on stdio (${toolDescriptors.length} tools across 5 specs)\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  main().catch((err) => {
    process.stderr.write(`mcp-kinetic-gain: fatal: ${err}\n`);
    process.exit(1);
  });
}
