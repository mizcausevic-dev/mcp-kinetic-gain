# mcp-kinetic-gain

One **MCP server**, all five [Kinetic Gain Protocol Suite](https://github.com/mizcausevic-dev?q=spec) specs. Drop into Claude Desktop, Cursor, or any MCP-compatible client with a single config entry. The agent gains **18 tools** across AEO Protocol, Prompt Provenance, Agent Cards, AI Evidence Format, and MCP Tool Cards.

This is the unified read-side companion to [kinetic-gain-visualizer](https://github.com/mizcausevic-dev/kinetic-gain-visualizer): the visualizer renders any of the 5 specs for humans, this server exposes them as callable tools for agents.

## Install

```bash
npm install -g @mizcausevic-dev/mcp-kinetic-gain
```

Or run without installing via `npx`:

```bash
npx @mizcausevic-dev/mcp-kinetic-gain
```

## Claude Desktop config

Add to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "kinetic-gain": {
      "command": "npx",
      "args": ["-y", "@mizcausevic-dev/mcp-kinetic-gain"]
    }
  }
}
```

Restart Claude. All 18 tools appear in the tools panel. Try:

> *"Use aeo_inspect on https://mizcausevic-dev.github.io to summarize the entity declaration, then use ai_evidence_verify_hash to check the content_hash of an evidence object against my candidate text."*

## Tools

| Spec | Tool | Notes |
|---|---|---|
| **AEO Protocol** | `aeo_fetch` | Fetch the full `/.well-known/aeo.json` for an origin |
|  | `aeo_inspect` | Structured summary (entity, claim count, audit mode) |
|  | `aeo_get_claim` | Extract a single claim by ID; lists available IDs if missing |
|  | `aeo_well_known_url` | Compute the canonical URL without fetching |
| **Prompt Provenance** | `prompt_provenance_validate` | Schema-validate a Prompt Provenance JSON document |
|  | `prompt_provenance_inspect` | Summary: prompt identity, lineage, approval state, eval suites |
|  | `prompt_provenance_eval_result` | Extract one evaluation suite's result by name |
| **Agent Cards** | `agent_card_well_known_url` | `/.well-known/agents/<agent_id>.json` |
|  | `agent_card_inspect` | Summary; accepts either `url` (fetched) or `document_json` (inline) |
|  | `agent_card_tool_disclosure` | List tools the agent declares, with side-effect class + Tool Card URI |
|  | `agent_card_validate` | Schema-validate |
| **AI Evidence Format** | `ai_evidence_validate` | Schema-validate |
|  | `ai_evidence_inspect` | Summary: claim, source, retrieval method, synthesis role, hash |
|  | `ai_evidence_verify_hash` | Recompute SHA-256 over canonical text; compare to `verification.content_hash` |
| **MCP Tool Cards** | `tool_card_well_known_url` | `/.well-known/mcp-tools/<tool_name>.json` |
|  | `tool_card_inspect` | Summary: safety profile, refusal modes, test count, p99 latency |
|  | `tool_card_tested_with` | Filter the tested-with matrix by LLM substring |
|  | `tool_card_validate` | Schema-validate |

Specs **with a well-known URL convention** (AEO, Agent Cards, Tool Cards) get fetch tools. Specs **without** one (Prompt Provenance, AI Evidence — these usually travel inline with answers or in repos, not at fixed paths) get parse tools that take a `document_json` string.

## Why one server instead of five?

- **One Claude Desktop config entry** instead of five
- **Cross-spec workflows are atomic** — an agent can `agent_card_tool_disclosure` to find a Tool Card URI, then call `tool_card_inspect` on that URI in the same conversation, all through one server
- **Shared schemas + utilities** keep the implementation cohesive
- **Deprecation path** — if [mcp-aeo-server](https://github.com/mizcausevic-dev/mcp-aeo-server) (the AEO-only predecessor) gets retired, the AEO tools live on here with the same names and contracts

## Architecture

```
src/
├── server.ts              # MCP entrypoint, handler dispatch
├── tools.ts               # 18 tool descriptors (JSON Schema inputs)
├── schemas.ts             # zod schemas for every spec
├── common.ts              # fetchJson, canonicalSha256, pretty
└── handlers/
    ├── aeo.ts
    ├── prompt-provenance.ts
    ├── agent-card.ts
    ├── ai-evidence.ts
    └── tool-card.ts
```

Each handler module is independent and could be split into a separate package if needed.

## Hash canonicalization

`ai_evidence_verify_hash` follows the AI Evidence Format spec's canonical SHA-256 rules:

1. Read content as UTF-8
2. Normalize line endings to `\n`
3. Strip a single trailing newline
4. SHA-256, lowercase hex, prefixed `sha256:`

If your `candidate_text` produces an unexpected mismatch, check CRLF vs LF and trailing newlines first.

## Tests

27 unit tests against an in-process Node HTTP server (no external network). Every tool's happy path + at least one error path:

```bash
npm install
npm run typecheck
npm test
npm run build
```

## License

AGPL-3.0.

## Kinetic Gain Protocol Suite

| Spec | Tools in this server | Spec repo |
|---|---|---|
| AEO Protocol | 4 | [aeo-protocol-spec](https://github.com/mizcausevic-dev/aeo-protocol-spec) |
| Prompt Provenance | 3 | [prompt-provenance-spec](https://github.com/mizcausevic-dev/prompt-provenance-spec) |
| Agent Cards | 4 | [agent-cards-spec](https://github.com/mizcausevic-dev/agent-cards-spec) |
| AI Evidence Format | 3 | [ai-evidence-format-spec](https://github.com/mizcausevic-dev/ai-evidence-format-spec) |
| MCP Tool Cards | 4 | [mcp-tool-card-spec](https://github.com/mizcausevic-dev/mcp-tool-card-spec) |

Companion read-side product: [kinetic-gain-visualizer](https://github.com/mizcausevic-dev/kinetic-gain-visualizer).

---

**Connect:** [LinkedIn](https://www.linkedin.com/in/mirzacausevic/) · [Kinetic Gain](https://kineticgain.com) · [Medium](https://medium.com/@mizcausevic/) · [Skills](https://mizcausevic.com/skills/)
