// handlers/defensetech.ts — v0.8.0 DefenseTech tooling extension.
//
// 8 MCP tools wrapping the DefenseTech 6-pack semantics so a Claude
// chat can validate / resolve / classify DefenseTech artifacts directly:
//
//   1. defensetech_vault_resolve_3axis
//   2. defensetech_audit_event_check_invariants
//   3. defensetech_check_dfars_72h_clock
//   4. defensetech_check_cui_distribution_statement
//   5. defensetech_check_itar_us_person
//   6. defensetech_incident_classify_event_type
//   7. defensetech_summarize_cmmc_evidence_bundle
//   8. defensetech_vault_contract_cross_binding_check
//
// No new runtime deps — uses the same pretty() helper as the other handlers.

import { pretty } from "../common.js";

const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;

const STATUS_RANK = [
  "any",
  "us-person-verified",
  "authorized-foreign-person-with-license",
  "secret-clearance",
  "top-secret-clearance",
  "ts-sci-clearance"
] as const;

const SPECIFIED_PLUS = new Set([
  "CUI-SPECIFIED",
  "CUI-SPECIFIED-NOFORN",
  "CONTROLLED-NOFORN",
  "CLASSIFIED-CONFIDENTIAL",
  "CLASSIFIED-SECRET",
  "CLASSIFIED-TOP-SECRET",
  "SCI"
]);

const KNOWN_INCIDENT_EVENT_TYPES = [
  "dfars-72-hour-cyber-incident",
  "cui-spillage-detected",
  "cui-marking-failure",
  "cui-mishandling-on-unauthorized-system",
  "itar-deemed-export-violation",
  "itar-license-mismatch",
  "ear-license-mismatch",
  "ear-entity-list-screening-failure",
  "foreign-person-unauthorized-access",
  "foreign-person-access-attempt-blocked",
  "classified-environment-ai-misuse",
  "scif-policy-violation-detected",
  "nispom-insider-threat-flag",
  "personnel-clearance-status-change-mishandling",
  "cmmc-l2-l3-readiness-gap-discovered",
  "cmmc-poam-open-finding-related-failure",
  "sprs-self-assessment-discrepancy",
  "ai-generated-classified-marking-error",
  "ai-tool-supply-chain-compromise-detected",
  "ai-tool-update-introduced-non-conformance",
  "ai-output-on-unverified-us-person-system",
  "third-party-shared-responsibility-incident"
];

// --- 1. 3-axis vault resolver ---
export async function handleDefensetechVaultResolve3axis(args: {
  contract: any;
  tuple: { cui: string; export_control: string; foreign_person: string };
}): Promise<string> {
  const ax = args.contract?.axis_policies;
  if (!ax) return pretty({ ok: false, reason: "contract.axis_policies missing" });
  const cuiP = ax.cui_handling_policy?.[args.tuple.cui];
  const expP = ax.export_control_handling_policy?.[args.tuple.export_control];
  const forP = ax.foreign_person_handling_policy?.[args.tuple.foreign_person];
  if (!cuiP || !expP || !forP) return pretty({ ok: false, reason: "one or more tiers missing from contract" });

  const policies: any[] = [cuiP, expP, forP];
  const sets: Set<string>[] = policies.map((p: any) => new Set<string>(p.allowed_actions ?? []));
  const firstSet = sets[0] ?? new Set<string>();
  const intersected = [...firstSet].filter((a) => sets.every((s) => s.has(a)));
  const maxIdx = Math.max(...policies.map((p: any) => STATUS_RANK.indexOf(p.minimum_human_user_status ?? "any") as number));
  const reqs: Record<string, boolean> = {};
  for (const p of policies as any[]) {
    for (const k of Object.keys(p)) if (k.startsWith("requires_")) reqs[k] = (reqs[k] || p[k] === true);
  }

  return pretty({
    ok: true,
    tuple: args.tuple,
    resolved_allowed_actions: intersected,
    resolved_minimum_human_user_status: STATUS_RANK[maxIdx],
    ...reqs
  });
}

