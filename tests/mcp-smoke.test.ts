import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";

describe("MCP protocol smoke", () => {
  it("advertises accurate input and safety metadata for the four inspected tools", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildServer();
    const client = new Client({ name: "tool-contract-smoke", version: "1.0.0" }, { capabilities: {} });
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(75);
      for (const name of [
        "prompt_provenance_inspect", "ai_evidence_inspect", "ai_evidence_validate", "clinical_ai_inspect",
      ]) {
        const tool = listed.tools.find((entry) => entry.name === name);
        expect(tool, `${name} is advertised`).toBeDefined();
        expect(tool?.inputSchema).toMatchObject({
          properties: { document_json: { description: expect.any(String) } },
        });
        expect(tool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      }
      const clinical = listed.tools.find((entry) => entry.name === "clinical_ai_inspect");
      expect(clinical?.inputSchema).toMatchObject({
        properties: { url: { description: expect.any(String) } },
      });
      expect(clinical?.annotations?.openWorldHint).toBe(true);
      for (const name of ["prompt_provenance_inspect", "ai_evidence_inspect", "ai_evidence_validate"]) {
        expect(listed.tools.find((entry) => entry.name === name)?.annotations?.openWorldHint).toBe(false);
      }

      const invalidValidation = await client.callTool({
        name: "ai_evidence_validate", arguments: { document_json: "{" },
      });
      expect(invalidValidation.isError).not.toBe(true);
      const validationText = invalidValidation.content[0];
      expect(validationText?.type).toBe("text");
      if (validationText?.type !== "text") throw new Error("expected text validation response");
      expect(JSON.parse(validationText.text).valid).toBe(false);

      for (const [name, args] of [
        ["prompt_provenance_inspect", { document_json: "{" }],
        ["ai_evidence_inspect", { document_json: "{" }],
        ["clinical_ai_inspect", {}],
      ] as const) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, `${name} rejects invalid input`).toBe(true);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("marks failed audit calls and invalid status previews as MCP errors", async () => {
    let sinkHits = 0;
    const sink = createServer((_request, response) => {
      sinkHits += 1;
      response.writeHead(401);
      response.end("bearer token rejected");
    });
    await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
    const port = (sink.address() as { port: number }).port;
    const previousUrl = process.env.AUDIT_STREAM_URL;
    const previousToken = process.env.AUDIT_STREAM_TOKEN;
    process.env.AUDIT_STREAM_URL = `http://127.0.0.1:${port}`;
    process.env.AUDIT_STREAM_TOKEN = "A".repeat(32);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpServer = buildServer();
    const client = new Client({ name: "audit-error-smoke", version: "1.0.0" }, { capabilities: {} });
    try {
      await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
      const unauthorized = await client.callTool({ name: "audit_events_query", arguments: {} });
      expect(unauthorized.isError).toBe(true);
      expect(sinkHits).toBe(1);

      delete process.env.AUDIT_STREAM_TOKEN;
      const missing = await client.callTool({
        name: "audit_event_emit",
        arguments: { kind: "other", source: "manual" },
      });
      expect(missing.isError).toBe(true);
      expect(sinkHits).toBe(1);

      const invalidRubric = await client.callTool({
        name: "decision_card_infer_status",
        arguments: { rubric: [{ id: "a", result: "pass" }, { id: "b", result: "error" }] },
      });
      expect(invalidRubric.isError).toBe(true);
      const validRubric = await client.callTool({
        name: "decision_card_infer_status",
        arguments: { rubric: [{ id: "a", result: "pass" }] },
      });
      expect(validRubric.isError).not.toBe(true);
    } finally {
      await client.close();
      await mcpServer.close();
      await new Promise<void>((resolve) => sink.close(() => resolve()));
      if (previousUrl === undefined) delete process.env.AUDIT_STREAM_URL;
      else process.env.AUDIT_STREAM_URL = previousUrl;
      if (previousToken === undefined) delete process.env.AUDIT_STREAM_TOKEN;
      else process.env.AUDIT_STREAM_TOKEN = previousToken;
    }
  });

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
