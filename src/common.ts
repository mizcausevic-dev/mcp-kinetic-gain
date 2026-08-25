/**
 * Shared utilities used by every spec handler.
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

const ACCEPT_HEADER = "application/aeo+json, application/json";

export function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end -= 1;
  return end === s.length ? s : s.slice(0, end);
}

/**
 * SSRF guard for every fetchJson() call across all 20 url/origin-accepting
 * tools. This is the single choke point: every handler in src/handlers goes
 * through fetchJson() (some via a per-file loadDoc/loadCard wrapper, some
 * calling it directly), so putting the check here covers all of them rather
 * than needing it duplicated per file.
 *
 * Two layers, not one:
 *
 *   1. assertSafeFetchTarget() -- an early, fast-fail check: scheme must be
 *      http(s), and a first DNS snapshot must not land in a blocked range.
 *      Cheap, gives a clear error before any network activity, and is
 *      authoritative for literal-IP targets (nothing to resolve, so nothing
 *      to race).
 *
 *   2. makeGuardedLookup() -- the actual enforcement point for hostname
 *      targets, wired into the undici Agent's `connect.lookup`. This is
 *      called at the moment a socket is about to be opened, and the address
 *      it returns IS the address the socket connects to -- not a separate
 *      earlier answer. This is what closes the DNS-rebinding gap: a domain
 *      whose DNS server hands out a public address on an early lookup and a
 *      private one moments later cannot slip through, because there is no
 *      "moments later" here -- the check and the connection use the same
 *      resolution, at the same time.
 *
 * Rejects RFC1918, loopback, and link-local ranges on both the literal host
 * in the URL and every address it resolves to: 127.0.0.0/8, 10.0.0.0/8,
 * 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1, fc00::/7, fe80::/10.
 */
export class UnsafeFetchTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeFetchTargetError";
  }
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`invalid ipv4 address: ${ip}`);
  }
  const [a, b, c, d] = parts as [number, number, number, number];
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

const BLOCKED_IPV4: Array<{ base: number; bits: number }> = [
  { base: ipv4ToInt("127.0.0.0"), bits: 8 }, // loopback
  { base: ipv4ToInt("10.0.0.0"), bits: 8 }, // RFC1918
  { base: ipv4ToInt("172.16.0.0"), bits: 12 }, // RFC1918
  { base: ipv4ToInt("192.168.0.0"), bits: 16 }, // RFC1918
  { base: ipv4ToInt("169.254.0.0"), bits: 16 }, // link-local
];

/** Exported for direct unit testing of the range math, not just indirectly
 * through assertSafeFetchTarget. */
export function isBlockedIpv4(ip: string): boolean {
  const asInt = ipv4ToInt(ip);
  return BLOCKED_IPV4.some(({ base, bits }) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (asInt & mask) === (base & mask);
  });
}

/** Converts a trailing dotted-decimal IPv4 segment (RFC 4291 SS2.2 case 3,
 * e.g. the "127.0.0.1" in "::ffff:127.0.0.1") into its two proper 16-bit
 * hex groups. Feeding a string like "127.0.0.1" straight into
 * parseInt(g, 16) silently truncates at the first "." and produces a wrong
 * value (0x127) instead of throwing, which is what let IPv4-mapped
 * addresses slip past every check below undetected. */
function ipv4TailToHexGroups(seg: string): [string, string] {
  const octets = seg.split(".").map((o) => Number(o));
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    throw new Error(`invalid embedded ipv4 segment: ${seg}`);
  }
  const [a, b, c, d] = octets as [number, number, number, number];
  const high = ((a << 8) | b) >>> 0;
  const low = ((c << 8) | d) >>> 0;
  return [high.toString(16).padStart(4, "0"), low.toString(16).padStart(4, "0")];
}

/** Maps a raw (":"-split) list of group strings, expanding any trailing
 * dotted-decimal segment into its two hex groups via ipv4TailToHexGroups.
 * Ordinary hex groups never contain ".", so detecting one is unambiguous. */
