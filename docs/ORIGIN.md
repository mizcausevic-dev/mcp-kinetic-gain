# Why this server exists

`mcp-kinetic-gain` gives MCP clients one entry point for the Kinetic Gain Protocol Suite. The current source declares 75 tools across 12 spec families, cross-spec operations, and DefenseTech checks. The CLI also validates local JSON documents against the bundled schemas.

The server is useful when an operator already has a document or URL and needs to inspect its declared fields, validate its structure, compare versions, check a hash, or prepare an audit event. Most tools are deterministic or read from a supplied URL. `audit_event_emit` is different: when `AUDIT_STREAM_URL` is configured, it writes the supplied event to that service.

The boundary matters. A schema pass does not prove that an organization meets a law, that a signer owns a key, or that a remote document is trustworthy. Those conclusions require evidence and review outside this package. See [README.md](../README.md) for installation, network behavior, and the tool catalog.