// --- 2. Run all 3 DefenseTech invariants against an audit event ---
export async function handleDefensetechAuditEventCheckInvariants(args: { event: any }): Promise<string> {
  const e = args.event ?? {};
  const errors: string[] = [];
  const passed: string[] = [];

  // #1 CUI distribution-statement
  if (e.resource?.cui_categorization && SPECIFIED_PLUS.has(e.resource.cui_categorization)) {
    if (!e.distribution_statement) errors.push(`#1: CUI tier=${e.resource.cui_categorization} requires distribution_statement (DoDI 5230.24)`);
    else passed.push(`#1: distribution_statement present`);
  } else {
    passed.push(`#1: N/A (CUI tier not Specified+)`);
  }

  // #2 ITAR us-person verification
  if (e.resource?.export_control_status === "ITAR") {
    const ok = e.agent?.human_user_us_person_status === "US-PERSON-VERIFIED" || e.agent?.human_user_us_person_status === "AUTHORIZED-FOREIGN-PERSON-WITH-LICENSE";
    if (!ok) errors.push(`#2: ITAR resource requires US-PERSON-VERIFIED or AUTHORIZED-FOREIGN-PERSON-WITH-LICENSE (22 CFR 120.62)`);
    else passed.push(`#2: ITAR us-person verification present`);
  } else {
    passed.push(`#2: N/A (export_control not ITAR)`);
  }

  // #3 DFARS 72-hour clock
  if (e.kind === "defensetech.dfars.cyber-incident-flagged") {
    if (!e.dfars_cyber_incident_report_ref?.filed_at) {
      errors.push(`#3: DFARS cyber-incident-flagged event requires dfars_cyber_incident_report_ref.filed_at`);
    } else {
      const occurred = new Date(e.timestamp).getTime();
      const filed = new Date(e.dfars_cyber_incident_report_ref.filed_at).getTime();
      const elapsedH = Math.round((filed - occurred) / 3600000);
      if (filed - occurred > SEVENTY_TWO_HOURS_MS) errors.push(`#3: DFARS 72-hour clock missed (filed ${elapsedH}h after occurred)`);
      else passed.push(`#3: DFARS 72-hour clock met (filed ${elapsedH}h after occurred)`);
    }
  } else {
    passed.push(`#3: N/A (kind not cyber-incident-flagged)`);
  }

  return pretty({ ok: errors.length === 0, errors, passed });
}

// --- 3. Specifically: check DFARS 72-hour clock ---
export async function handleDefensetechCheckDfars72hClock(args: {
  occurred_at: string;
  filed_at: string;
}): Promise<string> {
  const occurred = new Date(args.occurred_at).getTime();
  const filed = new Date(args.filed_at).getTime();
  const elapsedMs = filed - occurred;
  const elapsedH = elapsedMs / 3600000;
  return pretty({
    elapsed_hours: Math.round(elapsedH * 100) / 100,
    deadline_hours: 72,
    within_window: elapsedMs <= SEVENTY_TWO_HOURS_MS,
    overrun_hours: elapsedMs > SEVENTY_TWO_HOURS_MS ? Math.round((elapsedH - 72) * 100) / 100 : 0
  });
}

// --- 4. Check CUI distribution_statement present on Specified+ ---
export async function handleDefensetechCheckCuiDistributionStatement(args: {
  cui_categorization: string;
  distribution_statement?: any;
}): Promise<string> {
  const required = SPECIFIED_PLUS.has(args.cui_categorization);
  const present = Boolean(args.distribution_statement);
  return pretty({
    cui_categorization: args.cui_categorization,
    distribution_statement_required: required,
    distribution_statement_present: present,
    ok: !required || present,
    rationale: required ? "DoDI 5230.24 requires distribution statement on Specified+ tier" : "Not required for this CUI tier"
  });
}