function expandGroupSegment(raw: string[]): string[] {
  const out: string[] = [];
  for (const g of raw) {
    if (g.includes(".")) {
      out.push(...ipv4TailToHexGroups(g));
    } else {
      out.push(g);
    }
  }
  return out;
}

function expandIpv6Groups(addr: string): string[] {
  const parts = addr.split("::");
  if (parts.length > 2) throw new Error(`invalid ipv6 address: ${addr}`);
  const head = parts[0]
    ? expandGroupSegment(parts[0].split(":").filter((s) => s.length > 0))
    : [];
  const tail =
    parts.length === 2 && parts[1]
      ? expandGroupSegment(parts[1].split(":").filter((s) => s.length > 0))
      : [];
  if (parts.length === 1) {
    if (head.length !== 8) throw new Error(`invalid ipv6 address: ${addr}`);
    return head;
  }
  const fillCount = 8 - head.length - tail.length;
  if (fillCount < 0) throw new Error(`invalid ipv6 address: ${addr}`);
  return [...head, ...Array(fillCount).fill("0"), ...tail];
}

function ipv6ToBigInt(addr: string): bigint {
  const groups = expandIpv6Groups(addr);
  let value = 0n;
  for (const g of groups) value = (value << 16n) | BigInt(parseInt(g === "" ? "0" : g, 16));
  return value;
}

function ipv6InCidr(value: bigint, cidrBase: string, prefixBits: number): boolean {
  const base = ipv6ToBigInt(cidrBase);
  const mask = (~0n << (128n - BigInt(prefixBits))) & ((1n << 128n) - 1n);
  return (value & mask) === (base & mask);
}

/** If `value`'s top 96 bits are all zero (the deprecated IPv4-compatible
 * form, ::/96) or are zero-then-0xffff (the IPv4-mapped form, ::ffff:0:0/96),
 * returns the embedded low-32-bit IPv4 address as a dotted string so it can
 * be checked through isBlockedIpv4. Returns null for any other address. */
function extractEmbeddedIpv4(value: bigint): string | null {
  const top96 = value >> 32n;
  if (top96 !== 0n && top96 !== 0xffffn) return null;
  const low32 = Number(value & 0xffffffffn);
  return [(low32 >>> 24) & 0xff, (low32 >>> 16) & 0xff, (low32 >>> 8) & 0xff, low32 & 0xff].join(".");
}

/** ::1 (loopback), fc00::/7 (unique local), fe80::/10 (link-local), and
 * both IPv4-embedding forms (::ffff:0:0/96 and the deprecated ::/96) --
 * an IPv4-mapped or IPv4-compatible address is exactly as blocked as the
 * IPv4 address it embeds, checked via isBlockedIpv4. Without this, every
 * range above and every RFC1918/loopback/link-local check in isBlockedIpv4
 * was bypassable by writing the same destination as ::ffff:a.b.c.d, since
 * net.isIP() routes any IPv6-syntax string here and this function had no
 * idea those forms existed.
 * Exported for direct unit testing of the range math. */
export function isBlockedIpv6(ip: string): boolean {
  let value: bigint;
  try {
    value = ipv6ToBigInt(ip);
  } catch {
    return true; // can't parse it confidently -- fail closed
  }
  if (value === 1n) return true; // ::1
  if (ipv6InCidr(value, "fc00::", 7)) return true;
  if (ipv6InCidr(value, "fe80::", 10)) return true;
  const embeddedIpv4 = extractEmbeddedIpv4(value);
  if (embeddedIpv4 !== null && isBlockedIpv4(embeddedIpv4)) return true;
  return false;
}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address);
}

/** A resolver is just "given a hostname, return the addresses it maps to."
 * The real implementation calls node:dns/promises. Tests inject a fake one
 * so the guard's *logic* can be proven without needing a real DNS server
 * that can be made to answer differently on successive queries -- which is
 * exactly the rebinding scenario this exists to catch. */
