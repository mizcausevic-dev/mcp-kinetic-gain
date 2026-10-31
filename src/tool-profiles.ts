import { toolDescriptors } from "./tools.js";

/** A small, opt-in task menu. This is a selection hypothesis, not a new API. */
export const CORE_TOOL_NAMES = [
  "aeo_inspect",
  "prompt_provenance_validate",
  "agent_card_validate",
  "ai_evidence_validate",
  "tool_card_validate",
  "tutor_card_validate",
  "disclosure_validate",
  "aup_validate",
  "clinical_ai_validate",
  "incident_validate",
  "decision_card_validate",
  "claims_card_validate",
  "aup_check_compliance",
  "ai_evidence_verify_hash",
  "decision_card_signature_check",
  "attestation_verify",
  "audit_chain_verify",
  "suite_doc_detect_spec",
  "suite_doc_drift",
  "decision_card_inspect",
] as const;

export type ToolProfileName = "compat" | "core";

export type ToolProfile = {
  name: ToolProfileName;
  names: Set<string>;
  descriptors: typeof toolDescriptors;
};

export function selectToolProfile(value: string | undefined = process.env.MCP_KG_TOOL_PROFILE): ToolProfile {
  const name = value === undefined || value.trim() === "" ? "compat" : value.trim();
  if (name !== "compat" && name !== "core") {
    throw new Error("MCP_KG_TOOL_PROFILE must be unset, 'compat', or 'core'");
  }

  const names = name === "core"
    ? new Set<string>(CORE_TOOL_NAMES)
    : new Set(toolDescriptors.map((tool) => tool.name));
  const descriptors = toolDescriptors.filter((tool) => names.has(tool.name));
  if (descriptors.length !== names.size) {
    throw new Error("tool profile contains missing or duplicate tool names");
  }
  return { name: name as ToolProfileName, names, descriptors };
}
