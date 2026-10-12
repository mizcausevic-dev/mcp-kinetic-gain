import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { describe, expect, it } from "vitest";

import { canonicalizeJcs } from "../src/aviation-json.js";
import { aviationMlCardSchema, mroSignoffCardSchema } from "../src/aviation-schemas.js";
import {
  handleAviationMlCardDalCheck,
  handleAviationMlCardInspect,
  handleAviationMlCardOddCheck,
  handleAviationMlCardValidate,
  handleMroSignoffVerify,
} from "../src/handlers/aviation.js";
import { buildServer, selectToolProfile, type ToolDispatchGate } from "../src/server.js";
import { runValidate } from "../src/cli.js";

const aviationCard = {
  aviation_ml_card_version: "0.1",
  system: {
    id: "synthetic-inspection-assistant",
    name: "Synthetic Inspection Assistant",
    version: "0.1.0",
    provider: "Fictional Aviation Lab",
    intended_use: "Suggest synthetic inspection regions for human review.",
  },
  assurance: {
    easa_ai_level: "2B",
    target_dal: "not_assigned",
    standards_posture: [{ identifier: "SAE ARP6983", status: "referenced" }],
  },
  odd: {
    summary: "Synthetic stationary imagery under declared conditions.",
    operating_conditions: ["stationary inspection", "declared illumination"],
    excluded_conditions: ["in-flight use"],
    coverage_evidence_refs: ["https://example.org/aviation/coverage-report.json"],
    condition_evidence: [
      { condition: "stationary inspection", evidence_refs: ["https://example.org/aviation/stationary.json"] },
      { condition: "declared illumination", evidence_refs: [] },
    ],
  },
  learning_assurance: {
    process_summary: "Model updates require a versioned review and evidence bundle.",
    evidence_refs: ["https://example.org/aviation/learning.json"],
  },
  data_management: {
    dataset_manifest_refs: ["https://example.org/aviation/dataset.json"],
    split_policy: "group_disjoint",
  },
  human_ai_teaming: {
    role: "decision_support",
    human_override_available: true,
    override_procedure_ref: "https://example.org/aviation/override",
    human_responsibility_summary: "A qualified human reviews every synthetic suggestion.",
  },
};

const mroCard = {
  mro_signoff_card_version: "0.1",
  finding: {
    id: "synthetic-borescope-finding-001",
    kind: "borescope",
    summary: "Synthetic imagery suggests a region for human inspection.",
    model_id: "synthetic-inspection-assistant",
    model_version: "0.1.0",
    confidence: 0.71,
  },
  artifact: {
    id: "synthetic-observation-001",
    sha256: createHash("sha256").update("synthetic artifact bytes").digest("hex"),
  },
  evidence_refs: ["https://example.org/aviation/evidence/synthetic.json"],
  human_review: {
    staff_id: "synthetic-reviewer-01",
    decision: "accept",
    reviewed_at: "2026-10-12T14:00:00Z",
    authority_ref: "https://example.org/aviation/authority/synthetic-reviewer-01",
  },
  signature: {
    profile: "JCS-SHA256-Ed25519-v1",
    key_id: "synthetic-reviewer-key-01",
    signed_at: "2026-10-12T14:01:00Z",
    signature_b64url: "A".repeat(86),
  },
};

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function signedMroFixture() {
  const privateKey = new Uint8Array(32).fill(7); // fixed synthetic test key, never a production credential
  const publicKey = await getPublicKeyAsync(privateKey);
  const card = copy(mroCard);
  const unsigned = copy(card) as Record<string, any>;
  delete unsigned.signature.signature_b64url;
  const digest = createHash("sha256").update(canonicalizeJcs(unsigned), "utf8").digest();
  card.signature.signature_b64url = Buffer.from(await signAsync(digest, privateKey)).toString("base64url");
  return { card, publicKeyB64url: Buffer.from(publicKey).toString("base64url") };
}

