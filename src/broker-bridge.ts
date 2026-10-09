/** Private, bounded stdio adapter to the Python signed-card Broker. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

const MAX_RESPONSE_BYTES = 8_192;
const TIMEOUT_MS = 5_000;
const MAX_CONCURRENT_CHECKS = 4;
const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;

export interface BrokerBridgeConfig {
  pythonFile: string;
  configFile: string;
}

export interface BrokerIdentity {
  clientId: string;
  subject: string;
  jti: string;
  expiresAt: number;
}

export type BrokerDecision =
  | { outcome: "allow"; brokerCorrelationId: string; stateSha256: string; signedCardDecisionId: string }
  | { outcome: "deny"; brokerCorrelationId: string; stateSha256: string };

let activeChecks = 0;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function validateBrokerBridgeConfig(config: BrokerBridgeConfig): Promise<void> {
  if (!isAbsolute(config.pythonFile) || !isAbsolute(config.configFile)) {
    throw new Error("broker paths must be absolute");
  }
  if (!(await stat(config.pythonFile)).isFile() || !(await stat(config.configFile)).isFile()) {
    throw new Error("broker paths must name files");
  }
}

export async function checkBrokerDecision(
  config: BrokerBridgeConfig,
  identity: BrokerIdentity,
  toolName: string,
): Promise<BrokerDecision> {
  if (activeChecks >= MAX_CONCURRENT_CHECKS) throw new Error("broker busy");
  activeChecks += 1;
  try {
    return await runBrokerChild(config, identity, toolName);
  } finally {
    activeChecks -= 1;
  }
}

async function runBrokerChild(
  config: BrokerBridgeConfig,
  identity: BrokerIdentity,
  toolName: string,
): Promise<BrokerDecision> {
  const requestId = randomUUID();
  const request = JSON.stringify({
    version: 1,
    request_id: requestId,
    client_id: identity.clientId,
    subject: identity.subject,
    jti: identity.jti,
    expires_at: identity.expiresAt,
    tool_name: toolName,
  });
  const child = spawn(config.pythonFile, [
    "-I", "-m", "mcp_permission_broker.runtime_bridge", config.configFile,
  ], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
    env: {
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      LANG: "C.UTF-8",
      PYTHONNOUSERSITE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
    },
  });
  const raw = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      child.stdin.destroy();
      child.stdout.destroy();
      reject(new Error("broker unavailable"));
    };
    const timer = setTimeout(fail, TIMEOUT_MS);
    child.stdout.on("data", (part: Buffer) => {
      size += part.length;
      if (size > MAX_RESPONSE_BYTES) fail();
      else chunks.push(part);
    });
    child.stdin.on("error", () => undefined);
    child.once("error", fail);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error("broker unavailable"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(`${request}\n`);
  });
  if (!/^[^\r\n]+\r?\n$/.test(raw)) throw new Error("invalid broker response");
  const value: unknown = JSON.parse(raw.trimEnd());
  if (!record(value) ||
      !["version", "request_id", "outcome", "broker_correlation_id", "state_sha256"]
        .every((key) => Object.hasOwn(value, key)) ||
      value.version !== 1 || value.request_id !== requestId ||
      (value.outcome !== "allow" && value.outcome !== "deny") ||
      typeof value.broker_correlation_id !== "string" || !UUID.test(value.broker_correlation_id) ||
      typeof value.state_sha256 !== "string" || !HASH.test(value.state_sha256)) {
    throw new Error("invalid broker response");
  }
  if (value.outcome === "allow") {
    if (Object.keys(value).length !== 6 ||
        typeof value.signed_card_decision_id !== "string" ||
        !IDENTIFIER.test(value.signed_card_decision_id)) {
      throw new Error("invalid broker response");
    }
    return {
      outcome: "allow", brokerCorrelationId: value.broker_correlation_id,
      stateSha256: value.state_sha256,
      signedCardDecisionId: value.signed_card_decision_id,
    };
  }
  if (Object.keys(value).length !== 5 &&
      !(Object.keys(value).length === 6 && value.signed_card_decision_id === null)) {
    throw new Error("invalid broker response");
  }
  return {
    outcome: "deny", brokerCorrelationId: value.broker_correlation_id,
    stateSha256: value.state_sha256,
  };
}
