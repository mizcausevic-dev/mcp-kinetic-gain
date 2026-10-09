/**
 * Loopback-only MCP source pilot. This is a transport gate, not a Decision Card
 * or Broker policy decision. Only the explicitly selected pure tool can run.
 */
import { createPublicKey, randomUUID, verify, type KeyObject } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import type { ToolDispatchGate } from "./server.js";

const SOURCE = "mcp-kinetic-gain";
const PILOT_TOOL = "suite_doc_detect_spec";
const MAX_POLICY_BYTES = 32_768;
const MAX_RECEIPT_BYTES = 8_192;
const MAX_TOKEN_BYTES = 8_192;
const MAX_TOKEN_LIFETIME_SECONDS = 300;
const MAX_POLICY_LIFETIME_SECONDS = 300;
const AUDIT_TIMEOUT_MS = 3_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;

type JsonRecord = Record<string, unknown>;

export interface SecureGateConfig {
  issuer: string;
  resource: string;
  publicKey: KeyObject;
  policyFile: string;
  auditUrl: string;
  auditToken: string;
}

interface Principal {
  clientId: string;
  subject: string;
  jti: string;
  expiresAt: number;
}

interface GatePolicy {
  clients: Record<string, { subject: string; allowedTools: string[] }>;
  revokedJtis: Set<string>;
}

interface AuditReceipt {
  event_id: number;
  hash: string;
}

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function strictBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid token encoding");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("invalid token encoding");
  return decoded;
}

function parseJwtPart(value: string): JsonRecord {
  const decoded = strictBase64Url(value);
  if (decoded.byteLength > MAX_TOKEN_BYTES) throw new Error("token part too large");
  const parsed: unknown = JSON.parse(decoded.toString("utf8"));
  if (!record(parsed)) throw new Error("invalid token part");
  return parsed;
}

export function verifyBearerToken(raw: string, config: SecureGateConfig): AuthInfo {
  if (Buffer.byteLength(raw, "utf8") > MAX_TOKEN_BYTES) throw new Error("token too large");
  const parts = raw.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("invalid token");
  const [encodedHeader, encodedBody, encodedSignature] = parts as [string, string, string];
  const header = parseJwtPart(encodedHeader);
  if (!hasOnlyKeys(header, ["alg", "typ"]) || header.alg !== "EdDSA" || header.typ !== "JWT") {
    throw new Error("unsupported token header");
  }
  const signature = strictBase64Url(encodedSignature);
  if (signature.length !== 64 ||
      !verify(null, Buffer.from(`${encodedHeader}.${encodedBody}`), config.publicKey, signature)) {
    throw new Error("invalid token signature");
  }
  const claims = parseJwtPart(encodedBody);
  if (!hasOnlyKeys(claims, ["iss", "aud", "sub", "client_id", "jti", "scope", "iat", "nbf", "exp"]) ||
      claims.iss !== config.issuer || claims.aud !== config.resource ||
      !identifier(claims.sub) || !identifier(claims.client_id) || !identifier(claims.jti) ||
      typeof claims.scope !== "string" || claims.scope !== "mcp:tools" ||
      !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.nbf) ||
      !Number.isSafeInteger(claims.exp)) {
    throw new Error("invalid token claims");
  }
  const issuedAt = claims.iat as number;
  const notBefore = claims.nbf as number;
  const expiresAt = claims.exp as number;
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now || notBefore > now || expiresAt <= now ||
      notBefore < issuedAt || expiresAt - issuedAt > MAX_TOKEN_LIFETIME_SECONDS) {
    throw new Error("token outside validity window");
  }
  return {
    token: "[redacted]",
    clientId: claims.client_id as string,
    scopes: ["mcp:tools"],
    expiresAt,
    resource: new URL(config.resource),
    extra: { subject: claims.sub, jti: claims.jti },
  };
}

function principalFromAuth(auth: AuthInfo | undefined, config: SecureGateConfig): Principal {
  if (!auth || auth.resource?.href !== config.resource ||
      auth.scopes.length !== 1 || auth.scopes[0] !== "mcp:tools" ||
      !identifier(auth.clientId) || !identifier(auth.extra?.subject) ||
      !identifier(auth.extra?.jti) || typeof auth.expiresAt !== "number" ||
      auth.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error("unauthorized");
  }
  return {
    clientId: auth.clientId,
    subject: auth.extra.subject,
    jti: auth.extra.jti,
    expiresAt: auth.expiresAt,
  };
}