describe("aviation v0.1 disclosure tools", () => {
  it("validates the synthetic card and rejects reserved Level 3B and missing overrides", async () => {
    expect(aviationMlCardSchema.safeParse(aviationCard).success).toBe(true);
    const valid = JSON.parse(await handleAviationMlCardValidate({ document_json: JSON.stringify(aviationCard) }));
    expect(valid).toMatchObject({ valid: true, airworthiness_approval: false, evidence_verified: false });

    const level3b = copy(aviationCard);
    level3b.assurance.easa_ai_level = "3B";
    expect(JSON.parse(await handleAviationMlCardValidate({ document_json: JSON.stringify(level3b) })).valid).toBe(false);

    const noOverride = copy(aviationCard);
    noOverride.human_ai_teaming.human_override_available = false;
    delete (noOverride.human_ai_teaming as { override_procedure_ref?: string }).override_procedure_ref;
    expect(JSON.parse(await handleAviationMlCardValidate({ document_json: JSON.stringify(noOverride) })).valid).toBe(false);
  });

  it("requires one ODD evidence mapping per condition and reports unreferenced conditions", async () => {
    const duplicate = copy(aviationCard);
    duplicate.odd.condition_evidence.push(copy(duplicate.odd.condition_evidence[0]!));
    expect(aviationMlCardSchema.safeParse(duplicate).success).toBe(false);

    const check = JSON.parse(await handleAviationMlCardOddCheck({ document_json: JSON.stringify(aviationCard) }));
    expect(check.unreferenced_conditions).toEqual(["declared illumination"]);
    expect(check.global_coverage_report_referenced).toBe(true);
    expect(check.independently_verified).toBe(false);
    expect(check.coverage_adequacy).toBe("not_assessed");
  });

  it("inspects declarations and reports DAL documentation gaps without certification claims", async () => {
    const inspected = JSON.parse(await handleAviationMlCardInspect({ document_json: JSON.stringify(aviationCard) }));
    expect(inspected.system.id).toBe(aviationCard.system.id);
    expect(inspected.evidence_verified).toBe(false);
    const dal = JSON.parse(await handleAviationMlCardDalCheck({ document_json: JSON.stringify(aviationCard) }));
    expect(dal.documentation_gaps).toContain("target DAL not assigned");
    expect(dal.dal_certification_status).toBe("not_assessed");
  });

  it("rejects duplicate raw JSON keys before card validation", async () => {
    const serialized = JSON.stringify(aviationCard).replace('"aviation_ml_card_version":"0.1",', '"aviation_ml_card_version":"0.1","aviation_ml_card_version":"0.1",');
    const result = JSON.parse(await handleAviationMlCardValidate({ document_json: serialized }));
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/duplicate object key/);
  });
});

describe("MRO sign-off signature boundary", () => {
  it("verifies a synthetic JCS digest signature but withholds identity, authority, and release", async () => {
    const { card, publicKeyB64url } = await signedMroFixture();
    expect(mroSignoffCardSchema.safeParse(card).success).toBe(true);
    const result = JSON.parse(await handleMroSignoffVerify({
      document_json: JSON.stringify(card),
      expected_key_id: card.signature.key_id,
      public_key_b64url: publicKeyB64url,
      independent_artifact_sha256: card.artifact.sha256,
    }));
    expect(result).toMatchObject({
      key_id_matches_expected: true,
      signature_valid_for_supplied_key: true,
      artifact_digest_matches_supplied: true,
      artifact_bytes_checked: false,
      identity_verified: false,
      certifying_authority_verified: false,
      return_to_service_authorized: false,
    });
  });

  it("fails on tampered signed metadata, wrong key ID, wrong digest, and missing key", async () => {
    const { card, publicKeyB64url } = await signedMroFixture();
    const base = { expected_key_id: card.signature.key_id, public_key_b64url: publicKeyB64url };
    const tampered = copy(card);
    tampered.signature.signed_at = "2026-10-12T14:02:00Z";
    const badSignature = JSON.parse(await handleMroSignoffVerify({ ...base, document_json: JSON.stringify(tampered) }));
    expect(badSignature.signature_valid_for_supplied_key).toBe(false);

    const wrongId = JSON.parse(await handleMroSignoffVerify({ ...base, expected_key_id: "another-key", document_json: JSON.stringify(card) }));
    expect(wrongId).toMatchObject({ key_id_matches_expected: false, signature_valid_for_supplied_key: false });

    const wrongPublicKey = Buffer.from(await getPublicKeyAsync(new Uint8Array(32).fill(8))).toString("base64url");
    const wrongKey = JSON.parse(await handleMroSignoffVerify({ ...base, public_key_b64url: wrongPublicKey, document_json: JSON.stringify(card) }));
    expect(wrongKey.signature_valid_for_supplied_key).toBe(false);

    const wrongArtifact = JSON.parse(await handleMroSignoffVerify({ ...base, independent_artifact_sha256: "0".repeat(64), document_json: JSON.stringify(card) }));
    expect(wrongArtifact).toMatchObject({ signature_valid_for_supplied_key: true, artifact_digest_matches_supplied: false, result: "invalid" });

    await expect(handleMroSignoffVerify({ ...base, public_key_b64url: "", document_json: JSON.stringify(card) }))
      .rejects.toThrow(/public_key_b64url/);
  });

  it("rejects unsigned and override-without-reason cards", async () => {
    const unsigned = copy(mroCard) as Record<string, any>;
    delete unsigned.signature;
    expect(mroSignoffCardSchema.safeParse(unsigned).success).toBe(false);
    const override = copy(mroCard);
    override.human_review.decision = "override";
    expect(mroSignoffCardSchema.safeParse(override).success).toBe(false);
  });

  it("rejects raw duplicate keys and unsafe integer literals before MRO signature checking", async () => {
    const { card, publicKeyB64url } = await signedMroFixture();
    const base = { expected_key_id: card.signature.key_id, public_key_b64url: publicKeyB64url };
    const serialized = JSON.stringify(card);
    const duplicate = serialized.replace('"mro_signoff_card_version":"0.1",', '"mro_signoff_card_version":"0.1","mro_signoff_card_version":"0.1",');
    await expect(handleMroSignoffVerify({ ...base, document_json: duplicate })).rejects.toThrow(/duplicate object key/);
    const unsafe = serialized.replace('"confidence":0.71', '"confidence":9007199254740993');
    await expect(handleMroSignoffVerify({ ...base, document_json: unsafe })).rejects.toThrow(/I-JSON range/);
  });
});