export type AddressResolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

async function defaultResolve(hostname: string): Promise<Array<{ address: string; family: number }>> {
  return lookup(hostname, { all: true });
}

/**
 * Test-only escape hatch, hard-gated so it cannot function as a callable
 * bypass in the published package. Real handler calls have no path to this
 * regardless -- it is an explicitly named export that a *test file* calls
 * directly, to let its own local mock HTTP servers (127.0.0.1 on an
 * OS-assigned ephemeral port, a different one each run) through the guard
 * without weakening it for anything else.
 *
 * Both functions throw unless process.env.VITEST is exactly "true" -- the
 * marker vitest itself sets on every worker process, confirmed empirically
 * rather than assumed (a quick throwaway test printed process.env.VITEST
 * under a real `vitest run`). This is deliberately narrower than the more
 * common NODE_ENV==="test" convention: other tools set NODE_ENV=test for
 * unrelated reasons, so that check alone would activate in more contexts
 * than intended. VITEST is vitest's own internal signal that vitest itself
 * is the process running right now, which is a much smaller, harder to
 * accidentally-satisfy set of circumstances -- and it will never be true
 * in a consumer's real deployment of the published package, since nothing
 * about running this MCP server sets it.
 *
 * These functions are exported from src/common.ts (not moved into a test
 * file) because assertSafeFetchTarget needs a single shared place to check
 * against, and that place has to live in the same module as the guard
 * itself. The gate is what keeps that necessity from also being a hole.
 */
const testAllowedHosts = new Set<string>();

function assertRunningUnderVitest(fnName: string): void {
  if (process.env.VITEST !== "true") {
    throw new Error(
      `${fnName} is test-only and is inert outside a real vitest run (process.env.VITEST !== "true"). ` +
        "If you are seeing this from an application that depends on this package, this function was " +
        "never meant to be called outside this repo's own test suite.",
    );
  }
}

export function __allowFetchTargetForTests(hostPort: string): void {
  assertRunningUnderVitest("__allowFetchTargetForTests");
  testAllowedHosts.add(hostPort);
}

export function __clearFetchTargetAllowlistForTests(): void {
  assertRunningUnderVitest("__clearFetchTargetAllowlistForTests");
  testAllowedHosts.clear();
}