async function readGatePolicy(path: string): Promise<GatePolicy> {
  // Keep the same open file descriptor through validation and the bounded
  // read. Checking a path with stat() then opening it would race an atomic
  // replacement of the policy file.
  const handle = await open(path, "r");
  let raw: Buffer;
  try {
    if (!(await handle.stat()).isFile()) throw new Error("invalid gate policy file");
    const bytes = Buffer.alloc(MAX_POLICY_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_POLICY_BYTES) throw new Error("invalid gate policy file");
    raw = bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
  const value: unknown = JSON.parse(raw.toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (!record(value) || !hasOnlyKeys(value, ["version", "valid_until", "clients", "revoked_jtis"]) ||
      value.version !== 1 || !Number.isSafeInteger(value.valid_until) ||
      (value.valid_until as number) <= now ||
      (value.valid_until as number) > now + MAX_POLICY_LIFETIME_SECONDS ||
      !record(value.clients) || !Array.isArray(value.revoked_jtis) ||
      Object.keys(value.clients).length > 100 || value.revoked_jtis.length > 1_000 ||
      !value.revoked_jtis.every(identifier)) {
    throw new Error("invalid gate policy");
  }
  const clients: GatePolicy["clients"] = Object.create(null) as GatePolicy["clients"];
  for (const [clientId, entry] of Object.entries(value.clients)) {
    if (!identifier(clientId) || !record(entry) ||
        !hasOnlyKeys(entry, ["subject", "allowed_tools"]) ||
        !identifier(entry.subject) || !Array.isArray(entry.allowed_tools) ||
        entry.allowed_tools.length > 1 ||
        !entry.allowed_tools.every((name) => name === PILOT_TOOL)) {
      throw new Error("invalid gate policy client");
    }
    clients[clientId] = { subject: entry.subject, allowedTools: entry.allowed_tools };
  }
  return { clients, revokedJtis: new Set(value.revoked_jtis as string[]) };
}

function permitted(principal: Principal, policy: GatePolicy, name: string): boolean {
  const client = policy.clients[principal.clientId];
  return Boolean(client && client.subject === principal.subject &&
    !policy.revokedJtis.has(principal.jti) &&
    principal.expiresAt > Math.floor(Date.now() / 1000) &&
    client.allowedTools.includes(name));
}

function validPilotArgs(args: Record<string, unknown>): boolean {
  return record(args) && Object.keys(args).length === 1 &&
    Object.hasOwn(args, "body") && record(args.body);
}

async function boundedResponse(response: Response): Promise<JsonRecord> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RECEIPT_BYTES) throw new Error("audit response too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty audit response");
  let size = 0;
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_RECEIPT_BYTES) {
      await reader.cancel();
      throw new Error("audit response too large");
    }
    chunks.push(Buffer.from(value));
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!record(parsed)) throw new Error("invalid audit response");
  return parsed;
}

export class SecurePilotGate implements ToolDispatchGate {
  constructor(private readonly config: SecureGateConfig) {}

