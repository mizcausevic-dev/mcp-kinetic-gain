/** Optional aviation vertical, enabled with MCP_KG_VERTICALS=aviation. */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const localReadOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const documentJson = {
  type: "string" as const,
  description: "Complete v0.1 card serialized as JSON text, not a parsed object or URL. The server parses it locally, rejects duplicate keys and oversized input, and makes no network request. Use synthetic data in hosted clients.",
};

export const aviationToolDescriptors: Tool[] = [
  {
    name: "aviation_ml_card_validate",
    description: "Check an inline Aviation ML Assurance Card against the v0.1 disclosure schema and Suite conditional rules. Returns {valid, system_id, version} or {valid:false, reason}; no network call or side effect. Use before inspect or purchasing review. A valid card is a well-formed vendor declaration, not airworthiness approval, regulatory acceptance, or verified evidence.",
    annotations: localReadOnly,
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: documentJson },
    },
  },
  {
    name: "aviation_ml_card_inspect",
    description: "Summarize an existing inline Aviation ML Assurance Card after structural validation. Returns declared system, EASA AI level, target DAL, ODD, evidence-reference counts, and human role as JSON text. It does not fetch referenced evidence or establish safety or certification. Use validate for an explicit valid/invalid result; use odd_check or dal_check for focused disclosure gaps.",
    annotations: localReadOnly,
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: documentJson },
    },
  },
  {
    name: "aviation_ml_card_odd_check",
    description: "Find declared operating-design-domain conditions whose card mapping has no evidence references. Returns each condition, missing-reference names, and whether any global coverage report is referenced. It does not read datasets, validate evidence contents, or judge coverage adequacy; independently_verified is always false. Use with a validated card, then examine the referenced dataset provenance report separately.",
    annotations: localReadOnly,
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: documentJson },
    },
  },
  {
    name: "aviation_ml_card_dal_check",
    description: "Review the card's proposed target development-assurance level and supporting disclosure references. Returns declared DAL, basis-reference presence, standards identifiers/statuses, and documentation gaps. No regulation or standard is evaluated and no DAL assignment is approved. Use this to plan a human assurance review, never as a certification decision.",
    annotations: localReadOnly,
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: { document_json: documentJson },
    },
  },
  {
    name: "mro_signoff_verify",
    description: "Verify an inline MRO AI Sign-off Card's JCS-SHA256-Ed25519 signature against a caller-pinned public key and key ID; optionally compare a separately computed exact-artifact SHA-256 digest. Returns distinct cryptographic, artifact-match, identity, staff-authority, and return-to-service states. A valid signature proves integrity for the supplied key only; it never authenticates certifying staff, grants authority, or releases an aircraft to service. No network call or side effect.",
    annotations: localReadOnly,
    inputSchema: {
      type: "object",
      required: ["document_json", "expected_key_id", "public_key_b64url"],
      additionalProperties: false,
      properties: {
        document_json: {
          ...documentJson,
          description: "Complete signed MRO AI Sign-off Card as JSON text. The signature covers every field except signature.signature_b64url, including key_id and signed_at. A missing or malformed signature fails verification.",
        },
        expected_key_id: {
          type: "string",
          description: "Key ID from an external trusted roster. Must equal the card's signed signature.key_id; the server does not retrieve or trust a roster itself.",
        },
        public_key_b64url: {
          type: "string",
          description: "Externally pinned 32-byte Ed25519 public key in unpadded base64url. Never use a key supplied by the card as trust evidence.",
        },
        independent_artifact_sha256: {
          type: "string",
          pattern: "^[0-9a-f]{64}$",
          description: "Optional SHA-256, lowercase hex, computed by the caller from the exact artifact bytes with no normalization. The server compares it with artifact.sha256 but does not fetch artifact bytes.",
        },
      },
    },
  },
];
