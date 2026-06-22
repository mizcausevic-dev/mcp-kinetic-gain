/**
 * Extraction-parity harness.
 *
 * Reproduces the EXACT tool-extraction path a README-reading registry scanner
 * (MCPpedia, bots/extract-schemas.ts -> extractToolsWithRegex) uses as its
 * no-API-key fallback:
 *   - fetch the README, slice the first 8000 chars (UTF-16 code units),
 *   - run the regex  /[`*]+(\w+)[`*]+\s*[-:<en-dash>]\s*(.+)/g  (hyphen, colon,
 *     and en-dash U+2013 in the separator class),
 *   - keep matches whose name length is 3..59 and description length > 5, dedup.
 *
 * It asserts our branch README yields EXACTLY the full toolDescriptors set in
 * that window -- nothing missing, no phantom tools -- so a scanner counts all
 * of them. This file is intentionally ASCII-only; the en-dash is written –
 * and the source README is read UTF-8.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { toolDescriptors } from "../src/tools.js";

const SLICE = 8000;
// Verbatim first pattern from MCPpedia's extractToolsWithRegex. The en-dash is
// U+2013 (written – so this file stays ASCII-only).
const THEIR_REGEX = /[`*]+(\w+)[`*]+\s*[-:–]\s*(.+)/g;

describe("README extraction parity (MCPpedia regex fallback)", () => {
  it("their regex extracts exactly the full tool set from the first 8000 chars", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const window = readme.slice(0, SLICE); // UTF-16 code units, == readme.slice(0,8000)

    const names: string[] = [];
    const seen = new Set<string>();
    for (const m of window.matchAll(THEIR_REGEX)) {
      const name = m[1];
      const desc = m[2].trim();
      // MCPpedia's filter: name length 3..59, description length > 5, dedup.
      if (name.length > 2 && name.length < 60 && desc.length > 5 && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }

    const expected = toolDescriptors.map((t) => t.name);

    const missing = expected.filter((n) => !seen.has(n));
    expect(missing, `tools the scanner would MISS: ${missing.join(", ")}`).toEqual([]);

    const extra = names.filter((n) => !expected.includes(n));
    expect(extra, `phantom tools the scanner would INVENT: ${extra.join(", ")}`).toEqual([]);

    expect(
      names.length,
      `scanner would count ${names.length}, expected ${expected.length}`,
    ).toBe(expected.length);
  });
});
