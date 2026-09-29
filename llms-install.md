# Installing mcp-kinetic-gain (for AI agents / Cline)

This is an AI-readable install guide. `mcp-kinetic-gain` is a stdio MCP server
published to npm; it needs no build step and no API key.
Check `npm view mcp-kinetic-gain version` against this repository's
`package.json` before relying on a source change; npm may still serve an older
version.

## Add the server

Add this entry to the MCP client's config (`claude_desktop_config.json`, Cline
MCP settings, Cursor, etc.):

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

That's the entire installation. Restart the client; 75 tools appear.

## Optional: live audit-stream tools

To enable the live audit-stream tools (`audit_event_emit`,
`audit_events_query`, `audit_chain_verify_live`), point the server at a running
[audit-stream-py](https://github.com/mizcausevic-dev/audit-stream-py) instance
via the `AUDIT_STREAM_URL` environment variable:

```json
{
  "mcpServers": {
    "kinetic-gain": {
      "command": "npx",
      "args": ["-y", "mcp-kinetic-gain"],
      "env": { "AUDIT_STREAM_URL": "http://127.0.0.1:8000" }
    }
  }
}
```

Without it, the three live audit-stream tools return a configuration error. The other 72 tools remain available; URL fetch tools still access remote sites when called. `audit_event_emit` writes the supplied event to the configured service. Obtain user approval before sending it and avoid sensitive payloads unless the service is approved for them.

## What you get

75 tools across all twelve Kinetic Gain Protocol Suite specs (AEO Protocol,
Prompt Provenance, Agent Cards, AI Evidence Format, MCP Tool Cards, AI Tutor
Cards, Student AI Disclosure, Classroom AI AUP, Clinical AI Disclosure, AI
Incident Card, AI Procurement Decision Card, AI Claims Decision Card) plus ed25519 attestation
verification, hash-chained audit-stream events, cross-spec drift detection, a
Decision Intelligence preview, and the DefenseTech 6-pack (3-axis vault
resolver, CUI/ITAR/DFARS invariant checkers, CMMC evidence-bundle summarizer,
Incident Card event-type classifier). No credentials required for the core
tool set.