export async function assertSafeFetchTarget(
  rawUrl: string,
  resolve: AddressResolver = defaultResolve,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeFetchTargetError(`not a valid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeFetchTargetError(`scheme not allowed: ${parsed.protocol}`);
  }
  if (testAllowedHosts.has(parsed.host)) {
    return;
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const kind = net.isIP(hostname);
  if (kind !== 0) {
    if (isBlockedAddress(hostname, kind)) {
      throw new UnsafeFetchTargetError(`blocked address range: ${hostname}`);
    }
    return; // literal IP: nothing left to resolve, nothing to re-check later
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolve(hostname);
  } catch (err) {
    throw new UnsafeFetchTargetError(
      `could not resolve host: ${hostname} (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  for (const { address, family } of addresses) {
    if (isBlockedAddress(address, family)) {
      throw new UnsafeFetchTargetError(`${hostname} resolves to a blocked address range (${address})`);
    }
  }
}

/**
 * Builds a Node-style `lookup(hostname, options, callback)` function suitable
 * for an undici Agent's `connect.lookup`. This is the connect-time half of
 * the guard: whatever address this returns is the address the socket
 * connects to, in the same call, so there is no gap between "checked" and
 * "used" for an attacker's DNS server to exploit.
 *
 * Node calls this with `options.all` set for the modern Happy-Eyeballs path;
 * both the array form and the single-address legacy form are handled.
 */
export function makeGuardedLookup(resolve: AddressResolver = defaultResolve) {
  return function guardedLookup(
    hostname: string,
    options: { all?: boolean },
    callback: (
      err: Error | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ): void {
    resolve(hostname)
      .then((addresses) => {
        for (const { address, family } of addresses) {
          if (isBlockedAddress(address, family)) {
            callback(
              new UnsafeFetchTargetError(
                `${hostname} resolves to a blocked address range at connect time (${address})`,
              ),
              "",
            );
            return;
          }
        }
        const first = addresses[0];
        if (!first) {
          callback(new Error(`no addresses resolved for ${hostname}`), "");
          return;
        }
        if (options.all) {
          callback(null, addresses);
        } else {
          callback(null, first.address, first.family);
        }
      })
      .catch((err) => callback(err instanceof Error ? err : new Error(String(err)), ""));
  };
}

/** Shared dispatcher for the production path (real DNS). Tests build their
 * own Agent with an injected resolver rather than using this one, so a
 * rebinding scenario can be simulated deterministically. */
const guardedAgent = new Agent({ connect: { lookup: makeGuardedLookup() } });

async function readBodyWithLimit(
  response: UndiciResponse,
  maxBytes: number | undefined,
  controller: AbortController,
): Promise<string> {
  if (maxBytes === undefined) return response.text();
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) > maxBytes) {
    controller.abort();
    throw new Error(`response exceeds ${maxBytes} byte limit (Content-Length: ${contentLengthHeader})`);
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      controller.abort();
      throw new Error(`response exceeds ${maxBytes} byte limit`);
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/**
 * @param maxBytes Optional hard cap on response body size, enforced against
 *   both a lying/missing Content-Length and the actual bytes read. Omit for
 *   the historical unlimited behavior every existing caller relies on;
 *   pass it explicitly for a specific call site that needs it (aeo_fetch).
 */
export async function fetchJson(
  url: string,
  timeoutMs = 10_000,
  maxBytes?: number,
): Promise<unknown> {
  await assertSafeFetchTarget(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await undiciFetch(url, {
      headers: { Accept: ACCEPT_HEADER },
      signal: controller.signal,
      dispatcher: guardedAgent,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} (${url})`);
    }
    const text = await readBodyWithLimit(response, maxBytes, controller);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * SHA-256 over canonicalized UTF-8 bytes:
 *   - normalize line endings to LF
 *   - strip a single trailing newline
 * Matches the rule defined in the AI Evidence Format and Prompt
 * Provenance specifications.
 */
export function canonicalSha256(content: string): string {
  let normalized = content.replace(/\r\n/g, "\n");
  if (normalized.endsWith("\n")) {
    normalized = normalized.slice(0, -1);
  }
  const hex = createHash("sha256").update(normalized, "utf8").digest("hex");
  return `sha256:${hex}`;
}

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * SHA-256 over canonical JSON of a parsed value: sorted object keys,
 * no whitespace, UTF-8. This is the **structural** hash convention used
 * across the Kinetic Gain implementation stack (procurement-decision-api,
 * aeo-validator-service, aeo-graph-explorer-rs, hash-attestation-rs).
 *
 * Distinct from `canonicalSha256()` above, which hashes a *text content*
 * string after line-ending normalization (the AI Evidence / Prompt
 * Provenance convention).
 *
 * Identical JSON values produce identical hashes regardless of how the
 * input was originally serialised:
 *   { "foo": 1, "bar": 2 }  and  { "bar": 2, "foo": 1 }  -> same hash.
 */
export function canonicalJsonSha256(value: unknown): string {
  const canonical = canonicalJson(value);
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${hex}`;
}

/** Internal — canonical JSON: sorted keys, no whitespace. */
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    // JSON.stringify of a non-finite number is "null" — preserve that.
    if (!Number.isFinite(value)) return "null";
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]));
    return "{" + parts.join(",") + "}";
  }
  // undefined / symbol / function — JSON doesn't carry them; treat as null.
  return "null";
}

export function errorJson(error: string, details: Record<string, unknown> = {}): string {
  return pretty({ error, ...details });
}