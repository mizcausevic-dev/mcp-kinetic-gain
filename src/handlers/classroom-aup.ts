import {
  classroomAupSchema,
  studentDisclosureSchema,
  type ClassroomAup,
  type StudentDisclosure,
} from "../schemas.js";
import { errorJson, fetchJson, pretty, stripTrailingSlashes } from "../common.js";

const WELL_KNOWN_PATH = "/.well-known/ai-aup.json";

export function aupWellKnownUrl(origin: string): string {
  return stripTrailingSlashes(origin) + WELL_KNOWN_PATH;
}

async function loadAup(args: {
  url?: string;
  document_json?: string;
}): Promise<ClassroomAup> {
  if (args.document_json) return classroomAupSchema.parse(JSON.parse(args.document_json));
  if (args.url) return classroomAupSchema.parse(await fetchJson(args.url));
  throw new Error("must provide either `url` or `document_json`");
}

const EXTENT_RANK: Record<string, number> = {
  none: 0,
  minor: 1,
  substantial: 2,
  primary_author: 3,
};

/**
 * The headline check: join an AUP with a Student AI Disclosure and decide
 * whether the submission complies with the operative policy. Eight gates,
 * all reasons returned so a teacher / LMS can show the full violation set.
 */
function checkCompliance(
  aup: ClassroomAup,
  disclosure: StudentDisclosure,
): {
  allowed: boolean;
  policy_id: string;
  disclosure_id: string;
  violations: Array<{ code: string; detail: string }>;
} {
  const violations: Array<{ code: string; detail: string }> = [];

  // 1. Effective window
  const now = new Date().toISOString();
  if (aup.effective_at > now) {
    violations.push({
      code: "policy_not_yet_effective",
      detail: `Policy ${aup.policy_id} takes effect at ${aup.effective_at}.`,
    });
  }
  if (aup.expires_at && aup.expires_at <= now) {
    violations.push({
      code: "policy_expired",
      detail: `Policy ${aup.policy_id} expired at ${aup.expires_at}.`,
    });
  }

  // 2. Signature
  if (aup.disclosure_requirements.signature_required && !disclosure.signed_by_student) {
    violations.push({
      code: "signature_missing",
      detail: "Policy requires signed_by_student=true.",
    });
  }

  // 3. Artifact hash (default required = true)
  const artifactHashRequired =
    aup.disclosure_requirements.artifact_hash_required !== false;
  if (artifactHashRequired && !disclosure.artifact_hash) {
    violations.push({
      code: "artifact_hash_missing",
      detail: "Policy requires the disclosure to carry an artifact_hash.",
    });
  }

  // 4. Teacher acknowledgment
  if (
    aup.disclosure_requirements.teacher_acknowledgment_required === true &&
    (!disclosure.teacher_acknowledged ||
      !disclosure.teacher_acknowledged.acknowledged)
  ) {
    violations.push({
      code: "teacher_acknowledgment_missing",
      detail: "Policy requires teacher_acknowledged.acknowledged=true.",
    });
  }

  // 5. Prompt evidence mode
  if (
    disclosure.ai_used &&
    aup.disclosure_requirements.required_prompt_evidence_mode &&
    aup.disclosure_requirements.required_prompt_evidence_mode !== "any"
  ) {
    const required = aup.disclosure_requirements.required_prompt_evidence_mode;
    if (disclosure.prompt_evidence_mode !== required) {
      violations.push({
        code: "wrong_prompt_evidence_mode",
        detail: `Policy requires prompt_evidence_mode=${required}; disclosure declares ${disclosure.prompt_evidence_mode ?? "absent"}.`,
      });
    }
  }

  // 6. Roles permitted / prohibited (only when ai_used)
  if (disclosure.ai_used && disclosure.roles) {
    const permitted = new Set(aup.permitted_use.permitted_roles);
    const notPermitted = disclosure.roles.filter((r) => !permitted.has(r));
    if (notPermitted.length > 0) {
      violations.push({
        code: "roles_not_permitted",
        detail: `Disclosed roles not in AUP permitted_roles: ${notPermitted.join(", ")}.`,
      });
    }
    const prohibited = new Set(aup.prohibited_use?.prohibited_roles ?? []);
    const forbidden = disclosure.roles.filter((r) => prohibited.has(r));
    if (forbidden.length > 0) {
      violations.push({
        code: "roles_prohibited",
        detail: `Disclosed roles in AUP prohibited_roles: ${forbidden.join(", ")}.`,
      });
    }
  }

  // 7. Assistance extent ceiling
  if (disclosure.ai_used && disclosure.assistance_extent) {
    const used = EXTENT_RANK[disclosure.assistance_extent];
    const max = EXTENT_RANK[aup.permitted_use.assistance_extent_max];
    if (used !== undefined && max !== undefined && used > max) {
      violations.push({
        code: "assistance_extent_exceeded",
        detail: `Disclosed extent '${disclosure.assistance_extent}' exceeds policy ceiling '${aup.permitted_use.assistance_extent_max}'.`,
      });
    }
  }

  // 8. assistance_extent_max=none + ai_used=true is an automatic deny
  if (aup.permitted_use.assistance_extent_max === "none" && disclosure.ai_used) {
    violations.push({
      code: "no_ai_permitted",
      detail: "Policy permits zero AI use (assistance_extent_max=none) but disclosure declares ai_used=true.",
    });
  }

  return {
    allowed: violations.length === 0,
    policy_id: aup.policy_id,
    disclosure_id: disclosure.disclosure_id,
    violations,
  };
}