// --- 5. Check ITAR us-person verification ---
export async function handleDefensetechCheckItarUsPerson(args: {
  export_control_status: string;
  human_user_us_person_status?: string;
  ddtc_export_license_number_tokenized?: string;
}): Promise<string> {
  if (args.export_control_status !== "ITAR") {
    return pretty({ ok: true, applicable: false, rationale: "Not ITAR — invariant N/A" });
  }
  const verified = args.human_user_us_person_status === "US-PERSON-VERIFIED";
  const afp = args.human_user_us_person_status === "AUTHORIZED-FOREIGN-PERSON-WITH-LICENSE";
  const afpOk = afp && Boolean(args.ddtc_export_license_number_tokenized);
  const ok = verified || afpOk;
  return pretty({
    ok,
    applicable: true,
    rationale: ok
      ? (verified ? "US-PERSON-VERIFIED" : "AUTHORIZED-FOREIGN-PERSON with DDTC license")
      : `ITAR requires US-PERSON-VERIFIED or AUTHORIZED-FOREIGN-PERSON-WITH-LICENSE (+ DDTC license); got "${args.human_user_us_person_status}"`
  });
}

// --- 6. Classify a freeform incident description → DefenseTech Incident Card event_type ---
export async function handleDefensetechIncidentClassifyEventType(args: {
  description: string;
}): Promise<string> {
  const d = (args.description ?? "").toLowerCase();
  const matches = KNOWN_INCIDENT_EVENT_TYPES
    .map((t) => {
      const tokens = t.split("-").filter((x) => x.length >= 4);
      const score = tokens.reduce((acc, tok) => acc + (d.includes(tok) ? 1 : 0), 0);
      return { event_type: t, score, tokens_matched: tokens.filter((tok) => d.includes(tok)) };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return pretty({
    description: args.description,
    candidates: matches,
    best_match: matches[0]?.event_type ?? null,
    all_known_event_types_count: KNOWN_INCIDENT_EVENT_TYPES.length
  });
}

// --- 7. Summarize a CMMC L2/L3 readiness evidence bundle ---
export async function handleDefensetechSummarizeCmmcEvidenceBundle(args: { bundle: any }): Promise<string> {
  const b = args.bundle ?? {};
  const items = Array.isArray(b.evidence) ? b.evidence : [];
  const familyCounts: Record<string, number> = {};
  const outcomeCounts: Record<string, number> = {};
  for (const i of items) {
    if (i.control_family) familyCounts[i.control_family] = (familyCounts[i.control_family] ?? 0) + 1;
    if (i.outcome) outcomeCounts[i.outcome] = (outcomeCounts[i.outcome] ?? 0) + 1;
  }
  const orphanFailures = items.filter((i: any) => i.outcome === "not-satisfied" && !i.poam_ref).length;
  const sprsItems = items.filter((i: any) => i.control_family === "cmmc-sprs-scoring");

  return pretty({
    bundle_id: b.bundle_id,
    target_cmmc_level: b.assessment?.target_cmmc_level,
    assessment_mode: b.assessment?.assessment_mode,
    evidence_count: items.length,
    family_coverage_count: Object.keys(familyCounts).length,
    outcome_distribution: outcomeCounts,
    orphan_failures_count: orphanFailures,
    sprs_evidence_present: sprsItems.length > 0,
    invariant_checks: {
      no_orphan_failures: orphanFailures === 0,
      sprs_evidence_present_if_7019_or_7020: !((b.assessment?.dfars_clauses_in_scope ?? []).some((c: string) => c === "dfars-252-204-7019" || c === "dfars-252-204-7020")) || sprsItems.length > 0
    }
  });
}

// --- 8. Vault contract cross_binding_refs syntactic check ---
export async function handleDefensetechVaultContractCrossBindingCheck(args: { contract: any }): Promise<string> {
  const refs = args.contract?.cross_binding_refs;
  if (!refs) return pretty({ ok: false, applicable: false, reason: "no cross_binding_refs present" });
  const errors: string[] = [];
  const ok: string[] = [];
  for (const [k, v] of Object.entries(refs)) {
    if (typeof v !== "string" || !/^https?:\/\//.test(v)) errors.push(`${k}: not HTTPS URL ("${v}")`);
    else ok.push(`${k}: ${v}`);
  }
  return pretty({
    applicable: true,
    ok: errors.length === 0,
    ref_count: Object.keys(refs).length,
    valid_refs: ok,
    errors
  });
}
