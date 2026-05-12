import { tutorCardSchema, type TutorCard } from "../schemas.js";
import { errorJson, fetchJson, pretty, stripTrailingSlashes } from "../common.js";

const WELL_KNOWN_PREFIX = "/.well-known/tutors/";

export function tutorWellKnownUrl(origin: string, tutor_id: string): string {
  return stripTrailingSlashes(origin) + WELL_KNOWN_PREFIX + encodeURIComponent(tutor_id) + ".json";
}

async function loadCard(args: {
  url?: string;
  document_json?: string;
}): Promise<TutorCard> {
  if (args.document_json) return tutorCardSchema.parse(JSON.parse(args.document_json));
  if (args.url) return tutorCardSchema.parse(await fetchJson(args.url));
  throw new Error("must provide either `url` or `document_json`");
}

/** Implements the AI Tutor Cards spec COPPA conditional rule. */
function checkCoppa(card: TutorCard) {
  const minAge = card.audience.age_range_min;
  const coppa = card.data_privacy.coppa_compliant;
  if (minAge >= 13) {
    return {
      ok: true,
      reason: "Audience min age >= 13; COPPA conditional rule does not apply.",
      age_range_min: minAge,
      coppa_compliant: coppa,
    };
  }
  if (coppa) {
    return {
      ok: true,
      reason: `Audience min age is ${minAge} (<13) and coppa_compliant=true, as required by the spec.`,
      age_range_min: minAge,
      coppa_compliant: coppa,
    };
  }
  return {
    ok: false,
    reason: `SPEC VIOLATION: audience min age is ${minAge} (<13) but coppa_compliant=false. This is procurement-blocking for any US K-12 deployment.`,
    age_range_min: minAge,
    coppa_compliant: coppa,
  };
}

/** Topic-coverage classifier: primary | included | excluded | unknown. */
function checkSubject(card: TutorCard, query: string) {
  const q = query.trim().toLowerCase();
  const excluded = (card.subject_scope.topics_excluded ?? []).find((t) =>
    t.toLowerCase().includes(q),
  );
  if (excluded) return { covered: false, classification: "excluded" as const, matched_term: excluded };
  const primary = card.subject_scope.primary_subjects.find((s) =>
    s.toLowerCase().includes(q),
  );
  if (primary) return { covered: true, classification: "primary" as const, matched_term: primary };
  const included = (card.subject_scope.topics_included ?? []).find((t) =>
    t.toLowerCase().includes(q),
  );
  if (included) return { covered: true, classification: "included" as const, matched_term: included };
  return { covered: false, classification: "unknown" as const, matched_term: null };
}

export async function handleTutorCardWellKnownUrl(args: {
  origin: string;
  tutor_id: string;
}): Promise<string> {
  return pretty({ url: tutorWellKnownUrl(args.origin, args.tutor_id) });
}

export async function handleTutorCardFetch(args: { url: string }): Promise<string> {
  const card = tutorCardSchema.parse(await fetchJson(args.url));
  return pretty(card);
}

export async function handleTutorCardValidate(args: {
  document_json: string;
}): Promise<string> {
  try {
    const card = tutorCardSchema.parse(JSON.parse(args.document_json));
    return pretty({
      valid: true,
      tutor_id: card.tutor.id,
      version: card.tutor.version,
      coppa_check: checkCoppa(card),
    });
  } catch (err) {
    return pretty({
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handleTutorCardInspect(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const card = await loadCard(args);
  return pretty({
    tutor_card_version: card.tutor_card_version,
    tutor: {
      id: card.tutor.id,
      name: card.tutor.name,
      version: card.tutor.version,
      provider: card.tutor.provider,
    },
    audience: {
      ages: `${card.audience.age_range_min}-${card.audience.age_range_max}`,
      grades: `${card.audience.grade_range_min}-${card.audience.grade_range_max}`,
      languages: card.audience.language_codes,
    },
    pedagogy: {
      approach: card.pedagogy.approach,
      homework_policy: card.pedagogy.homework_policy,
      assessment_policy: card.pedagogy.assessment_policy,
    },
    subject_scope: {
      primary: card.subject_scope.primary_subjects,
      includes: card.subject_scope.topics_included?.length ?? 0,
      excludes: card.subject_scope.topics_excluded?.length ?? 0,
    },
    safety: {
      content_filter_strength: card.safety.content_filter_strength,
      mandated_reporter_protocol: card.safety.mandated_reporter_protocol,
      human_in_loop_categories: card.safety.human_in_loop_required,
    },
    privacy: {
      ferpa_compliant: card.data_privacy.ferpa_compliant,
      coppa_compliant: card.data_privacy.coppa_compliant,
      gdpr_compliant: card.data_privacy.gdpr_compliant,
      retention_days: card.data_privacy.retention_days,
      parents_see: card.data_privacy.data_sharing_with_parents,
      school_sees: card.data_privacy.data_sharing_with_school,
      shares_with_third_parties: card.data_privacy.third_party_data_sharing,
    },
    agent_card_uri: card.agent_card_uri ?? null,
    evaluation_count: card.evaluations?.length ?? 0,
    coppa_check: checkCoppa(card),
  });
}

export async function handleTutorCardSubjectCheck(args: {
  url?: string;
  document_json?: string;
  query: string;
}): Promise<string> {
  const card = await loadCard(args);
  return pretty({
    tutor_id: card.tutor.id,
    query: args.query,
    ...checkSubject(card, args.query),
  });
}

export async function handleTutorCardCoppaCheck(args: {
  url?: string;
  document_json?: string;
}): Promise<string> {
  const card = await loadCard(args);
  const result = checkCoppa(card);
  if (!result.ok) {
    return errorJson("coppa_violation", { tutor_id: card.tutor.id, ...result });
  }
  return pretty({ tutor_id: card.tutor.id, ...result });
}
