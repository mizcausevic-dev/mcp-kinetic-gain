import { promptProvenanceSchema } from "../schemas.js";
import { errorJson, pretty } from "../common.js";

function parse(document_json: string): ReturnType<typeof promptProvenanceSchema.parse> {
  return promptProvenanceSchema.parse(JSON.parse(document_json));
}

export async function handlePromptProvenanceValidate(args: {
  document_json: string;
}): Promise<string> {
  try {
    const doc = parse(args.document_json);
    return pretty({
      valid: true,
      prompt_id: doc.prompt.id,
      version: doc.prompt.version,
    });
  } catch (err) {
    return pretty({
      valid: false,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handlePromptProvenanceInspect(args: {
  document_json: string;
}): Promise<string> {
  const doc = parse(args.document_json);
  return pretty({
    provenance_version: doc.provenance_version,
    prompt: {
      id: doc.prompt.id,
      name: doc.prompt.name,
      version: doc.prompt.version,
      content_type: doc.prompt.content_type,
    },
    lineage_parent: doc.lineage?.parent ?? null,
    derivation: doc.lineage?.derivation ?? null,
    approval_state: doc.approval?.state ?? null,
    evaluation_suites: (doc.evaluations ?? []).map((e) => ({
      suite: e.suite,
      passed: e.passed,
      score: e.score ?? null,
    })),
    created_by: doc.authorship?.created_by ?? null,
    approved_by: doc.authorship?.approved_by ?? null,
  });
}

export async function handlePromptProvenanceEvalResult(args: {
  document_json: string;
  suite_name: string;
}): Promise<string> {
  const doc = parse(args.document_json);
  const result = (doc.evaluations ?? []).find((e) => e.suite === args.suite_name);
  if (!result) {
    return errorJson("evaluation_not_found", {
      suite_name: args.suite_name,
      available_suites: (doc.evaluations ?? []).map((e) => e.suite),
    });
  }
  return pretty(result);
}
