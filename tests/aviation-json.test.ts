import { describe, expect, it } from "vitest";
import { canonicalizeJcs, parseCardJson } from "../src/aviation-json.js";

describe("aviation strict JSON and JCS", () => {
  it("sorts keys recursively by UTF-16 code units without reordering arrays", () => {
    const value = JSON.parse('{"b":[{"2":2,"10":10}],"a":"€"}');
    expect(canonicalizeJcs(value)).toBe('{"a":"€","b":[{"10":10,"2":2}]}');
  });

  it("uses ECMAScript JSON number serialization", () => {
    expect(canonicalizeJcs(JSON.parse('{"n":[4.50,2e-3,1E30]}')))
      .toBe('{"n":[4.5,0.002,1e+30]}');
  });

  it("rejects duplicate keys at any depth, including escaped spellings", () => {
    expect(() => parseCardJson('{"a":1,"a":2}')).toThrow(/duplicate/);
    expect(() => parseCardJson('{"nested":{"key":1,"\\u006bey":2}}')).toThrow(/duplicate/);
    expect(parseCardJson('{"a":"quoted \\u007b brace", "b":[1,{"x":true}]}'))
      .toEqual({ a: "quoted { brace", b: [1, { x: true }] });
  });

  it("rejects malformed JSON, oversized cards, deep nesting, and invalid Unicode", () => {
    expect(() => parseCardJson('{')).toThrow(/not valid JSON/);
    expect(() => parseCardJson(JSON.stringify({ value: "x".repeat(1_000_000) }))).toThrow(/exceeds/);
    expect(() => parseCardJson(`${"[".repeat(65)}0${"]".repeat(65)}`)).toThrow(/too deep/);
    expect(() => canonicalizeJcs("\ud800")).toThrow(/unpaired surrogate/);
    expect(() => canonicalizeJcs(Number.NaN)).toThrow(/non-finite/);
  });
});
