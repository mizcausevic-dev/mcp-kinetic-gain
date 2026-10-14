import { describe, expect, it } from "vitest";

import {
  gcsRevocationReader, parseRevocationDocument, revoked,
} from "../src/external-revocation.js";

const current = () => ({
  version: 1, revision: 7, valid_until: Math.floor(Date.now() / 1000) + 60,
  revoked_jtis: ["jti-7"], revoked_subjects: [], revoked_client_ids: [],
  revoked_decision_ids: ["CARD-7"],
});

describe("external revocation source", () => {
  it("accepts bounded current withdrawal records and rejects stale or ambiguous shapes", () => {
    const document = parseRevocationDocument(current());
    expect(document.revision).toBe(7);
    expect(revoked(document, { jti: "jti-7", subject: "subject", clientId: "client" })).toBe(true);
    expect(revoked(document, { jti: "jti-8", subject: "subject", clientId: "client" }, "CARD-7")).toBe(true);
    expect(revoked(document, { jti: "jti-8", subject: "subject", clientId: "client" })).toBe(false);
    expect(() => parseRevocationDocument({ ...current(), valid_until: 1 })).toThrow();
    expect(() => parseRevocationDocument({ ...current(), extra: true })).toThrow();
    expect(() => parseRevocationDocument({ ...current(), revoked_jtis: ["jti-7", 4] })).toThrow();
  });

  it("reads only the fixed metadata endpoint and exact GCS object with a short-lived token", async () => {
    const urls: string[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      urls.push(String(input));
      if (urls.length === 1) {
        expect(init?.headers).toEqual({ "metadata-flavor": "Google" });
        return new Response(JSON.stringify({ token_type: "Bearer", access_token: "a".repeat(40) }));
      }
      expect(init?.headers).toEqual({
        authorization: `Bearer ${"a".repeat(40)}`, "cache-control": "no-store",
      });
      return new Response(JSON.stringify(current()));
    }) as typeof fetch;
    const reader = gcsRevocationReader({
      bucket: "kg-pilot-custody", object: "revocations/current.json",
    }, fetcher);
    expect((await reader.read()).revision).toBe(7);
    expect(urls[0]).toMatch(/^http:\/\/169\.254\.169\.254\/computeMetadata\/v1\//);
    expect(urls[1]).toBe(
      "https://storage.googleapis.com/storage/v1/b/kg-pilot-custody/o/revocations%2Fcurrent.json?alt=media",
    );
  });

  it("fails closed on credential, object, and location errors", async () => {
    const error = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
    await expect(gcsRevocationReader({ bucket: "kg-pilot-custody", object: "revocations/current.json" }, error).read()).rejects.toThrow();
    const partial = (async () => new Response(JSON.stringify(current()), { status: 206 })) as typeof fetch;
    await expect(gcsRevocationReader({ bucket: "kg-pilot-custody", object: "revocations/current.json" }, partial).read()).rejects.toThrow();
    expect(() => gcsRevocationReader({ bucket: "kg-pilot-custody", object: "../other" })).toThrow();
    expect(() => gcsRevocationReader({ bucket: "https://example.com", object: "current.json" })).toThrow();
  });

  it("rejects duplicate or escaped revocation keys before JSON parsing", async () => {
    for (const body of [
      JSON.stringify(current()).replace('"revision":7', '"revision":7,"revision":6'),
      JSON.stringify(current()).replace('"revision":7', '"revision":7,"re\\u0076ision":6'),
    ]) {
      let calls = 0;
      const fetcher = (async () => {
        calls += 1;
        return new Response(calls === 1
          ? JSON.stringify({ token_type: "Bearer", access_token: "a".repeat(40) })
          : body);
      }) as typeof fetch;
      await expect(gcsRevocationReader({
        bucket: "kg-pilot-custody", object: "revocations/current.json",
      }, fetcher).read()).rejects.toThrow("invalid revocation document");
    }
  });
});
