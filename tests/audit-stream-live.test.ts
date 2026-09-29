import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";

import { handleAuditEventEmit, handleAuditEventsQuery } from "../src/handlers/audit-stream-live.js";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function withAuditUrl<T>(url: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.AUDIT_STREAM_URL;
  process.env.AUDIT_STREAM_URL = url;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.AUDIT_STREAM_URL;
    else process.env.AUDIT_STREAM_URL = previous;
  }
}

describe("live audit-stream boundaries", () => {
  it("rejects an oversized event before sending it", async () => {
    const out = await withAuditUrl("http://127.0.0.1:1", () =>
      handleAuditEventEmit({ kind: "test", source: "test", payload: { text: "x".repeat(70_000) } }),
    );
    expect(JSON.parse(out).error).toMatch(/byte limit/);
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
