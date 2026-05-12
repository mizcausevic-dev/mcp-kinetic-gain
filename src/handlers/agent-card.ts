import { agentCardSchema } from "../schemas.js";
import { errorJson, fetchJson, pretty, stripTrailingSlashes } from "../common.js";

export function agentCardWellKnownUrl(origin: string, agent_id: string): string {
  return `${stripTrailingSlashes(origin)}/.well-known/agents/${encodeURIComponent(agent_id)}.json`;
}

async function loadDoc(args: {
  url?: string;
  document_json?: string;
}): Promise<ReturnType<typeof agentCardSchema.parse>> {
  if (args.document_json) {
    return agentCardSchema.parse(JSON.parse(args.document_json));
  }
  if (args.url) {
    return agentCardSchema.parse(await fetchJson(args.url));
  }
  throw new Error("must provide either `url` or `document_json`");
}

export async function handleAgentCardWellKnownUrl(args: {
  origin: string;
  agent_id: string;
}): Promise<string> {
  return pretty({ url: agentCardWellKnownUrl(args.origin, args.agent_id) });
}

export async function handleAgentCardInspect(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const doc = await loadDoc(args);
  return pretty({
    agent_card_version: doc.agent_card_version,
    agent: { id: doc.agent.id, name: doc.agent.name, version: doc.agent.version, provider: doc.agent.provider },
    primary_purpose: doc.capabilities.primary_purpose,
    autonomy_level: doc.capabilities.autonomy_level,
    memory_persistence: doc.capabilities.memory_persistence,
    max_context_tokens: doc.capabilities.max_context_tokens,
    model_count: doc.capabilities.models_used.length,
    tool_count: doc.capabilities.tools?.length ?? 0,
    refusal_category_count: doc.refusal_taxonomy.length,
    deployment_environment: doc.deployment.environment,
    requires_human_in_loop_for: doc.safety_posture.human_in_loop_required,
  });
}

export async function handleAgentCardToolDisclosure(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const doc = await loadDoc(args);
  if (!doc.capabilities.tools || doc.capabilities.tools.length === 0) {
    return errorJson("no_tools_declared", { agent_id: doc.agent.id });
  }
  return pretty({
    agent_id: doc.agent.id,
    tools: doc.capabilities.tools.map((t) => ({
      name: t.name,
      side_effects: t.side_effects,
      mcp_tool_card_uri: t.mcp_tool_card_uri ?? null,
    })),
  });
}

export async function handleAgentCardValidate(args: {
  document_json: string;
}): Promise<string> {
  try {
    const doc = agentCardSchema.parse(JSON.parse(args.document_json));
    return pretty({ valid: true, agent_id: doc.agent.id, version: doc.agent.version });
  } catch (err) {
    return pretty({ valid: false, reason: err instanceof Error ? err.message : String(err) });
  }
}
