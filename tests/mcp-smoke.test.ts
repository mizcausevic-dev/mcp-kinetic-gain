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

      const refused = await client.callTool({
        name: "decision_card_to_policy_bundle",
        arguments: { document_json: JSON.stringify({
          decision_card_version: "0.1", decision_id: "test-approved", issued_at: "2026-05-15T00:00:00Z",
          buyer: { name: "Test District", type: "school-district" },
          decision: { status: "approved" }, subject: { vendor_name: "Test Vendor" },
          rationale: "Synthetic fixture only",
        }) },
      });
      expect(refused.isError).toBe(true);
      const refusalText = refused.content[0];
      expect(refusalText?.type).toBe("text");
      if (refusalText?.type !== "text") throw new Error("expected text error response");
      const refusal = JSON.parse(refusalText.text);
      expect(refusal.error).toBe("positive_decision_requires_live_policy_engine");
      expect(refusal.authorization_granted).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
