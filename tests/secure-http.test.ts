import { generateKeyPairSync, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startSecurePilot, type RunningSecurePilot } from "../src/secure-http.js";
import { SecurePilotGate, loadSecureGateConfig, verifyBearerToken } from "../src/secure-gate.js";
import { checkBrokerDecision } from "../src/broker-bridge.js";

const SINK_TOKEN = "S".repeat(40);
const ISSUER = "synthetic-issuer";
const CLIENT = "synthetic-client-a";
const SUBJECT = "synthetic-subject-a";
const TOOL = "suite_doc_detect_spec";
const BROKER_REPO = process.env.MCP_BROKER_REPO ?? resolve(import.meta.dirname, "../../mcp-permission-broker");
const BROKER_PYTHON = process.env.MCP_BROKER_PYTHON ?? join(
  BROKER_REPO, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const FIXTURE_SCRIPT = join(BROKER_REPO, "tests/create_runtime_bridge_fixture.py");
const execFileAsync = promisify(execFile);

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type SinkMode = "normal" | "outage" | "outcome-outage" | "bad-receipt" | "tampered-link" | "revoke-after-allow" | "expire-after-allow" | "broker-revoke-after-allow" | "broker-condition-after-allow" | "broker-rollback-after-allow";

describe("loopback Streamable HTTP source pilot", () => {
  let directory: string;
  let publicKeyFile: string;
  let policyFile: string;
  let brokerConfigFile: string;
  let privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  let sink: Server;
  let sinkUrl: string;
  let pilot: RunningSecurePilot;
  let mode: SinkMode;
  let events: Array<Record<string, any>>;

  async function writePolicy(
    revokedJtis: string[] = [],
    allowedTools = [TOOL],
    validUntil = Math.floor(Date.now() / 1000) + 120,
  ): Promise<void> {
    const value = JSON.stringify({
      version: 1,
      valid_until: validUntil,
      clients: { [CLIENT]: { subject: SUBJECT, allowed_tools: allowedTools } },
      revoked_jtis: revokedJtis,
    });
    const temporary = `${policyFile}.next`;
    await writeFile(temporary, value);
    await rename(temporary, policyFile);
  }

  async function updateBrokerSnapshot(change: (snapshot: Record<string, any>) => void): Promise<void> {
    const snapshot = JSON.parse(await readFile(brokerConfigFile, "utf8")) as Record<string, any>;
    change(snapshot);
    const temporary = `${brokerConfigFile}.next`;
    await writeFile(temporary, JSON.stringify(snapshot));
    await rename(temporary, brokerConfigFile);
  }

  async function writeBrokerFixture(status?: "approved-with-conditions" | "rejected" | "withdrawn"): Promise<void> {
    await execFileAsync(BROKER_PYTHON, [
      FIXTURE_SCRIPT, brokerConfigFile, ...(status ? [status] : []),
    ]);
  }

  function token(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const encodedHeader = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT", ...header })).toString("base64url");
    const encodedBody = Buffer.from(JSON.stringify({
      iss: ISSUER,
      aud: pilot.url,
      sub: SUBJECT,
      client_id: CLIENT,
      jti: "jti-1",
      scope: "mcp:tools",
      iat: now - 1,
      nbf: now - 1,
      exp: now + 120,
      ...overrides,
    })).toString("base64url");
    const signature = sign(null, Buffer.from(`${encodedHeader}.${encodedBody}`), privateKey).toString("base64url");
    return `${encodedHeader}.${encodedBody}.${signature}`;
  }

  async function clientFor(bearer = token()): Promise<Client> {
    const client = new Client({ name: "secure-pilot-test", version: "1.0.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(pilot.url), {
      requestInit: { headers: { authorization: `Bearer ${bearer}` }, redirect: "error" },
    });
    await client.connect(transport);
    return client;
  }

  function mcpBody(method = "tools/list", params: Record<string, unknown> = {}): string {
    return JSON.stringify({ jsonrpc: "2.0", id: 4, method, params });
  }

  async function rawRequest(options: {
    method?: string;
    path?: string;
    headers?: string[];
    body?: string;
    chunks?: string[];
  }): Promise<{ status: number; text: string }> {
    const target = new URL(pilot.url);
    return new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: target.hostname,
        port: target.port,
        path: options.path ?? "/mcp",
        method: options.method ?? "POST",
        headers: options.headers ?? [
          "Host", target.host,
          "Authorization", `Bearer ${token()}`,
          "Content-Type", "application/json",
          "Accept", "application/json, text/event-stream",
          "MCP-Protocol-Version", "2025-03-26",
        ],
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
      });
      req.once("error", reject);
      if (options.chunks) {
        for (const chunk of options.chunks) req.write(chunk);
        req.end();
      } else {
        const body = (options.method ?? "POST") === "POST" ? options.body ?? mcpBody() : undefined;
        req.end(body);
      }
    });
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "kinetic-secure-test-"));
    publicKeyFile = join(directory, "issuer-public.pem");
    policyFile = join(directory, "gate.json");
    brokerConfigFile = join(directory, "broker.json");
    const pair = generateKeyPairSync("ed25519");
    privateKey = pair.privateKey;
    await writeFile(publicKeyFile, pair.publicKey.export({ format: "pem", type: "spki" }));
    await writePolicy();
    await writeBrokerFixture();
    events = [];
    mode = "normal";
    sink = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      if (request.headers.authorization !== `Bearer ${SINK_TOKEN}`) {
        response.writeHead(401).end();
        return;
      }
      if (mode === "outage" || (mode === "outcome-outage" && events.length >= 1)) {
        response.writeHead(503).end("TOP_SECRET_SINK_BODY");
        return;
      }
      const event = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, any>;
      events.push(event);
      if (event.kind === "tool_invocation_allowed") {
        if (mode === "revoke-after-allow") await writePolicy(["jti-1"]);
        if (mode === "expire-after-allow") await writePolicy([], [TOOL], Math.floor(Date.now() / 1000) - 1);
        if (mode === "broker-revoke-after-allow") {
          await updateBrokerSnapshot((snapshot) => { snapshot.revoked_jtis = ["jti-1"]; });
        }
        if (mode === "broker-condition-after-allow") {
          await updateBrokerSnapshot((snapshot) => {
            snapshot.principal_bindings[SUBJECT].conditions_satisfied["dpa-signed"] = false;
          });
        }
        if (mode === "broker-rollback-after-allow") {
          const earlierSnapshot = await readFile(brokerConfigFile);
          await updateBrokerSnapshot((snapshot) => { snapshot.revoked_jtis = ["jti-1"]; });
          const temporary = `${brokerConfigFile}.rollback`;
          await writeFile(temporary, earlierSnapshot);
          await rename(temporary, brokerConfigFile);
        }
      }
      const receipt = {
        ...event,
        event_id: events.length,
        timestamp: new Date().toISOString(),
        prev_hash: "0".repeat(64),
        hash: "a".repeat(64),
      };
      if (mode === "bad-receipt") receipt.source = "forged-source";
      if (mode === "tampered-link" && event.kind === "tool_invocation_completed") {
        receipt.payload = { ...event.payload, decision_hash: "b".repeat(64) };
      }
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify(receipt));
    });
    await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
    const sinkAddress = sink.address();
    if (!sinkAddress || typeof sinkAddress === "string") throw new Error("missing sink address");
    sinkUrl = `http://127.0.0.1:${sinkAddress.port}`;
    pilot = await startSecurePilot({
      port: 0, issuer: ISSUER, publicKeyFile, policyFile,
      auditUrl: sinkUrl, auditToken: SINK_TOKEN,
      pythonFile: BROKER_PYTHON, configFile: brokerConfigFile,
    });
  });

  afterEach(async () => {
    if (pilot) await pilot.close();
    if (sink?.listening) await new Promise<void>((resolve) => sink.close(() => resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("filters tools/list and requires an accepted receipt before a real MCP tools/call", async () => {
    const client = await clientFor();
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([TOOL]);
      const result = await client.callTool({ name: TOOL, arguments: { body: { aeo_version: "0.1" } } });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse((result.content[0] as { text: string }).text).spec).toBe("aeo");
      expect(events.map((event) => event.kind)).toEqual([
        "tool_invocation_allowed", "tool_invocation_completed",
      ]);
      expect(events[0]?.source).toBe("mcp-kinetic-gain");
      expect(events[0]?.payload.client_id).toBe(CLIENT);
      expect(events[0]?.payload.broker_correlation_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(events[0]?.payload.broker_state_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(events[0]?.payload.signed_card_decision_id).toBe("SYNTHETIC-BRIDGE-001");
      expect(events[1]?.payload.decision_event_id).toBe(1);
      expect(events[1]?.payload.correlation_id).toBe(events[0]?.payload.correlation_id);
      expect(JSON.stringify(events)).not.toContain("aeo_version");
    } finally {
      await client.close();
    }
  });

  it("uses signed and server-owned identity, denies nonallowlisted tools and argument authority claims", async () => {
    const client = await clientFor();
    try {
      const forgedArgs = await client.callTool({
        name: TOOL,
        arguments: { body: { aeo_version: "0.1", client_id: "forged" }, client_id: "forged" },
      });
      expect(forgedArgs.isError).toBe(true);
      const unlisted = await client.callTool({ name: "audit_event_emit", arguments: { kind: "other" } });
      expect(unlisted.isError).toBe(true);
      expect(events.map((event) => event.kind)).toEqual([
        "tool_invocation_denied", "tool_invocation_denied",
      ]);
      expect(events.every((event) => event.payload.client_id === CLIENT)).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("rejects missing, duplicate, wrong-audience, expired, and wrong-algorithm tokens before MCP parsing", async () => {
    const base = ["Host", new URL(pilot.url).host, "Content-Type", "application/json"];
    expect((await rawRequest({ headers: base })).status).toBe(401);
    expect((await rawRequest({ headers: [...base, "Authorization", `Bearer ${token()}`, "Authorization", `Bearer ${token()}`] })).status).toBe(401);
    expect((await rawRequest({ headers: [...base, "Authorization", `Bearer ${token({ aud: "http://127.0.0.1:9999/mcp" })}`] })).status).toBe(401);
    expect((await rawRequest({ headers: [...base, "Authorization", `Bearer ${token({ exp: 1 })}`] })).status).toBe(401);
    expect((await rawRequest({ headers: [...base, "Authorization", `Bearer ${token({ scope: "mcp:read" })}`] })).status).toBe(401);
    expect((await rawRequest({ headers: [...base, "Authorization", `Bearer ${token({}, { alg: "HS256" })}`] })).status).toBe(401);
    expect(events).toEqual([]);
  });

  it("rejects untrusted Host, browser Origin, unused methods, and oversized requests", async () => {
    const target = new URL(pilot.url);
    const auth = ["Authorization", `Bearer ${token()}`, "Content-Type", "application/json"];
    expect((await rawRequest({ headers: ["Host", "evil.example", ...auth] })).status).toBe(403);
    expect((await rawRequest({ headers: ["Host", target.host, "Origin", "https://evil.example", ...auth] })).status).toBe(403);
    expect((await rawRequest({ method: "GET" })).status).toBe(405);
    expect((await rawRequest({ method: "DELETE" })).status).toBe(405);
    expect((await rawRequest({ body: "x".repeat(40_000) })).status).toBe(413);
    expect((await rawRequest({
      headers: ["Host", target.host, ...auth, "Accept", "application/json, text/event-stream", "Transfer-Encoding", "chunked"],
      chunks: ["x".repeat(20_000), "x".repeat(20_000)],
    })).status).toBe(413);
    expect(events).toEqual([]);
  });

  it("keeps concurrent authenticated clients separate and source-owned", async () => {
    const [authorized, unknownClient] = await Promise.all([
      clientFor(token({ jti: "jti-authorized" })),
      clientFor(token({ client_id: "client-b", sub: "subject-b", jti: "jti-denied" })),
    ]);
    try {
      const [allowed, denied] = await Promise.all([
        authorized.callTool({ name: TOOL, arguments: { body: { aeo_version: "0.1" } } }),
        unknownClient.callTool({ name: TOOL, arguments: { body: { aeo_version: "0.1" } } }),
      ]);
      expect(allowed.isError).not.toBe(true);
      expect(denied.isError).toBe(true);
      expect((await unknownClient.listTools()).tools).toEqual([]);
      const allowedEvent = events.find((event) => event.kind === "tool_invocation_allowed");
      const deniedEvent = events.find((event) => event.kind === "tool_invocation_denied");
      expect(allowedEvent?.payload.client_id).toBe(CLIENT);
      expect(deniedEvent?.payload.client_id).toBe("client-b");
      expect(events.every((event) => !JSON.stringify(event).includes("subject-"))).toBe(true);
    } finally {
      await authorized.close();
      await unknownClient.close();
    }
  });

  it("does not invoke a handler when the audit sink is unavailable or forges its receipt", async () => {
    const config = await loadSecureGateConfig({
      issuer: ISSUER, resource: pilot.url, publicKeyFile, policyFile,
      auditUrl: sinkUrl, auditToken: SINK_TOKEN,
      pythonFile: BROKER_PYTHON, configFile: brokerConfigFile,
    });
    const gate = new SecurePilotGate(config);
    const auth = verifyBearerToken(token(), config);
    let invoked = 0;
    mode = "outage";
    const unavailable = await gate.invoke(TOOL, { body: {} }, auth, async () => {
      invoked += 1;
      return "secret result";
    });
    expect(unavailable).toEqual({ text: "audit_receipt_unavailable", isError: true });
    mode = "bad-receipt";
    const forged = await gate.invoke(TOOL, { body: {} }, auth, async () => {
      invoked += 1;
      return "secret result";
    });
    expect(forged).toEqual({ text: "audit_receipt_unavailable", isError: true });
    expect(invoked).toBe(0);
  });

  it("blocks the handler for a valid signed rejected card, missing condition, or local snapshot revocation", async () => {
    const config = await loadSecureGateConfig({
      issuer: ISSUER, resource: pilot.url, publicKeyFile, policyFile,
      auditUrl: sinkUrl, auditToken: SINK_TOKEN,
      pythonFile: BROKER_PYTHON, configFile: brokerConfigFile,
    });
    const gate = new SecurePilotGate(config);
    const auth = verifyBearerToken(token(), config);
    let invoked = 0;
    const tryCall = () => gate.invoke(TOOL, { body: {} }, auth, async () => {
      invoked += 1;
      return "handler-ran";
    });

    await writeBrokerFixture("rejected");
    expect((await tryCall()).isError).toBe(true);
    await writeBrokerFixture();
    await updateBrokerSnapshot((snapshot) => {
      delete snapshot.principal_bindings[SUBJECT].conditions_satisfied["dpa-signed"];
    });
    expect((await tryCall()).isError).toBe(true);
    await writeBrokerFixture();
    await updateBrokerSnapshot((snapshot) => { snapshot.revoked_jtis = ["jti-1"]; });
    expect((await tryCall()).isError).toBe(true);
    await writeBrokerFixture();
    await updateBrokerSnapshot((snapshot) => {
      snapshot.revoked_decision_ids = ["SYNTHETIC-BRIDGE-001"];
    });
    expect((await tryCall()).isError).toBe(true);
    expect(invoked).toBe(0);
    expect(events.every((event) => event.kind !== "tool_invocation_allowed")).toBe(true);
  });

  it("rechecks Broker revocation and condition facts after the accepted receipt", async () => {
    const config = await loadSecureGateConfig({
      issuer: ISSUER, resource: pilot.url, publicKeyFile, policyFile,
      auditUrl: sinkUrl, auditToken: SINK_TOKEN,
      pythonFile: BROKER_PYTHON, configFile: brokerConfigFile,
    });
    const gate = new SecurePilotGate(config);
    const auth = verifyBearerToken(token(), config);
    let invoked = 0;
    for (const scenario of ["broker-revoke-after-allow", "broker-condition-after-allow"] as const) {
      await writeBrokerFixture();
      mode = scenario;
      const result = await gate.invoke(TOOL, { body: {} }, auth, async () => {
        invoked += 1;
        return "handler-ran";
      });
      expect(result).toEqual({ text: "tool_not_permitted", isError: true });
    }
    expect(invoked).toBe(0);
    expect(events.filter((event) => event.kind === "tool_invocation_allowed")).toHaveLength(2);
  });

  it("demonstrates unprotected identical-byte snapshot rollback without monotonic custody", async () => {
    const config = await loadSecureGateConfig({
      issuer: ISSUER, resource: pilot.url, publicKeyFile, policyFile,
      auditUrl: sinkUrl, auditToken: SINK_TOKEN,
      pythonFile: BROKER_PYTHON, configFile: brokerConfigFile,
    });
    const gate = new SecurePilotGate(config);
    const auth = verifyBearerToken(token(), config);
    let invoked = 0;
    mode = "broker-rollback-after-allow";
    const result = await gate.invoke(TOOL, { body: {} }, auth, async () => {
      invoked += 1;
      return "handler-ran";
    });
    // The intermediary revocation is invisible after a full rollback to the
    // exact earlier bytes. This is an explicit production blocker, not a pass
    // for durable withdrawal semantics.
    expect(result).toEqual({ text: "handler-ran", isError: false });
    expect(invoked).toBe(1);
  });

  it("caps concurrent Broker children before spawning a fifth check", async () => {
    const identity = {
      clientId: CLIENT, subject: SUBJECT, jti: "jti-1",
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    };
    const checks = Array.from({ length: 5 }, () => checkBrokerDecision(
      { pythonFile: BROKER_PYTHON, configFile: brokerConfigFile }, identity, TOOL,
    ));
    const settled = await Promise.allSettled(checks);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(4);
    const denied = settled.filter((item) => item.status === "rejected") as PromiseRejectedResult[];
    expect(denied).toHaveLength(1);
    expect((denied[0]?.reason as Error).message).toBe("broker busy");
  });

  it("kills an unresponsive Broker child at the bounded timeout", async () => {
    const isolatedVenv = join(directory, "hung-venv");
    await execFileAsync(BROKER_PYTHON, ["-m", "venv", "--without-pip", isolatedVenv]);
    const isolatedPython = join(isolatedVenv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    const { stdout } = await execFileAsync(isolatedPython, ["-I", "-c", "import site; print(site.getsitepackages()[0])"]);
    const packageDir = join(stdout.trim(), "mcp_permission_broker");
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, "__init__.py"), "");
    await writeFile(join(packageDir, "runtime_bridge.py"), [
      "import signal, time",
      "signal.signal(signal.SIGTERM, lambda *_: None)",
      "while True: time.sleep(1)",
    ].join("\n"));
    const started = Date.now();
    await expect(checkBrokerDecision(
      { pythonFile: isolatedPython, configFile: brokerConfigFile },
      { clientId: CLIENT, subject: SUBJECT, jti: "jti-1", expiresAt: Math.floor(Date.now() / 1000) + 120 },
      TOOL,
    )).rejects.toThrow("broker unavailable");
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_500);
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it("fails closed if the Broker child is unavailable", async () => {
    const config = await loadSecureGateConfig({
      issuer: ISSUER, resource: pilot.url, publicKeyFile, policyFile,
      auditUrl: sinkUrl, auditToken: SINK_TOKEN,
      pythonFile: BROKER_PYTHON, configFile: brokerConfigFile,
    });
    const gate = new SecurePilotGate({ ...config, pythonFile: join(directory, "missing-python.exe") });
    const auth = verifyBearerToken(token(), config);
    let invoked = 0;
    const result = await gate.invoke(TOOL, { body: {} }, auth, async () => {
      invoked += 1;
      return "handler-ran";
    });
    expect(result).toEqual({ text: "broker_unavailable", isError: true });
    expect(invoked).toBe(0);
    expect(events.map((event) => event.kind)).toEqual(["tool_invocation_denied"]);
    expect(events[0]?.payload.reason).toBe("broker_unavailable");
  });

  it("redacts sink error bodies from an actual MCP tool response", async () => {
    const client = await clientFor();
    try {
      mode = "outage";
      const result = await client.callTool({ name: TOOL, arguments: { body: { aeo_version: "0.1" } } });
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toBe("audit_receipt_unavailable");
      expect(text).not.toContain("TOP_SECRET_SINK_BODY");
      expect(events).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("rechecks revocation after receipt and before the handler", async () => {
    const client = await clientFor();
    try {
      mode = "revoke-after-allow";
      const result = await client.callTool({ name: TOOL, arguments: { body: { aeo_version: "0.1" } } });
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toBe("tool_not_permitted");
      expect(events.map((event) => event.kind)).toEqual([
        "tool_invocation_allowed", "tool_invocation_denied",
      ]);
      expect((await client.listTools()).tools).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("fails closed when a policy expires at startup or after a 201 receipt", async () => {
    const expired = Math.floor(Date.now() / 1000) - 1;
    await writePolicy([], [TOOL], expired);
    await expect(loadSecureGateConfig({
      issuer: ISSUER, resource: pilot.url, publicKeyFile, policyFile,
      auditUrl: sinkUrl, auditToken: SINK_TOKEN,
      pythonFile: BROKER_PYTHON, configFile: brokerConfigFile,
    })).rejects.toThrow();
    await writePolicy();
    const client = await clientFor();
    try {
      mode = "expire-after-allow";
      const result = await client.callTool({ name: TOOL, arguments: { body: { aeo_version: "0.1" } } });
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toBe("tool_not_permitted");
      expect(events.map((event) => event.kind)).toEqual(["tool_invocation_allowed", "tool_invocation_denied"]);
      expect((await client.listTools()).tools).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("suppresses a completed handler response when the outcome audit fails", async () => {
    const config = await loadSecureGateConfig({
      issuer: ISSUER, resource: pilot.url, publicKeyFile, policyFile,
      auditUrl: sinkUrl, auditToken: SINK_TOKEN,
      pythonFile: BROKER_PYTHON, configFile: brokerConfigFile,
    });
    const gate = new SecurePilotGate(config);
    const auth = verifyBearerToken(token(), config);
    let invoked = 0;
    mode = "outcome-outage";
    const result = await gate.invoke(TOOL, { body: {} }, auth, async () => {
      invoked += 1;
      return "secret result";
    });
    expect(invoked).toBe(1);
    expect(result).toEqual({ text: "audit_outcome_unavailable", isError: true });
    expect(events.map((event) => event.kind)).toEqual(["tool_invocation_allowed"]);
  });

  it("rejects a 201 outcome receipt with altered decision linkage after handler execution", async () => {
    const config = await loadSecureGateConfig({
      issuer: ISSUER, resource: pilot.url, publicKeyFile, policyFile,
      auditUrl: sinkUrl, auditToken: SINK_TOKEN,
      pythonFile: BROKER_PYTHON, configFile: brokerConfigFile,
    });
    const gate = new SecurePilotGate(config);
    const auth = verifyBearerToken(token(), config);
    let invoked = 0;
    mode = "tampered-link";
    const result = await gate.invoke(TOOL, { body: {} }, auth, async () => {
      invoked += 1;
      return "secret result";
    });
    expect(invoked).toBe(1);
    expect(result).toEqual({ text: "audit_outcome_unavailable", isError: true });
    expect(events.map((event) => event.kind)).toEqual([
      "tool_invocation_allowed", "tool_invocation_completed",
    ]);
  });

  it("fails closed on an invalid policy file and keeps thrown handler details private", async () => {
    const config = await loadSecureGateConfig({
      issuer: ISSUER, resource: pilot.url, publicKeyFile, policyFile,
      auditUrl: sinkUrl, auditToken: SINK_TOKEN,
      pythonFile: BROKER_PYTHON, configFile: brokerConfigFile,
    });
    const gate = new SecurePilotGate(config);
    const auth = verifyBearerToken(token(), config);
    const failure = await gate.invoke(TOOL, { body: {} }, auth, async () => {
      throw new Error("TOP_SECRET_INTERNAL_HANDLER_DETAIL");
    });
    expect(failure).toEqual({ text: "tool_failed", isError: true });
    expect(JSON.stringify(events)).not.toContain("TOP_SECRET_INTERNAL_HANDLER_DETAIL");
    expect(events.map((event) => event.kind)).toEqual([
      "tool_invocation_allowed", "tool_invocation_failed",
    ]);
    await writeFile(policyFile, "{}");
    const client = await clientFor();
    try {
      expect((await client.listTools()).tools).toEqual([]);
      const denied = await client.callTool({ name: TOOL, arguments: { body: {} } });
      expect(denied.isError).toBe(true);
      await rm(policyFile);
      expect((await client.listTools()).tools).toEqual([]);
      const missingFile = await client.callTool({ name: TOOL, arguments: { body: {} } });
      expect(missingFile.isError).toBe(true);
      await writeFile(policyFile, "x".repeat(32_769));
      expect((await client.listTools()).tools).toEqual([]);
      const oversizedFile = await client.callTool({ name: TOOL, arguments: { body: {} } });
      expect(oversizedFile.isError).toBe(true);
    } finally {
      await client.close();
    }
  });
});
