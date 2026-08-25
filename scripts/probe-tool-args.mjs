#!/usr/bin/env node
// scripts/probe-tool-args.mjs
//
// Read-only security probe. For every MCP tool whose handler passes a
// `url`/`origin` value into fetchJson()/fetch() -- confirmed by reading
// src/handlers/*.ts, not guessed from the tool schema alone, since the
// schema is not enforced at dispatch -- send four adversarial inputs and
// record whether the handler validates before use.
//
// Probes per tool:
//   1. ssrf-internal-fetch : does the raw value reach a live fetch to an
//      attacker-controlled (here, local) destination with no host/scheme
//      check? Proven by a tiny local HTTP server logging real hits, not
//      inferred from source alone.
//   2. traversal-string    : a non-URL path-traversal-style string.
//   3. wrong-type          : a number where a string is required.
//   4. extra-property      : an undeclared field alongside a valid value,
//      to check whether additionalProperties:false in the tool schema is
//      actually enforced (it is not, per the earlier aeo_well_known_url
//      finding -- this reconfirms it across every flagged tool).
//
// Separately, SCHEMA_BYPASS_TARGETS covers tools whose *declared* schema
// only exposes `document_json`, but whose handler internally shares a
// loadDoc()/loadCard() helper that also accepts `url`. This checks whether
// sending the undeclared `url` field gets honored anyway.
//
// No filesystem or shell-exec sinks exist anywhere in src/handlers (grepped
// for readFileSync/writeFileSync/child_process/exec/spawn -- zero matches),
// so there is no shell-injection probe here; that category is genuinely N/A
// for this repo, not skipped.
//
// Usage: node scripts/probe-tool-args.mjs

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "..", "dist", "server.js");

let probeHits = [];
const probeServer = createServer((req, res) => {
  probeHits.push({ path: req.url, method: req.method });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ marker: "SSRF_PROBE_HIT", path: req.url }));
});

function startProbeServer() {
  return new Promise((resolve) => {
    probeServer.listen(0, "127.0.0.1", () => resolve(probeServer.address().port));
  });
}

