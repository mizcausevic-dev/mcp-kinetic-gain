/**
 * Attestation tools — verify ed25519 signatures over Kinetic Gain Suite
 * documents using the canonical-hash convention.
 *
 * Same wire format as `hash-attestation-rs`:
 *   {
 *     "algorithm":   "ed25519",
 *     "signed_hash": "sha256:<hex>",
 *     "signature":   "<base64>",
 *     "key_url":     "https://acme.example/keys/aeo",
 *     "signed_at":   "2026-05-15T00:00:00Z"
 *   }
 *
 * The signature is over the UTF-8 bytes of `signed_hash` (the hash string,
 * not the raw hash bytes). The verifier recomputes the canonical-JSON
 * hash of the body and matches it against `signed_hash` before checking
 * the signature.
 *
 * v0.6.0 is verify-only — signing requires a private key, which we don't
 * want loaded inside an MCP server's process.
 */
import { verifyAsync } from "@noble/ed25519";

import { canonicalJsonSha256, pretty } from "../common.js";

interface Attestation {
  algorithm: string;
  signed_hash: string;
  signature: string;
  key_url: string;
  signed_at: string;
}

/**
 * Compute the canonical-JSON hash of an arbitrary value. Returns the same
 * hash `hash-attestation-rs::canonical_hash` produces for the same input.
 */
export async function handleAttestationCanonicalHash(args: {
  body: unknown;
}): Promise<string> {
  if (args.body === undefined || args.body === null) {
    return pretty({ error: "`body` is required" });
  }
  const hash = canonicalJsonSha256(args.body);
  return pretty({ hash });
}

/**
 * Verify an Attestation envelope against a body + an ed25519 public key.
 *
 * Public key is accepted as either raw 32-byte hex or base64. The
 * signature in the envelope is always base64.
 */
export async function handleAttestationVerify(args: {
  attestation: unknown;
  body: unknown;
  public_key: string;
}): Promise<string> {
  const att = parseAttestation(args.attestation);
  if ("error" in att) return pretty(att);

  if (att.algorithm !== "ed25519") {
    return pretty({
      ok: false,
      reason: `unsupported algorithm: ${att.algorithm}`,
    });
  }

  if (args.body === undefined || args.body === null) {
    return pretty({ ok: false, reason: "`body` is required" });
  }

  const actual = canonicalJsonSha256(args.body);
  if (actual !== att.signed_hash) {
    return pretty({
      ok: false,
      reason: "hash_mismatch",
      expected: att.signed_hash,
      actual,
    });
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = decodeBase64(att.signature);
  } catch (err) {
    return pretty({
      ok: false,
      reason: "invalid_base64_signature",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  if (signatureBytes.length !== 64) {
    return pretty({
      ok: false,
      reason: "wrong_signature_length",
      bytes: signatureBytes.length,
    });
  }

  let publicKeyBytes: Uint8Array;
  try {
    publicKeyBytes = decodePublicKey(args.public_key);
  } catch (err) {
    return pretty({
      ok: false,
      reason: "invalid_public_key",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  const messageBytes = new TextEncoder().encode(att.signed_hash);
  let ok: boolean;
  try {
    ok = await verifyAsync(signatureBytes, messageBytes, publicKeyBytes);
  } catch (err) {
    return pretty({
      ok: false,
      reason: "verify_threw",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  if (!ok) return pretty({ ok: false, reason: "bad_signature" });
  return pretty({ ok: true, key_url: att.key_url, signed_at: att.signed_at });
}

/**
 * Pretty-print an Attestation envelope with shape checks. Useful for
 * "what's in this .sig.json file?" conversations.
 */
export async function handleAttestationInspect(args: {
  attestation: unknown;
}): Promise<string> {
  const att = parseAttestation(args.attestation);
  if ("error" in att) return pretty(att);

  return pretty({
    valid_envelope: true,
    algorithm: att.algorithm,
    signed_hash: att.signed_hash,
    signed_at: att.signed_at,
    key_url: att.key_url,
    signature_length_bytes: lengthOfBase64Decoded(att.signature),
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseAttestation(raw: unknown): Attestation | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { error: "`attestation` must be an object" };
  }
  const a = raw as Record<string, unknown>;
  for (const key of ["algorithm", "signed_hash", "signature", "key_url", "signed_at"]) {
    if (typeof a[key] !== "string" || (a[key] as string).length === 0) {
      return { error: `attestation.${key} must be a non-empty string` };
    }
  }
  return {
    algorithm: a.algorithm as string,
    signed_hash: a.signed_hash as string,
    signature: a.signature as string,
    key_url: a.key_url as string,
    signed_at: a.signed_at as string,
  };
}

function decodeBase64(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, "base64"));
}

function lengthOfBase64Decoded(s: string): number {
  try {
    return decodeBase64(s).length;
  } catch {
    return -1;
  }
}

/** Accept the public key as 64-char hex (32 bytes) or as base64. */
function decodePublicKey(raw: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      out[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  const bytes = decodeBase64(raw);
  if (bytes.length !== 32) {
    throw new Error(`expected 32-byte public key; got ${bytes.length}`);
  }
  return bytes;
}
