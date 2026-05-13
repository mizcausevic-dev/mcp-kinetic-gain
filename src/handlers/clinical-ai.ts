import { clinicalAiCardSchema, type ClinicalAiCard } from "../schemas.js";
import { fetchJson, pretty, stripTrailingSlashes } from "../common.js";

const WELL_KNOWN_PREFIX = "/.well-known/clinical-ai/";

export function clinicalAiWellKnownUrl(origin: string, system_id: string): string {
  return stripTrailingSlashes(origin) + WELL_KNOWN_PREFIX + encodeURIComponent(system_id) + ".json";
}

async function loadCard(args: {
  url?: string;
  document_json?: string;
}): Promise<ClinicalAiCard> {
  if (args.document_json) return clinicalAiCardSchema.parse(JSON.parse(args.document_json));
  if (args.url) return clinicalAiCardSchema.parse(await fetchJson(args.url));
  throw new Error("must provide either `url` or `document_json`");
}

export async function handleClinicalAiWellKnownUrl(args: {
  origin: string;
  system_id: string;
}): Promise<string> {
  return pretty({ url: clinicalAiWellKnownUrl(args.origin, args.system_id) });
}

export async function handleClinicalAiFetch(args: { url: string }): Promise<string> {
  const card = clinicalAiCardSchema.parse(await fetchJson(args.url));
  return pretty(card);
}

export async function handleClinicalAiValidate(args: { document_json: string }): Promise<string> {
  try {
    const card = clinicalAiCardSchema.parse(JSON.parse(args.document_json));
    return pretty({
      valid: true,
      system_id: card.system.id,
      system_version: card.system.version,
      fda_status: card.regulatory.fda_status,
      samd_class: card.regulatory.samd_class ?? null,
      decision_support_level: card.clinical_role.decision_support_level,
      bias_audited: card.evidence.bias_audit_uri !== undefined,
    });
  } catch (err) {
    return pretty({ valid: false, reason: err instanceof Error ? err.message : String(err) });
  }
}

export async function handleClinicalAiInspect(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const card = await loadCard(args);
  return pretty({
    clinical_ai_card_version: card.clinical_ai_card_version,
    system: {
      id: card.system.id,
      name: card.system.name,
      version: card.system.version,
      provider: card.system.provider,
    },
    clinical_context: {
      indication: card.clinical_context.indication,
      care_settings: card.clinical_context.care_settings,
      patient_age_range: `${card.clinical_context.patient_population.age_range_min}-${card.clinical_context.patient_population.age_range_max}`,
      patient_exclusions: card.clinical_context.patient_population.exclusions ?? [],
      off_label_uses_prohibited: card.clinical_context.off_label_uses_prohibited,
    },
    regulatory: {
      fda_status: card.regulatory.fda_status,
      fda_clearance_number: card.regulatory.fda_clearance_number ?? null,
      iso_certifications: card.regulatory.iso_certifications ?? [],
      is_medical_device: card.regulatory.is_medical_device,
      is_clinical_decision_support: card.regulatory.is_clinical_decision_support,
      is_software_as_medical_device: card.regulatory.is_software_as_medical_device,
      samd_class: card.regulatory.samd_class ?? null,
    },
    clinical_role: card.clinical_role,
    evidence: {
      validation_study_count: card.evidence.validation_studies.length,
      training_data_sources: card.evidence.training_data_sources,
      bias_audit_uri: card.evidence.bias_audit_uri ?? null,
      performance_metrics: card.evidence.performance_metrics,
    },
    patient_data: card.patient_data,
    safety: {
      human_in_loop_categories: card.safety.human_in_loop_required_for,
      mandatory_reporting_categories: card.safety.mandatory_reporting_categories,
      blocks_diagnostic_claims: card.safety.blocks_diagnostic_claims ?? null,
    },
    ehr_integration: card.ehr_integration ?? null,
    agent_card_uri: card.agent_card_uri ?? null,
    evaluation_count: card.evaluations?.length ?? 0,
    incident_card_index_uri: card.audit?.incident_card_index_uri ?? null,
  });
}
