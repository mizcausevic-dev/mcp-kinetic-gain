/** Exercise the installed tarball's public stdio entry point, not the source tree. */
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = process.argv[2];
if (!entry) throw new Error("Pass the installed package's dist/server.js path.");
const serverPath = resolve(entry);
await access(serverPath);

async function within(label, work) {
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function smoke(verticals, expectedCount) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { MCP_KG_VERTICALS: verticals },
    stderr: "pipe",
  });
  const client = new Client({ name: "packed-package-smoke", version: "1.0.0" }, { capabilities: {} });
  const protocolErrors = [];
  client.onerror = (error) => protocolErrors.push(error.message);
  try {
    await within("MCP initialize", client.connect(transport));
    const listed = await within("tools/list", client.listTools());
    assert.equal(listed.tools.length, expectedCount, "installed tools/list count");
    const aviation = listed.tools.filter((tool) =>
      tool.name.startsWith("aviation_ml_card_") || tool.name === "mro_signoff_verify");
    assert.equal(aviation.length, verticals ? 5 : 0, "aviation tool visibility");

    const local = await within("local tool call", client.callTool({
      name: "suite_doc_detect_spec",
      arguments: { body: { provenance_version: "0.1" } },
    }));
    assert.notEqual(local.isError, true, "local read-only call");
    const first = local.content[0];
    assert.equal(first?.type, "text");
    assert.equal(JSON.parse(first.text).spec, "prompt-provenance");

    if (!verticals) {
      const denied = await within("default tool denial", client.callTool({
        name: "aviation_ml_card_validate",
        arguments: { document_json: "{}" },
      }));
      assert.equal(denied.isError, true, "aviation tool must be unavailable by default");
    } else {
      const invalid = await within("aviation validation", client.callTool({
        name: "aviation_ml_card_validate",
        arguments: { document_json: "{}" },
      }));
      const text = invalid.content[0];
      assert.equal(text?.type, "text");
      assert.equal(JSON.parse(text.text).valid, false);
    }
    // A stray stdout line is not valid MCP JSON-RPC and reaches onerror.
    await new Promise((done) => setTimeout(done, 50));
    assert.deepEqual(protocolErrors, [], "stdout must contain only MCP protocol messages");
    console.log(`Packed stdio MCP smoke passed: ${expectedCount} tools (${verticals || "default"}).`);
  } finally {
    await client.close();
  }
}

await smoke("", 75);
await smoke("aviation", 80);
