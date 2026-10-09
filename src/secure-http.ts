#!/usr/bin/env node
/**
 * Source-only loopback MCP interception pilot. The published stdio command is
 * unchanged. This entry point must not be bound or proxied to a public route.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { buildServer } from "./server.js";
import { loadSecureGateConfig, SecurePilotGate, verifyBearerToken, type SecureGateConfig } from "./secure-gate.js";

const HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 32_768;

export interface SecurePilotOptions {
  port: number;
  issuer: string;
  publicKeyFile: string;
  policyFile: string;
  auditUrl: string;
  auditToken: string;
}

export interface RunningSecurePilot {
  url: string;
  close(): Promise<void>;
}

function headerValues(req: IncomingMessage, name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i]?.toLowerCase() === name) values.push(req.rawHeaders[i + 1] ?? "");
  }
  return values;
}

function reject(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify({ error: message }));
}

export async function startSecurePilot(options: SecurePilotOptions): Promise<RunningSecurePilot> {
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error("invalid secure pilot port");
  }
  let config: SecureGateConfig | undefined;
  let gate: SecurePilotGate | undefined;
  let expectedHost: string | undefined;
  const http = createServer(async (req, res) => {
    // Deny browser-originated requests and DNS rebinding before parsing any MCP JSON.
    if (headerValues(req, "host").length !== 1 || req.headers.host !== expectedHost ||
        headerValues(req, "origin").length !== 0 || req.url !== "/mcp") {
      reject(res, 403, "forbidden");
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      reject(res, 405, "method_not_allowed");
      return;
    }
    if (!config || !gate) {
      reject(res, 503, "unavailable");
      return;
    }
    const authorization = headerValues(req, "authorization");
    if (authorization.length !== 1) {
      reject(res, 401, "unauthorized");
      return;
    }
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization[0] ?? "");
    if (!match) {
      reject(res, 401, "unauthorized");
      return;
    }
    let auth: AuthInfo;
    try {
      auth = verifyBearerToken(match[1]!, config);
    } catch {
      reject(res, 401, "unauthorized");
      return;
    }
    const length = Number(req.headers["content-length"]);
    if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
      reject(res, 413, "request_too_large");
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: MAX_REQUEST_BYTES,
    });
    const server = buildServer(gate);
    try {
      await server.connect(transport);
      await transport.handleRequest(Object.assign(req, { auth }), res);
    } catch {
      if (!res.headersSent) reject(res, 500, "request_failed");
      else if (!res.writableEnded) res.end();
    } finally {
      await server.close().catch(() => undefined);
    }
  });
  http.requestTimeout = 10_000;
  http.headersTimeout = 10_000;
  http.maxRequestsPerSocket = 100;
  try {
    await new Promise<void>((resolve, rejectListen) => {
      http.once("error", rejectListen);
      http.listen(options.port, HOST, () => {
        http.off("error", rejectListen);
        resolve();
      });
    });
    const bound = http.address();
    if (!bound || typeof bound === "string") throw new Error("invalid secure pilot address");
    expectedHost = `${HOST}:${bound.port}`;
    const url = `http://${expectedHost}/mcp`;
    config = await loadSecureGateConfig({ ...options, resource: url });
    gate = new SecurePilotGate(config);
    return {
      url,
      close: () => new Promise<void>((resolve, rejectClose) => {
        http.close((error) => error ? rejectClose(error) : resolve());
      }),
    };
  } catch {
    http.close();
    throw new Error("secure pilot startup failed");
  }
}

const isEntryPoint = (() => {
  try {
    return Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  const options = {
    port: Number(process.env.MCP_SECURE_PORT ?? "3187"),
    issuer: process.env.MCP_SECURE_ISSUER ?? "",
    publicKeyFile: process.env.MCP_SECURE_PUBLIC_KEY_FILE ?? "",
    policyFile: process.env.MCP_SECURE_POLICY_FILE ?? "",
    auditUrl: process.env.AUDIT_STREAM_URL ?? "",
    auditToken: process.env.AUDIT_STREAM_TOKEN ?? "",
  };
  startSecurePilot(options).then(({ url }) => {
    process.stderr.write(`mcp-kinetic-gain source pilot listening on ${url}\n`);
  }).catch(() => {
    process.stderr.write("mcp-kinetic-gain source pilot failed to start\n");
    process.exitCode = 1;
  });
}
