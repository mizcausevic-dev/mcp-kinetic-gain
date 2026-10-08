import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";

import {
  handleAuditChainVerifyLive,
  handleAuditEventEmit,
  handleAuditEventsQuery,
} from "../src/handlers/audit-stream-live.js";

const TEST_TOKEN = "A".repeat(32);

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function withAuditUrl<T>(
  url: string,
  run: () => Promise<T>,
  token: string | null = TEST_TOKEN,
): Promise<T> {
  const previous = process.env.AUDIT_STREAM_URL;
  const previousToken = process.env.AUDIT_STREAM_TOKEN;
  process.env.AUDIT_STREAM_URL = url;
  if (token === null) delete process.env.AUDIT_STREAM_TOKEN;
  else process.env.AUDIT_STREAM_TOKEN = token;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.AUDIT_STREAM_URL;
    else process.env.AUDIT_STREAM_URL = previous;
    if (previousToken === undefined) delete process.env.AUDIT_STREAM_TOKEN;
    else process.env.AUDIT_STREAM_TOKEN = previousToken;
  }
}

describe("live audit-stream boundaries", () => {
  it("fails closed without a valid bearer token before any request", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits += 1;
      res.end("{}");
    });
    const port = await listen(server);
    try {
      for (const token of [null, "short", "A".repeat(31), "A".repeat(31) + " "]) {
        const out = await withAuditUrl(
          `http://127.0.0.1:${port}`,
          () => handleAuditEventsQuery({}),
          token,
        );
        expect(JSON.parse(out).error).toMatch(/AUDIT_STREAM_TOKEN/);
      }
      expect(hits).toBe(0);
    } finally {
      await close(server);
    }
  });

  it("sends the bearer token to each live endpoint and accepts a matching sink", async () => {
    const seen: Array<{ path: string; method: string; auth: string | undefined }> = [];
    const server = createServer((req, res) => {
      seen.push({
        path: req.url ?? "",
        method: req.method ?? "",
        auth: req.headers.authorization,
      });
      res.setHeader("content-type", "application/json");
      if (req.url === "/events" && req.method === "POST") {
        res.writeHead(201);
        res.end(JSON.stringify({ event_id: 1, hash: "a".repeat(64), kind: "other", source: "manual" }));
      } else if (req.url?.startsWith("/events")) {
        res.end("[]");
      } else {
        res.end(JSON.stringify({ valid: true, checked: 1 }));
      }
    });
    const port = await listen(server);
    try {
      await withAuditUrl(`http://127.0.0.1:${port}`, async () => {
        expect(JSON.parse(await handleAuditEventEmit({ kind: "other", source: "manual" })).ok).toBe(true);
        expect(JSON.parse(await handleAuditEventsQuery({ source: "manual", limit: 1 })).count).toBe(0);
        expect(JSON.parse(await handleAuditChainVerifyLive({})).valid).toBe(true);
      });
      expect(seen).toEqual([
        { path: "/events", method: "POST", auth: `Bearer ${TEST_TOKEN}` },
        { path: "/events?source=manual&limit=1", method: "GET", auth: `Bearer ${TEST_TOKEN}` },
        { path: "/verify", method: "GET", auth: `Bearer ${TEST_TOKEN}` },
      ]);
    } finally {
      await close(server);
    }
  });

  it("never echoes the bearer token from a failed sink response", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(401);
      res.end(`invalid bearer: ${TEST_TOKEN}`);
    });
    const port = await listen(server);
    try {
      const out = await withAuditUrl(`http://127.0.0.1:${port}`, () =>
        handleAuditEventsQuery({}),
      );
      expect(JSON.parse(out)).toEqual({ error: "audit-stream returned HTTP 401" });
      expect(out).not.toContain(TEST_TOKEN);
    } finally {
      await close(server);
    }
  });

  it("does not claim success for malformed 2xx sink responses", async () => {
    let status = 200;
    let body = "";
    const server = createServer((_req, res) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    });
    const port = await listen(server);
    const validReceipt = {
      event_id: 1, hash: "a".repeat(64), kind: "other", source: "manual",
    };
    const cases: Array<{ route: "emit" | "query" | "verify"; code: number; data: string }> = [
      { route: "emit", code: 200, data: JSON.stringify(validReceipt) },
      { route: "emit", code: 201, data: "<html>leak-marker</html>" },
      { route: "emit", code: 201, data: JSON.stringify({ event_id: 1, kind: "other", source: "manual" }) },
      { route: "emit", code: 201, data: JSON.stringify({ ...validReceipt, source: "other-producer" }) },
      { route: "query", code: 200, data: "<html>leak-marker</html>" },
      { route: "query", code: 200, data: JSON.stringify({ events: [] }) },
      { route: "query", code: 204, data: "" },
      { route: "verify", code: 200, data: "<html>leak-marker</html>" },
      { route: "verify", code: 200, data: JSON.stringify({ valid: "true", checked: 1 }) },
      { route: "verify", code: 200, data: JSON.stringify({ valid: true, checked: "1" }) },
    ];
    try {
      for (const item of cases) {
        status = item.code;
        body = item.data;
        const out = await withAuditUrl(`http://127.0.0.1:${port}`, () => {
          if (item.route === "emit") {
            return handleAuditEventEmit({ kind: "other", source: "manual" });
          }
          if (item.route === "query") return handleAuditEventsQuery({});
          return handleAuditChainVerifyLive({});
        });
        expect(JSON.parse(out).error).toBeTruthy();
        expect(out).not.toContain("leak-marker");
      }
    } finally {
      await close(server);
    }
  });

  it("refuses remote plaintext and URL-embedded credentials", async () => {
    for (const url of ["http://example.com:8093", "http://user:pass@127.0.0.1:8093"]) {
      const out = await withAuditUrl(url, () => handleAuditEventsQuery({}));
      expect(JSON.parse(out).error).toMatch(/AUDIT_STREAM_URL/);
      expect(out).not.toContain("pass");
    }
  });

  it("rejects every malformed supplied query filter without reading any events", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits += 1;
      res.end("[]");
    });
    const port = await listen(server);
    const malformed = [
      { kind: "" }, { kind: "   " }, { kind: null }, { kind: 1 }, { kind: undefined },
      { source: "" }, { source: "   " }, { source: null }, { source: 1 },
      { source: undefined }, { source: "bad source" }, { source: "x".repeat(129) },
      { limit: 0 }, { limit: 1_001 }, { limit: null }, { limit: "5" }, { limit: undefined },
    ];
    try {
      for (const filters of malformed) {
        const out = await withAuditUrl(`http://127.0.0.1:${port}`, () =>
          handleAuditEventsQuery(filters),
        );
        expect(JSON.parse(out).error).toBeTruthy();
      }
      expect(hits).toBe(0);
    } finally {
      await close(server);
    }
  });

  it("rejects supplied invalid payloads without emitting an event", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits += 1;
      res.end("{}");
    });
    const port = await listen(server);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    try {
      for (const payload of [undefined, null, [], "text", 7, new Date(), new Map(), cyclic]) {
        const out = await withAuditUrl(`http://127.0.0.1:${port}`, () =>
          handleAuditEventEmit({ kind: "other", source: "manual", payload }),
        );
        expect(JSON.parse(out).error).toMatch(/payload/);
      }
      expect(hits).toBe(0);
    } finally {
      await close(server);
    }
  });

  it("rejects a combined kind and source filter the sink cannot apply", async () => {
    const out = await withAuditUrl("http://127.0.0.1:1", () =>
      handleAuditEventsQuery({ kind: "other", source: "manual" }),
    );
    expect(JSON.parse(out).error).toMatch(/does not combine/);
  });

  it("rejects since_id instead of silently ignoring an unsupported filter", async () => {
    const out = await withAuditUrl("http://127.0.0.1:1", () =>
      handleAuditEventsQuery({ since_id: 12 }),
    );
    expect(JSON.parse(out).error).toMatch(/does not support since_id/);
  });

  it("rejects an oversized query limit before contacting the sink", async () => {
    const out = await withAuditUrl("http://127.0.0.1:1", () =>
      handleAuditEventsQuery({ limit: 100_000 }),
    );
    expect(JSON.parse(out).error).toMatch(/1\.\.1000/);
  });

  it("rejects an oversized event before sending it", async () => {
    const out = await withAuditUrl("http://127.0.0.1:1", () =>
      handleAuditEventEmit({ kind: "test", source: "test", payload: { text: "x".repeat(70_000) } }),
    );
    expect(JSON.parse(out).error).toMatch(/byte limit/);
  });

  it("rejects a source label the audit-stream service would reject", async () => {
    const out = await withAuditUrl("http://127.0.0.1:1", () =>
      handleAuditEventEmit({ kind: "other", source: "not a service", payload: {} }),
    );
    expect(JSON.parse(out).error).toMatch(/ASCII service identifier/);
  });

  it("does not forward a POST across a redirect", async () => {
    let destinationHits = 0;
    const destination = createServer((_req, res) => {
      destinationHits += 1;
      res.end("{}");
    });
    const destinationPort = await listen(destination);
    const source = createServer((_req, res) => {
      res.writeHead(307, { Location: `http://127.0.0.1:${destinationPort}/events` });
      res.end();
    });
    const sourcePort = await listen(source);
    try {
      const out = await withAuditUrl(`http://127.0.0.1:${sourcePort}`, () =>
        handleAuditEventEmit({ kind: "test", source: "test", payload: {} }),
      );
      expect(JSON.parse(out).error).toMatch(/failed to reach audit-stream/);
      expect(destinationHits).toBe(0);
    } finally {
      await close(source);
      await close(destination);
    }
  });

  it("caps a live query response before returning it to the client", async () => {
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([{ payload: "x".repeat(1_000_001) }]));
    });
    const port = await listen(server);
    try {
      const out = await withAuditUrl(`http://127.0.0.1:${port}`, () =>
        handleAuditEventsQuery({ limit: 1 }),
      );
      expect(JSON.parse(out).detail).toMatch(/byte limit/);
    } finally {
      await close(server);
    }
  });
});
