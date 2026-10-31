import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { buildServer } from "../src/server.js";
import { CORE_TOOL_NAMES, selectToolProfile } from "../src/tool-profiles.js";
import { toolDescriptors } from "../src/tools.js";

async function withClient<T>(profile: string | undefined, run: (client: Client) => Promise<T>): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(profile);
  const client = new Client({ name: "profile-smoke", version: "1.0.0" }, { capabilities: {} });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("opt-in tool profiles", () => {
  it("keeps the entire published descriptor set as the default and explicit compat profile", () => {
    expect(selectToolProfile("").descriptors).toEqual(toolDescriptors);
    expect(selectToolProfile("compat").descriptors).toEqual(toolDescriptors);
    expect(toolDescriptors).toHaveLength(75);
  });

  it("lists exactly the reviewed twenty core names", () => {
    const profile = selectToolProfile("core");
    expect(profile.descriptors).toHaveLength(20);
    expect(new Set(CORE_TOOL_NAMES).size).toBe(20);
    expect(new Set(profile.descriptors.map((tool) => tool.name))).toEqual(new Set(CORE_TOOL_NAMES));
    expect(profile.names.has("audit_event_emit")).toBe(false);
  });

  it("rejects unknown profile names before starting the server", () => {
    expect(() => selectToolProfile("aviation")).toThrow("MCP_KG_TOOL_PROFILE");
    expect(() => buildServer("CORE")).toThrow("MCP_KG_TOOL_PROFILE");
  });

  it("selects the startup menu from MCP_KG_TOOL_PROFILE", async () => {
    const previous = process.env.MCP_KG_TOOL_PROFILE;
    try {
      process.env.MCP_KG_TOOL_PROFILE = "core";
      await withClient(undefined, async (client) => {
        expect((await client.listTools()).tools).toHaveLength(20);
      });
      process.env.MCP_KG_TOOL_PROFILE = "unrecognized";
      expect(() => buildServer()).toThrow("MCP_KG_TOOL_PROFILE");
    } finally {
      if (previous === undefined) delete process.env.MCP_KG_TOOL_PROFILE;
      else process.env.MCP_KG_TOOL_PROFILE = previous;
    }
  });

  it("blocks unlisted direct calls before dispatching a handler", async () => {
    await withClient("core", async (client) => {
      const listed = await client.listTools();
      expect(listed.tools).toHaveLength(20);
      expect(listed.tools.some((tool) => tool.name === "audit_event_emit")).toBe(false);

      const hiddenNames = toolDescriptors
        .map((tool) => tool.name)
        .filter((name) => !CORE_TOOL_NAMES.includes(name as typeof CORE_TOOL_NAMES[number]));
      expect(hiddenNames).toHaveLength(55);
      for (const name of [...hiddenNames, "toString"]) {
        const result = await client.callTool({ name, arguments: {} });
        expect(result.isError).toBe(true);
        expect(result.content).toEqual([{ type: "text", text: `unknown tool: ${name}` }]);
      }

      const allowed = await client.callTool({
        name: "suite_doc_detect_spec",
        arguments: { body: { aeo_version: "0.1" } },
      });
      expect(allowed.isError).not.toBe(true);
      expect(JSON.parse((allowed.content[0] as { text: string }).text).spec).toBe("aeo");
    });
  });

  it("keeps a legacy URL helper callable in explicit compat mode", async () => {
    await withClient("compat", async (client) => {
      expect((await client.listTools()).tools).toHaveLength(75);
      const result = await client.callTool({
        name: "aeo_well_known_url",
        arguments: { origin: "https://example.com" },
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse((result.content[0] as { text: string }).text).url).toBe("https://example.com/.well-known/aeo.json");
    });
  });

  it("returns the same synthetic result from a shared core tool in both menus", async () => {
    const request = { name: "suite_doc_detect_spec", arguments: { body: { aeo_version: "0.1" } } };
    const coreResult = await withClient("core", (client) => client.callTool(request));
    const compatResult = await withClient("compat", (client) => client.callTool(request));
    expect(coreResult).toEqual(compatResult);
  });
});
