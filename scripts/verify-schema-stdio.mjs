#!/usr/bin/env node
// End-to-end source check against the compiled stdio executable. Synthetic
// inputs only; this never requests a network fetch or writes an audit event.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(project, "dist/server.js")],
  cwd: project,
  env: getDefaultEnvironment(),
  stderr: "pipe",
});
const client = new Client({ name: "schema-stdio-check", version: "1.0.0" }, { capabilities: {} });
let stderr = "";
transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
const deadline = setTimeout(() => {
  process.stderr.write("schema stdio check exceeded 20 seconds\n");
  void transport.close().finally(() => process.exit(1));
}, 20_000);

try {
  await client.connect(transport);
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 75);

  const good = await client.callTool({
    name: "aeo_well_known_url",
    arguments: { origin: "https://example.com" },
  });
  assert.notEqual(good.isError, true);
  assert.equal(JSON.parse(good.content[0].text).url, "https://example.com/.well-known/aeo.json");

  for (const arguments_ of [
    { origin: "https://example.com", unexpected: "synthetic-canary" },
    { origin: 42 },
    {},
  ]) {
    const bad = await client.callTool({ name: "aeo_well_known_url", arguments: arguments_ });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /^invalid arguments for aeo_well_known_url:/);
    assert.ok(!JSON.stringify(bad).includes("synthetic-canary"));
  }

  const undeclaredUrl = await client.callTool({
    name: "tutor_card_validate",
    arguments: { url: "https://127.0.0.1.invalid/should-not-fetch" },
  });
  assert.equal(undeclaredUrl.isError, true);
  assert.match(undeclaredUrl.content[0].text, /^invalid arguments for tutor_card_validate:/);

  const inherited = await client.callTool({ name: "toString", arguments: {} });
  assert.equal(inherited.isError, true);
  assert.equal(inherited.content[0].text, "unknown tool: toString");
  assert.ok(!stderr.includes("synthetic-canary"));
  process.stdout.write("stdio schema gate: 75 listed, 1 valid call, 5 denied calls, no canary in errors\n");
} finally {
  clearTimeout(deadline);
  await client.close();
}
