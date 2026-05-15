# mcp-kinetic-gain

One **MCP server**, all eleven [Kinetic Gain Protocol Suite](https://suite.kineticgain.com/) specs + the v0.1.0 implementation tooling. Drop into Claude Desktop, Cursor, or any MCP-compatible client with a single config entry. The agent gains **60 tools** (47 spec + 13 implementation-preview, v0.6.0): AEO Protocol, Prompt Provenance, Agent Cards, AI Evidence Format, MCP Tool Cards, AI Tutor Cards, Student AI Disclosure, Classroom AI AUP, Clinical AI Disclosure, AI Incident Card, AI Procurement Decision Card — plus hash attestation (ed25519), audit-stream event composition + chain verification, cross-spec drift detection, Decision Intelligence preview (Decision Card → PolicyBundle, rubric status inference, incident remediation planning).

This is the unified read-side companion to [kinetic-gain-visualizer](https://github.com/mizcausevic-dev/kinetic-gain-visualizer): the visualizer renders any of the 11 specs for humans, this server exposes them as callable tools for agents.

## Install

```bash
npm install -g mcp-kinetic-gain
```

Or run without installing via `npx`:

```bash
npx mcp-kinetic-gain
```

## Claude Desktop config

Add to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "kinetic-gain": {
      "command": "npx",
      "args": ["-y", "mcp-kinetic-gain"]
    }
  }
}
```

Restart Claude. All 60 tools appear in the tools panel. Try:

> *"Use aeo_inspect on https://mizcausevic-dev.github.io to summarize the entity declaration, then use ai_evidence_verify_hash to check the content_hash of an evidence object against my candidate text."*

## CLI mode (v0.5.1+)

The same binary doubles as a Suite JSON validator outside any MCP host. Useful in CI, pre-commit hooks, or local sanity-checks.

```bash
# Validate a single document
npx mcp-kinetic-gain validate path/to/ai-entity.json

# Validate a tree of well-known files
npx mcp-kinetic-gain validate ".well-known/**/*.json"

# Multiple paths or globs
npx mcp-kinetic-gain validate cards/clinical-*.json cards/incident-*.json

# Other commands
npx mcp-kinetic-gain --version
npx mcp-kinetic-gain --help
```

The CLI auto-detects which Suite spec each file belongs to via its top-level version field (`aeo_version`, `clinical_ai_card_version`, `aup_version`, etc.) and validates it against the same zod schemas the MCP tools use. Output is GitHub-Actions-aware: when `GITHUB_ACTIONS=true`, failures emit `::error::` workflow commands so they surface as PR annotations.

**Exit codes:**

| Code | Meaning |
|---|---|
| `0` | Every matched file passed validation |
| `1` | At least one file failed validation, failed to parse, or hit a config error |
| `2` | No file in the input matched a known Suite spec |
| `3` | Usage error (missing arg, unknown flag) |

Running `mcp-kinetic-gain` with **no arguments** still launches the stdio MCP server — existing Claude Desktop / Cursor configs are unaffected.

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

74 unit tests against an in-process Node HTTP server (no external network). Every tool's happy path + at least one error path, plus a live local-HTTP synthetic-index test for `incident_index_fetch`:

```bash
npm install
npm run typecheck
npm test
npm run build
```

## License

**This server: AGPL-3.0.** Reference implementation. Commercial SaaS hosts must share modifications back.

**The specs themselves: MIT.** Maximally permissive. Anyone may implement, validate against, or extend any Kinetic Gain Protocol Suite specification. The dual-license split is deliberate: the protocol stays open, the reference server is copyleft.

## Kinetic Gain Protocol Suite

| Spec | Tools in this server | Vertical |
|---|---|---|
| AEO Protocol | 4 | Core |
| Prompt Provenance | 3 | Core |
| Agent Cards | 4 | Core |
| AI Evidence Format | 3 | Core |
| MCP Tool Cards | 4 | Core |
| AI Tutor Cards | 4 | EdTech |
| Student AI Disclosure | 4 | EdTech (FERPA/COPPA) |
| Classroom AI AUP | 4 + 1 cross-spec (`aup_check_compliance`) | EdTech |
| Clinical AI Disclosure | 4 | HealthTech (FDA SaMD + HIPAA) |
| AI Incident Card | 4 + 1 cross-spec (`incident_index_fetch`) | Cross-cutting (EU AI Act Article 73) |
| AI Procurement Decision Card | 4 | Cross-cutting (buyer-side, OMB M-24-10 / NIST AI RMF rubric-friendly) |

**Suite hub:** [suite.kineticgain.com](https://suite.kineticgain.com/)
**Companion visualizer:** [kinetic-gain-visualizer](https://github.com/mizcausevic-dev/kinetic-gain-visualizer)
**Red-team bench:** [prompt-injection-bench](https://github.com/mizcausevic-dev/prompt-injection-bench)

---

**Connect:** [LinkedIn](https://www.linkedin.com/in/mirzacausevic/) · [Kinetic Gain](https://kineticgain.com) · [Medium](https://medium.com/@mizcausevic/) · [Skills](https://mizcausevic.com/skills/)