  private async event(kind: string, payload: JsonRecord): Promise<AuditReceipt> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AUDIT_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.config.auditUrl}/events`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.auditToken}`, "content-type": "application/json" },
        body: JSON.stringify({ kind, source: SOURCE, payload }),
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status !== 201) throw new Error("audit refused event");
      const receipt = await boundedResponse(response);
      const receivedPayload = receipt.payload;
      if (receipt.source !== SOURCE || receipt.kind !== kind ||
          !record(receivedPayload) ||
          Object.keys(receivedPayload).length !== Object.keys(payload).length ||
          !Object.entries(payload).every(([key, value]) => receivedPayload[key] === value) ||
          !Number.isSafeInteger(receipt.event_id) || (receipt.event_id as number) <= 0 ||
          typeof receipt.hash !== "string" || !HASH.test(receipt.hash)) {
        throw new Error("invalid audit receipt");
      }
      return { event_id: receipt.event_id as number, hash: receipt.hash };
    } finally {
      clearTimeout(timeout);
    }
  }

  async availableTools(auth: AuthInfo | undefined): Promise<string[]> {
    const principal = principalFromAuth(auth, this.config);
    const policy = await readGatePolicy(this.config.policyFile);
    return permitted(principal, policy, PILOT_TOOL) ? [PILOT_TOOL] : [];
  }

  async invoke(
    name: string,
    args: Record<string, unknown>,
    auth: AuthInfo | undefined,
    handler: () => Promise<string>,
  ): Promise<{ text: string; isError?: boolean }> {
    let principal: Principal;
    try {
      principal = principalFromAuth(auth, this.config);
    } catch {
      return { text: "unauthorized", isError: true };
    }
    const correlationId = randomUUID();
    const basis = { correlation_id: correlationId, tool_name: name, client_id: principal.clientId };
    let allowed = false;
    try {
      allowed = name === PILOT_TOOL && validPilotArgs(args) &&
        permitted(principal, await readGatePolicy(this.config.policyFile), name);
    } catch {
      // An unreadable or malformed source-owned policy file fails closed.
    }
    if (!allowed) {
      try {
        await this.event("tool_invocation_denied", { ...basis, reason: "gate_denied" });
      } catch {
        // The call is still denied. The missing denial event is a documented gap.
      }
      return { text: "tool_not_permitted", isError: true };
    }

    let decision: AuditReceipt;
    try {
      decision = await this.event("tool_invocation_allowed", {
        ...basis, gate_config_version: 1,
      });
    } catch {
      return { text: "audit_receipt_unavailable", isError: true };
    }
    let stillPermitted = false;
    try {
      stillPermitted = permitted(principal, await readGatePolicy(this.config.policyFile), name);
    } catch {
      // A stale, missing, or malformed local policy cannot authorize a handler.
    }
    if (!stillPermitted) {
      try {
        await this.event("tool_invocation_denied", { ...basis, reason: "gate_changed_after_receipt" });
      } catch {
        // A denial remains effective even when the sink cannot record it.
      }
      return { text: "tool_not_permitted", isError: true };
    }

    let result: string;
    try {
      result = await handler();
    } catch {
      try {
        await this.event("tool_invocation_failed", {
          ...basis, decision_event_id: decision.event_id, decision_hash: decision.hash,
          status: "handler_error",
        });
      } catch {
        return { text: "audit_outcome_unavailable", isError: true };
      }
      return { text: "tool_failed", isError: true };
    }
    const structuredError = (() => {
      try {
        const parsed: unknown = JSON.parse(result);
        return record(parsed) && Object.hasOwn(parsed, "error");
      } catch {
        return false;
      }
    })();
    try {
      await this.event(structuredError ? "tool_invocation_failed" : "tool_invocation_completed", {
        ...basis, decision_event_id: decision.event_id, decision_hash: decision.hash,
        status: structuredError ? "structured_error" : "ok",
      });
    } catch {
      // This pure pilot tool has already run; suppress its response on audit failure.
      return { text: "audit_outcome_unavailable", isError: true };
    }
    return { text: structuredError ? "tool_failed" : result, isError: structuredError };
  }
}

export async function loadSecureGateConfig(input: {
  issuer: string;
  resource: string;
  publicKeyFile: string;
  policyFile: string;
  auditUrl: string;
  auditToken: string;
}): Promise<SecureGateConfig> {
  let validAuditUrl = false;
  try {
    const parsed = new URL(input.auditUrl);
    const port = Number(parsed.port);
    validAuditUrl = parsed.protocol === "http:" && parsed.hostname === "127.0.0.1" &&
      parsed.username === "" && parsed.password === "" && parsed.pathname === "/" &&
      parsed.search === "" && parsed.hash === "" && input.auditUrl === parsed.origin &&
      Number.isInteger(port) && port >= 1 && port <= 65_535;
  } catch {
    // Invalid URLs fail the startup gate.
  }
  if (!identifier(input.issuer) || !isAbsolute(input.publicKeyFile) ||
      !isAbsolute(input.policyFile) || !validAuditUrl ||
      !/^[!-~]{32,256}$/.test(input.auditToken)) {
    throw new Error("invalid secure pilot configuration");
  }
  const publicKey = createPublicKey(await readFile(input.publicKeyFile));
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("secure pilot requires Ed25519 public key");
  await readGatePolicy(input.policyFile);
  return { issuer: input.issuer, resource: input.resource, publicKey,
    policyFile: input.policyFile, auditUrl: input.auditUrl, auditToken: input.auditToken };
}