export async function handleClassroomAupWellKnownUrl(args: {
  origin: string;
}): Promise<string> {
  return pretty({ url: aupWellKnownUrl(args.origin) });
}

export async function handleClassroomAupFetch(args: { url: string }): Promise<string> {
  const aup = classroomAupSchema.parse(await fetchJson(args.url));
  return pretty(aup);
}

export async function handleClassroomAupValidate(args: {
  document_json: string;
}): Promise<string> {
  try {
    const aup = classroomAupSchema.parse(JSON.parse(args.document_json));
    return pretty({
      valid: true,
      policy_id: aup.policy_id,
      policy_name: aup.policy_name,
      version: aup.version,
      scope_type: aup.scope.type,
      permitted_role_count: aup.permitted_use.permitted_roles.length,
      assistance_extent_max: aup.permitted_use.assistance_extent_max,
    });
  } catch (err) {
    return pretty({
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handleClassroomAupInspect(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const aup = await loadAup(args);
  return pretty({
    aup_version: aup.aup_version,
    policy: {
      id: aup.policy_id,
      name: aup.policy_name,
      version: aup.version,
      effective_at: aup.effective_at,
      expires_at: aup.expires_at ?? null,
    },
    scope: {
      type: aup.scope.type,
      institution_id: aup.scope.institution_id,
      grade_bands: aup.scope.grade_bands ?? [],
      course_ids: aup.scope.course_ids ?? [],
      assignment_ids: aup.scope.assignment_ids ?? [],
      parent_policy_uri: aup.scope.parent_policy_uri ?? null,
    },
    permitted_use: {
      role_count: aup.permitted_use.permitted_roles.length,
      permitted_roles: aup.permitted_use.permitted_roles,
      assistance_extent_max: aup.permitted_use.assistance_extent_max,
      tool_allow_list_count: aup.permitted_use.permitted_tools?.length ?? 0,
    },
    prohibited_use: {
      role_count: aup.prohibited_use?.prohibited_roles?.length ?? 0,
      prohibition_count: aup.prohibited_use?.prohibited_uses?.length ?? 0,
    },
    disclosure_requirements: aup.disclosure_requirements,
    supervision_level: aup.supervision?.level ?? null,
    vendor_requirements_declared: aup.vendor_requirements !== undefined,
    requires_tutor_card: aup.vendor_requirements?.requires_tutor_card ?? false,
    required_compliance: aup.vendor_requirements?.required_compliance ?? [],
    retention_days_max: aup.vendor_requirements?.retention_days_max ?? null,
    parent_consent_required: aup.parent_notification?.parent_consent_required ?? false,
    published_by: aup.published_by.name,
  });
}

/**
 * Headline tool: join an AUP with a Student AI Disclosure and decide
 * whether the submission is allowed. Returns { allowed: boolean, violations[] }.
 */
export async function handleClassroomAupCheckCompliance(args: {
  aup_json?: string;
  aup_url?: string;
  disclosure_json: string;
}): Promise<string> {
  const aup = await loadAup({ document_json: args.aup_json, url: args.aup_url });
  let disclosure: StudentDisclosure;
  try {
    disclosure = studentDisclosureSchema.parse(JSON.parse(args.disclosure_json));
  } catch (err) {
    return errorJson("disclosure_invalid", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
  const result = checkCompliance(aup, disclosure);
  return pretty(result);
}