function startMcpClient() {
  const child = spawn(process.execPath, [SERVER_PATH], { stdio: ["pipe", "pipe", "pipe"] });
  const rl = createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;
  let stderrBuf = "";
  child.stderr.on("data", (d) => { stderrBuf += d.toString(); });
  child.on("error", (e) => { stderrBuf += `\n[spawn error] ${e.message}`; });

  rl.on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });

  function send(obj) { child.stdin.write(JSON.stringify(obj) + "\n"); }

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method} (id ${id})`));
      }, 8000);
      pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  function notify(method, params) { send({ jsonrpc: "2.0", method, params }); }

  async function initHandshake() {
    const initRes = await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "probe-tool-args", version: "0.1.0" },
    });
    notify("notifications/initialized", {});
    return initRes;
  }

  async function callTool(name, args) {
    return request("tools/call", { name, arguments: args });
  }

  function close() { try { child.stdin.end(); child.kill(); } catch {} }

  return { initHandshake, callTool, close, getStderr: () => stderrBuf };
}

const TARGETS = [
  { tool: "aeo_fetch", field: "origin" },
  { tool: "aeo_inspect", field: "origin" },
  { tool: "aeo_get_claim", field: "origin", extra: { claim_id: "x" } },
  { tool: "incident_fetch", field: "url" },
  { tool: "incident_index_fetch", field: "origin" },
  { tool: "incident_inspect", field: "url" },
  { tool: "incident_affected_walk", field: "url" },
  { tool: "incident_remediation_plan", field: "url" },
  { tool: "decision_card_fetch", field: "url" },
  { tool: "decision_card_inspect", field: "url" },
  { tool: "decision_card_signature_check", field: "url" },
  { tool: "decision_card_to_policy_bundle", field: "url" },
  { tool: "clinical_ai_fetch", field: "url" },
  { tool: "clinical_ai_inspect", field: "url" },
  { tool: "aup_fetch", field: "url" },
  { tool: "aup_inspect", field: "url" },
  { tool: "tutor_card_fetch", field: "url" },
  { tool: "tutor_card_inspect", field: "url" },
  { tool: "tutor_card_subject_check", field: "url" },
  { tool: "tutor_card_coppa_check", field: "url" },
  { tool: "agent_card_inspect", field: "url" },
  { tool: "agent_card_tool_disclosure", field: "url" },
  { tool: "tool_card_inspect", field: "url" },
  { tool: "tool_card_tested_with", field: "url" },
];

const SCHEMA_BYPASS_TARGETS = [
  "agent_card_validate",
  "tool_card_validate",
  "tutor_card_validate",
  "clinical_ai_validate",
  "decision_card_validate",
  "incident_validate",
  "aup_validate",
];

function isErrorish(result) {
  if (!result) return true;
  if (result.error) return true;
  if (result.result && result.result.isError) return true;
  return false;
}

function resultText(result) {
  try {
    const content = result.result?.content;
    if (Array.isArray(content)) return content.map((c) => c.text ?? "").join(" ");
    return JSON.stringify(result.result ?? result.error ?? result);
  } catch {
    return String(result);
  }
}

async function main() {
  const port = await startProbeServer();
  const markerUrl = `http://127.0.0.1:${port}/probe-marker`;
  console.log(`[probe] local target server: ${markerUrl}`);

  const client = startMcpClient();
  await client.initHandshake();
  console.log("[probe] MCP handshake complete\n");

  const rows = [];

  for (const t of TARGETS) {
    const base = { ...(t.extra ?? {}) };

    probeHits = [];
    await client.callTool(t.tool, { ...base, [t.field]: markerUrl }).catch((e) => ({ error: String(e) }));
    const ssrfHit = probeHits.length > 0;
    rows.push({
      tool: t.tool, probe: "ssrf-internal-fetch", input: `${t.field}=<local-server>`,
      verdict: ssrfHit ? "FAIL" : "PASS",
      note: ssrfHit ? "fetched attacker-supplied internal URL, no host/scheme check" : "did not reach local server",
    });

    const r2 = await client.callTool(t.tool, { ...base, [t.field]: "../../../../etc/passwd" }).catch((e) => ({ error: String(e) }));
    const r2err = isErrorish(r2);
    rows.push({
      tool: t.tool, probe: "traversal-string", input: `${t.field}="../../../../etc/passwd"`,
      verdict: r2err ? "PASS" : "FAIL", note: r2err ? "" : resultText(r2).slice(0, 100),
    });

    const r3 = await client.callTool(t.tool, { ...base, [t.field]: 12345 }).catch((e) => ({ error: String(e) }));
    const r3err = isErrorish(r3);
    rows.push({
      tool: t.tool, probe: "wrong-type", input: `${t.field}=12345`,
      verdict: r3err ? "PASS" : "FAIL", note: r3err ? "" : resultText(r3).slice(0, 100),
    });

    const r4 = await client.callTool(t.tool, { ...base, [t.field]: markerUrl, __unexpected_probe_field__: "x" }).catch((e) => ({ error: String(e) }));
    const r4err = isErrorish(r4);
    rows.push({
      tool: t.tool, probe: "extra-property", input: "+ __unexpected_probe_field__",
      verdict: r4err ? "PASS" : "FAIL", note: r4err ? "" : "additionalProperties:false not enforced",
    });
  }

  for (const tool of SCHEMA_BYPASS_TARGETS) {
    probeHits = [];
    const r = await client.callTool(tool, { url: markerUrl }).catch((e) => ({ error: String(e) }));
    const hit = probeHits.length > 0;
    rows.push({
      tool, probe: "schema-bypass(url on document_json-only tool)", input: `url=<local-server>`,
      verdict: hit ? "FAIL" : "PASS",
      note: hit ? "schema declares document_json only; handler honored undeclared url" : (isErrorish(r) ? "rejected" : "accepted, no fetch"),
    });
  }

  client.close();

  console.log("tool | probe | input | verdict | note");
  console.log("-".repeat(110));
  for (const r of rows) console.log(`${r.tool} | ${r.probe} | ${r.input} | ${r.verdict} | ${r.note}`);

  const failCount = rows.filter((r) => r.verdict === "FAIL").length;
  console.log(`\n${rows.length} probes, ${failCount} FAIL, ${rows.length - failCount} PASS`);

  probeServer.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("[probe] fatal:", e);
  process.exit(1);
});