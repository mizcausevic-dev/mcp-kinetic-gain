import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";

async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  // buildServer compiles all 75 declared schemas before accepting a call.
  const server = buildServer();
  const client = new Client({ name: "schema-gate-test", version: "1.0.0" }, { capabilities: {} });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("MCP input schema boundary", () => {
  it("preserves a declared, harmless call while compiling the full menu", async () => {
    await withClient(async (client) => {
      expect((await client.listTools()).tools).toHaveLength(75);
      const result = await client.callTool({
        name: "aeo_well_known_url",
        arguments: { origin: "https://example.com" },
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse((result.content[0] as { text: string }).text).url)
        .toBe("https://example.com/.well-known/aeo.json");
    });
  });

  it("rejects extra, missing, wrong-type, and wrong-format arguments before dispatch", async () => {
    await withClient(async (client) => {
      const cases = [
        { origin: "https://example.com", __unexpected_probe_field__: "PRIVATE_CANARY" },
        {},
        { origin: 12345 },
        { origin: "../../../../etc/passwd" },
      ];
      for (const arguments_ of cases) {
        const result = await client.callTool({ name: "aeo_well_known_url", arguments: arguments_ });
        expect(result.isError).toBe(true);
        expect((result.content[0] as { text: string }).text).toMatch(/^invalid arguments for aeo_well_known_url:/);
        expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
      }
    });
  });

  it("does not honor an undeclared URL on a document-only validator", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "tutor_card_validate",
        arguments: { url: "https://127.0.0.1.invalid/should-not-fetch" },
      });
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toMatch(/^invalid arguments for tutor_card_validate:/);
    });
  });

  it("rejects inherited object method names as unknown tools", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: "toString", arguments: {} });
      expect(result).toEqual({
        content: [{ type: "text", text: "unknown tool: toString" }],
        isError: true,
      });
    });
  });
});
