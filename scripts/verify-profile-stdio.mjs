#!/usr/bin/env node
// Verify the compiled, one-entry stdio server rather than only an in-memory
// Server instance. Synthetic inputs; no network fetch or audit write.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = resolve(project, "dist/server.js");
const synthetic = { name: "suite_doc_detect_spec", arguments: { body: { aeo_version: "0.1" } } };

async function checkProfile(profile, expectedCount) {
  const env = getDefaultEnvironment();
  if (profile) env.MCP_KG_TOOL_PROFILE = profile;
  else delete env.MCP_KG_TOOL_PROFILE;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [executable],
    cwd: project,
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "profile-stdio-check", version: "1.0.0" }, { capabilities: {} });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const deadline = setTimeout(() => {
    process.stderr.write(`profile ${profile ?? "default"} stdio check exceeded 20 seconds\n`);
    void transport.close().finally(() => process.exit(1));
  }, 20_000);
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, expectedCount);
    const shared = await client.callTool(synthetic);
    assert.notEqual(shared.isError, true);
    assert.equal(JSON.parse(shared.content[0].text).spec, "aeo");
    if (profile === "core") {
      assert.ok(!tools.some((tool) => tool.name === "audit_event_emit"));
      const hidden = await client.callTool({ name: "audit_event_emit", arguments: {} });
      assert.equal(hidden.isError, true);
      assert.equal(hidden.content[0].text, "unknown tool: audit_event_emit");
    } else {
      const legacy = await client.callTool({
        name: "aeo_well_known_url",
        arguments: { origin: "https://example.com" },
      });
      assert.notEqual(legacy.isError, true);
    }
    assert.ok(stderr.includes(`profile ${profile ?? "compat"} lists ${expectedCount}`));
    return JSON.stringify(shared);
  } finally {
    clearTimeout(deadline);
    await client.close();
  }
}

async function checkInvalidProfile() {
  const env = { ...getDefaultEnvironment(), MCP_KG_TOOL_PROFILE: "unsupported" };
  const child = spawn(process.execPath, [executable], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const deadline = setTimeout(() => child.kill(), 20_000);
  try {
    const [code] = await once(child, "exit");
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /MCP_KG_TOOL_PROFILE must be unset, 'compat', or 'core'/);
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null) child.kill();
  }
}

const defaultResult = await checkProfile(undefined, 75);
const compatResult = await checkProfile("compat", 75);
const coreResult = await checkProfile("core", 20);
assert.equal(defaultResult, compatResult);
assert.equal(coreResult, compatResult);
await checkInvalidProfile();
process.stdout.write("stdio profiles: default 75, compat 75, core 20, shared call equal, hidden direct call denied, invalid profile exits 1\n");