describe("aviation CLI validation scope", () => {
  it("accepts structurally valid cards and rejects duplicate raw keys", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kg-aviation-cli-"));
    try {
      const card = copy(mroCard); // CLI checks structure, not cryptographic validity.
      const aviationPath = join(directory, "aviation.json");
      const mroPath = join(directory, "mro.json");
      const duplicatePath = join(directory, "mro-duplicate.json");
      const invalidUtf8Path = join(directory, "mro-invalid-utf8.json");
      const bomPath = join(directory, "mro-bom.json");
      await writeFile(aviationPath, JSON.stringify(aviationCard));
      await writeFile(mroPath, JSON.stringify(card));
      await writeFile(duplicatePath, JSON.stringify(card).replace('"mro_signoff_card_version":"0.1",', '"mro_signoff_card_version":"0.1","mro_signoff_card_version":"0.1",'));
      await writeFile(invalidUtf8Path, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]));
      await writeFile(bomPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(card))]));
      expect(await runValidate([aviationPath, mroPath])).toBe(0);
      expect(await runValidate([duplicatePath, invalidUtf8Path, bomPath])).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it("does not treat CLI structure validation as signature verification", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kg-aviation-cli-"));
    try {
      const { card, publicKeyB64url } = await signedMroFixture();
      card.signature.signed_at = "2026-10-12T14:02:00Z";
      const file = join(directory, "tampered-signature.json");
      await writeFile(file, JSON.stringify(card));
      expect(await runValidate([file])).toBe(0);
      const verified = JSON.parse(await handleMroSignoffVerify({
        document_json: JSON.stringify(card),
        expected_key_id: card.signature.key_id,
        public_key_b64url: publicKeyB64url,
      }));
      expect(verified.signature_valid_for_supplied_key).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("opt-in MCP aviation profile", () => {
  it("keeps 75 default tools, exposes 80 only when selected, and fails on unknown profile", () => {
    expect(selectToolProfile("").descriptors).toHaveLength(75);
    expect(selectToolProfile("aviation").descriptors).toHaveLength(80);
    expect(Object.keys(selectToolProfile("").handlers)).toHaveLength(75);
    expect(Object.keys(selectToolProfile("aviation").handlers)).toHaveLength(80);
    expect(() => selectToolProfile("unknown")).toThrow(/MCP_KG_VERTICALS/);
  });

  it("lists and calls aviation tools only when opted in", async () => {
    for (const [profile, count] of [["", 75], ["aviation", 80]] as const) {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = buildServer(profile);
      const client = new Client({ name: "aviation-profile-smoke", version: "1.0.0" }, { capabilities: {} });
      try {
        await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
        const listed = await client.listTools();
        expect(listed.tools).toHaveLength(count);
        const aviationNames = listed.tools.filter((tool) => tool.name.startsWith("aviation_ml_card_") || tool.name === "mro_signoff_verify");
        expect(aviationNames).toHaveLength(profile === "aviation" ? 5 : 0);
        const response = await client.callTool({
          name: "aviation_ml_card_validate",
          arguments: { document_json: JSON.stringify(aviationCard) },
        });
        expect(response.isError).toBe(profile === "aviation" ? undefined : true);
        if (profile === "aviation") {
          const content = response.content[0];
          expect(content?.type).toBe("text");
          if (content?.type === "text") expect(JSON.parse(content.text).valid).toBe(true);
          expect(aviationNames.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
        }
        const inherited = await client.callTool({ name: "toString", arguments: {} });
        expect(inherited.isError).toBe(true);
      } finally {
        await client.close();
        await server.close();
      }
    }
  });

  it("keeps the governed source pilot on the base profile despite aviation env opt-in", async () => {
    const previous = process.env.MCP_KG_VERTICALS;
    process.env.MCP_KG_VERTICALS = "aviation";
    const invoked: string[] = [];
    const gate: ToolDispatchGate = {
      async availableTools() { return ["suite_doc_detect_spec", "aviation_ml_card_validate"]; },
      async invoke(name) {
        invoked.push(name);
        return { text: "tool_not_permitted", isError: true };
      },
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildServer(gate);
    const client = new Client({ name: "governed-profile-smoke", version: "1.0.0" }, { capabilities: {} });
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(["suite_doc_detect_spec"]);
      const direct = await client.callTool({
        name: "aviation_ml_card_validate",
        arguments: { document_json: JSON.stringify(aviationCard) },
      });
      expect(direct.isError).toBe(true);
      expect(direct.content[0]).toEqual({ type: "text", text: "tool_not_permitted" });
      expect(invoked).toEqual(["aviation_ml_card_validate"]);
    } finally {
      await client.close();
      await server.close();
      if (previous === undefined) delete process.env.MCP_KG_VERTICALS;
      else process.env.MCP_KG_VERTICALS = previous;
    }
  });
});
