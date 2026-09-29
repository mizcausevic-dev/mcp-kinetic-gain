import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";

describe("MCP protocol smoke", () => {
  it("advertises the tool set and rejects a malformed Claims Card through callTool", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    const client = new Client({ name: "release-smoke", version: "1.0.0" }, { capabilities: {} });
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(75);
      expect(listed.tools.find((tool) => tool.name === "audit_event_emit")?.annotations?.readOnlyHint).toBe(false);

      const result = await client.callTool({
        name: "claims_card_validate",
        arguments: {
          document: {
            claims_card_version: "0.1",
            claim: {},
            decision: { outcome: "approve" },
            evidence_bundle: { sources: [{}] },
            governance: {},
            attestation: {},
            disclaimer: "A deliberately malformed test card.",
          },
        },
      });
      expect(result.isError).not.toBe(true);
      const first = result.content[0];
      expect(first?.type).toBe("text");
      if (first?.type !== "text") throw new Error("expected text tool response");
      expect(JSON.parse(first.text).valid).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
