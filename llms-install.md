# Installing mcp-kinetic-gain (for AI agents / Cline)

This is an AI-readable install guide. `mcp-kinetic-gain` is a stdio MCP server
published to npm; it needs no build step and no API key.

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

That's the entire installation. Restart the client; 63 tools appear.

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

Without it, the server runs fully offline (the other 60 tools work unchanged).

## What you get

63 tools across all eleven Kinetic Gain Protocol Suite specs (AEO Protocol,
Prompt Provenance, Agent Cards, AI Evidence Format, MCP Tool Cards, AI Tutor
Cards, Student AI Disclosure, Classroom AI AUP, Clinical AI Disclosure, AI
Incident Card, AI Procurement Decision Card) plus ed25519 attestation
verification, hash-chained audit-stream events, cross-spec drift detection, and
a Decision Intelligence preview. No credentials required for the core tool set.
