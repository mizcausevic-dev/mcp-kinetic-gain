/**
 * Strict JSON and RFC 8785/JCS helpers for aviation card signatures.
 * Parsed JSON normally loses duplicate keys; reject them before verifying a
 * signature so different parsers cannot disagree about the signed content.
 */

const MAX_CARD_BYTES = 1_000_000;
const MAX_DEPTH = 64;

export function parseCardJson(raw: unknown): unknown {
  if (typeof raw !== "string") throw new Error("document_json must be a JSON string");
  if (Buffer.byteLength(raw, "utf8") > MAX_CARD_BYTES) {
    throw new Error(`document_json exceeds ${MAX_CARD_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("document_json is not valid JSON");
  }

  let pos = 0;
  const whitespace = () => {
    while (pos < raw.length && /[ \t\r\n]/.test(raw[pos]!)) pos++;
  };
  const string = (): string => {
    const start = pos++;
    while (pos < raw.length) {
      const current = raw[pos++];
      if (current === "\\") {
        pos++; // Skip the escaped character; JSON.parse validated its syntax.
      } else if (current === '"') {
        return JSON.parse(raw.slice(start, pos)) as string;
      }
    }
    throw new Error("unterminated JSON string");
  };
  const value = (depth: number): void => {
    if (depth > MAX_DEPTH) throw new Error("document_json nesting is too deep");
    whitespace();
    const current = raw[pos];
    if (current === "{") {
      pos++;
      whitespace();
      const seen = new Set<string>();
      if (raw[pos] === "}") { pos++; return; }
      for (;;) {
        if (raw[pos] !== '"') throw new Error("invalid JSON object key");
        const key = string();
        if (seen.has(key)) throw new Error("document_json contains a duplicate object key");
        seen.add(key);
        whitespace();
        if (raw[pos++] !== ":") throw new Error("invalid JSON object separator");
        value(depth + 1);
        whitespace();
        const separator = raw[pos++];
        if (separator === "}") return;
        if (separator !== ",") throw new Error("invalid JSON object separator");
        whitespace();
      }
    }
    if (current === "[") {
      pos++;
      whitespace();
      if (raw[pos] === "]") { pos++; return; }
      for (;;) {
        value(depth + 1);
        whitespace();
        const separator = raw[pos++];
        if (separator === "]") return;
        if (separator !== ",") throw new Error("invalid JSON array separator");
      }
    }
    if (current === '"') { string(); return; }
    while (pos < raw.length && !/[ \t\r\n,}\]]/.test(raw[pos]!)) pos++;
  };

  value(0);
  whitespace();
  if (pos !== raw.length) throw new Error("invalid trailing JSON content");
  return parsed;
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error("JCS input contains an unpaired surrogate");
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error("JCS input contains an unpaired surrogate");
    }
  }
}

/** JCS canonical JSON text; callers encode this text as UTF-8 before hashing. */
export function canonicalizeJcs(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JCS input contains a non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map(canonicalizeJcs).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const properties = Object.keys(object).sort().map((key) => {
      assertValidUnicode(key);
      return `${JSON.stringify(key)}:${canonicalizeJcs(object[key])}`;
    });
    return `{${properties.join(",")}}`;
  }
  throw new Error("JCS input is not JSON data");
}
