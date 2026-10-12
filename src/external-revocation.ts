/** Read-only, fail-closed withdrawal source for the private GCP pilot. */
const MAX_TOKEN_RESPONSE_BYTES = 8_192;
const MAX_DOCUMENT_BYTES = 32_768;
const MAX_VALIDITY_SECONDS = 120;
const MAX_ITEMS = 1_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const BUCKET = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;
const OBJECT = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9][A-Za-z0-9/_.-]{0,255}$/;
const METADATA_URL = "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token?enforce_scopes=true&scopes=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdevstorage.read_only";

export interface RevocationDocument {
  revision: number;
  revokedJtis: ReadonlySet<string>;
  revokedSubjects: ReadonlySet<string>;
  revokedClientIds: ReadonlySet<string>;
  revokedDecisionIds: ReadonlySet<string>;
}

export interface RevocationReader {
  read(): Promise<RevocationDocument>;
}

export interface GcsRevocationLocation {
  bucket: string;
  object: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function boundedBody(response: Response, maxBytes: number): Promise<unknown> {
  if (response.status !== 200) throw new Error("revocation source unavailable");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new Error("revocation response too large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("revocation response empty");
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("revocation response too large");
    }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function ids(value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || !value.every(
    (entry) => typeof entry === "string" && IDENTIFIER.test(entry),
  )) throw new Error("invalid revocation document");
  return new Set(value as string[]);
}

export function parseRevocationDocument(value: unknown, now = Math.floor(Date.now() / 1000)): RevocationDocument {
  if (!record(value) || Object.keys(value).length !== 7 ||
      !["version", "revision", "valid_until", "revoked_jtis", "revoked_subjects",
        "revoked_client_ids", "revoked_decision_ids"].every((key) => Object.hasOwn(value, key)) ||
      value.version !== 1 || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 ||
      !Number.isSafeInteger(value.valid_until) || (value.valid_until as number) <= now ||
      (value.valid_until as number) > now + MAX_VALIDITY_SECONDS) {
    throw new Error("invalid revocation document");
  }
  return {
    revision: value.revision as number,
    revokedJtis: ids(value.revoked_jtis),
    revokedSubjects: ids(value.revoked_subjects),
    revokedClientIds: ids(value.revoked_client_ids),
    revokedDecisionIds: ids(value.revoked_decision_ids),
  };
}

export function gcsRevocationReader(
  location: GcsRevocationLocation,
  fetcher: typeof fetch = fetch,
): RevocationReader {
  if (!BUCKET.test(location.bucket) || !OBJECT.test(location.object)) {
    throw new Error("invalid revocation location");
  }
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(location.bucket)}/o/${encodeURIComponent(location.object)}?alt=media`;
  return {
    async read(): Promise<RevocationDocument> {
      const metadata = await fetcher(METADATA_URL, {
        headers: { "metadata-flavor": "Google" }, redirect: "error",
        signal: AbortSignal.timeout(1_000),
      });
      const token = await boundedBody(metadata, MAX_TOKEN_RESPONSE_BYTES);
      if (!record(token) || token.token_type !== "Bearer" ||
          typeof token.access_token !== "string" ||
          !/^[A-Za-z0-9._~+/-]{20,4096}={0,2}$/.test(token.access_token)) {
        throw new Error("revocation credential unavailable");
      }
      const response = await fetcher(url, {
        headers: { authorization: `Bearer ${token.access_token}`, "cache-control": "no-store" },
        redirect: "error", signal: AbortSignal.timeout(2_000),
      });
      return parseRevocationDocument(await boundedBody(response, MAX_DOCUMENT_BYTES));
    },
  };
}

export function revoked(
  document: RevocationDocument,
  principal: { jti: string; subject: string; clientId: string },
  decisionId?: string,
): boolean {
  return document.revokedJtis.has(principal.jti) ||
    document.revokedSubjects.has(principal.subject) ||
    document.revokedClientIds.has(principal.clientId) ||
    (decisionId !== undefined && document.revokedDecisionIds.has(decisionId));
}
