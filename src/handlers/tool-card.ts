import { mcpToolCardSchema } from "../schemas.js";
import { errorJson, fetchJson, pretty, stripTrailingSlashes } from "../common.js";

export function toolCardWellKnownUrl(mcp_server_origin: string, tool_name: string): string {
  return `${stripTrailingSlashes(mcp_server_origin)}/.well-known/mcp-tools/${encodeURIComponent(tool_name)}.json`;
}

async function loadDoc(args: {
  url?: string;
  document_json?: string;
}): Promise<ReturnType<typeof mcpToolCardSchema.parse>> {
  if (args.document_json) {
    return mcpToolCardSchema.parse(JSON.parse(args.document_json));
  }
  if (args.url) {
    return mcpToolCardSchema.parse(await fetchJson(args.url));
  }
  throw new Error("must provide either `url` or `document_json`");
}

export async function handleToolCardWellKnownUrl(args: {
  mcp_server_origin: string;
  tool_name: string;
}): Promise<string> {
  return pretty({ url: toolCardWellKnownUrl(args.mcp_server_origin, args.tool_name) });
}

export async function handleToolCardInspect(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const doc = await loadDoc(args);
  return pretty({
    tool_card_version: doc.tool_card_version,
    tool: {
      server_id: doc.tool.server_id,
      name: doc.tool.name,
      version: doc.tool.version,
      mcp_server_uri: doc.tool.mcp_server_uri,
    },
    side_effect_class: doc.safety.side_effect_class,
    reversible: doc.safety.reversible,
    rate_limited: doc.safety.rate_limited,
    pii_exposure: doc.safety.pii_exposure,
    secrets_exposure: doc.safety.secrets_exposure,
    human_approval_required: doc.safety.human_approval_required,
    refusal_modes: doc.safety.refusal_modes ?? [],
    test_count: doc.tested_with?.length ?? 0,
    p99_latency_ms: doc.performance?.p99_latency_ms ?? null,
  });
}

export async function handleToolCardTestedWith(args: {
  url?: string;
  document_json?: string;
  llm_filter?: string;
}): Promise<string> {
  const doc = await loadDoc(args);
  const tests = doc.tested_with ?? [];
  const filtered = args.llm_filter
    ? tests.filter((t) => t.llm.toLowerCase().includes(args.llm_filter!.toLowerCase()))
    : tests;
  if (filtered.length === 0) {
    return errorJson("no_matching_tests", {
      total_tests: tests.length,
      llm_filter: args.llm_filter ?? null,
      available_llms: tests.map((t) => t.llm),
    });
  }
  return pretty({
    tool_name: doc.tool.name,
    matches: filtered.map((t) => ({
      llm: t.llm,
      provider: t.provider ?? null,
      pass_rate: t.pass_rate,
      tested_at: t.tested_at,
    })),
  });
}

export async function handleToolCardValidate(args: {
  document_json: string;
}): Promise<string> {
  try {
    const doc = mcpToolCardSchema.parse(JSON.parse(args.document_json));
    return pretty({
      valid: true,
      tool_name: doc.tool.name,
      server_id: doc.tool.server_id,
      version: doc.tool.version,
    });
  } catch (err) {
    return pretty({ valid: false, reason: err instanceof Error ? err.message : String(err) });
  }
}
