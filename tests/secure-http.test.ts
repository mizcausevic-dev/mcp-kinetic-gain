import { generateKeyPairSync, sign } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startSecurePilot, type RunningSecurePilot } from "../src/secure-http.js";
import { SecurePilotGate, loadSecureGateConfig, verifyBearerToken } from "../src/secure-gate.js";

const SINK_TOKEN = "S".repeat(40);
const ISSUER = "synthetic-issuer";
const CLIENT = "client-a";
const SUBJECT = "subject-a";
const TOOL = "suite_doc_detect_spec";

type SinkMode = "normal" | "outage" | "outcome-outage" | "bad-receipt" | "tampered-link" | "revoke-after-allow" | "expire-after-allow";

describe("loopback Streamable HTTP source pilot", () => {
  let directory: string;
  let publicKeyFile: string;
  let policyFile: string;
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
    const pair = generateKeyPairSync("ed25519");
    privateKey = pair.privateKey;
    await writeFile(publicKeyFile, pair.publicKey.export({ format: "pem", type: "spki" }));
    await writePolicy();
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
    } finally {
      await client.close();
    }
  });
});
