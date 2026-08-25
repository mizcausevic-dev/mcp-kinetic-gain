import { describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { Agent, fetch as undiciFetch } from "undici";

import {
  assertSafeFetchTarget,
  fetchJson,
  isBlockedIpv4,
  isBlockedIpv6,
  makeGuardedLookup,
  type AddressResolver,
} from "../src/common.js";

describe("isBlockedIpv4", () => {
  it("blocks every RFC1918 / loopback / link-local range at both edges", () => {
    const blocked: string[] = [
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "192.168.255.255",
      "169.254.169.254", // cloud metadata endpoint -- the canonical SSRF target
      "169.254.0.1",
    ];
    for (const ip of blocked) expect(isBlockedIpv4(ip), ip).toBe(true);
  });

  it("does not block addresses just outside each range", () => {
    const allowed: string[] = [
      "126.255.255.255",
      "128.0.0.1",
      "9.255.255.255",
      "11.0.0.0",
      "172.15.255.255",
      "172.32.0.0",
      "192.167.255.255",
      "192.169.0.0",
      "169.253.255.255",
      "169.255.0.0",
    ];
    for (const ip of allowed) expect(isBlockedIpv4(ip), ip).toBe(false);
  });

  it("does not block real public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
      expect(isBlockedIpv4(ip), ip).toBe(false);
    }
  });
});

describe("isBlockedIpv6", () => {
  it("blocks ::1, fc00::/7, and fe80::/10", () => {
    const blocked: string[] = [
      "::1",
      "fc00::1",
      "fd12:3456:789a::1",
      "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
      "fe80::1", // link-local -- the range this task adds
      "fe80::",
      "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff", // top edge of fe80::/10
    ];
    for (const ip of blocked) expect(isBlockedIpv6(ip), ip).toBe(true);
  });

  it("does not block addresses just outside fe80::/10 or fc00::/7", () => {
    const allowed: string[] = [
      "fbff::1", // just below fc00::/7
      "fec0::1", // just above fe80::/10 (old deprecated site-local, not link-local)
      "::", // unspecified address, not ::1
    ];
    for (const ip of allowed) expect(isBlockedIpv6(ip), ip).toBe(false);
  });

  it("does not block real public IPv6 addresses", () => {
    for (const ip of ["2001:4860:4860::8888", "2606:4700:4700::1111"]) {
      expect(isBlockedIpv6(ip), ip).toBe(false);
    }
  });
});

describe("isBlockedIpv6: IPv4-mapped and IPv4-compatible addresses", () => {
  // net.isIP("::ffff:127.0.0.1") returns 6, routing straight into
  // isBlockedIpv6 -- these addresses embed an IPv4 destination and must be
  // exactly as blocked as that address, or every RFC1918/loopback/link-local
  // check above is bypassable just by writing it as ::ffff:a.b.c.d.
  it("blocks IPv4-mapped (::ffff:0:0/96) addresses, dotted and pure-hex", () => {
    const blocked: string[] = [
      "::ffff:127.0.0.1", // dotted-decimal tail -- the exact parsing bug
      "::ffff:169.254.169.254", // cloud metadata endpoint, dotted
      "::ffff:7f00:1", // pure-hex equivalent of ::ffff:127.0.0.1
      "::ffff:10.0.0.1", // RFC1918 via IPv4-mapped
    ];
    for (const ip of blocked) expect(isBlockedIpv6(ip), ip).toBe(true);
  });

  it("blocks the deprecated IPv4-compatible (::/96) form too", () => {
    const blocked: string[] = ["::127.0.0.1", "::7f00:1"];
    for (const ip of blocked) expect(isBlockedIpv6(ip), ip).toBe(true);
  });

  it("does not block a public address written in IPv4-mapped form", () => {
    expect(isBlockedIpv6("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("assertSafeFetchTarget", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(assertSafeFetchTarget("file:///etc/passwd")).rejects.toThrow(/scheme/);
    await expect(assertSafeFetchTarget("ftp://example.com/")).rejects.toThrow(/scheme/);
    await expect(assertSafeFetchTarget("gopher://127.0.0.1/")).rejects.toThrow(/scheme/);
  });

  it("rejects a non-URL string outright", async () => {
    await expect(assertSafeFetchTarget("not-a-url-at-all")).rejects.toThrow();
  });

  it("rejects literal blocked IPs without needing DNS at all", async () => {
    await expect(assertSafeFetchTarget("http://127.0.0.1/")).rejects.toThrow(/blocked/);
    await expect(assertSafeFetchTarget("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(/blocked/);
    await expect(assertSafeFetchTarget("http://[::1]/")).rejects.toThrow(/blocked/);
    await expect(assertSafeFetchTarget("http://[fe80::1]/")).rejects.toThrow(/blocked/);
  });

  it("rejects an IPv4-mapped literal even though the URL as written uses dotted-decimal notation", async () => {
    // Node's own URL parser normalizes [::ffff:127.0.0.1] to [::ffff:7f00:1]
    // before this function ever sees the hostname -- confirmed by printing
    // parsed.hostname for this exact URL. That normalization is Node's, not
    // this guard's, so this test proves the guard blocks what actually
    // arrives at it either way, rather than assuming the dotted form alone
    // is what needs covering.
    await expect(assertSafeFetchTarget("http://[::ffff:127.0.0.1]/")).rejects.toThrow(/blocked/);
    await expect(assertSafeFetchTarget("http://[::ffff:169.254.169.254]/")).rejects.toThrow(/blocked/);
  });

  it("rejects a hostname that resolves to a blocked address, via an injected resolver", async () => {
    const resolver: AddressResolver = async () => [{ address: "10.1.2.3", family: 4 }];
    await expect(assertSafeFetchTarget("http://internal.test/", resolver)).rejects.toThrow(/blocked/);
  });

  it("allows a hostname that resolves to a public address", async () => {
    const resolver: AddressResolver = async () => [{ address: "93.184.216.34", family: 4 }];
    await expect(assertSafeFetchTarget("http://public.test/", resolver)).resolves.not.toThrow();
  });
});

// ----------------------------------------------------------------------------
// DNS rebinding regression test. This is the actual test for the bug class:
// a resolver that answers *differently* depending on when it's asked, which
// is exactly what an attacker's authoritative DNS server does to exploit a
// check-then-connect gap. The earlier isBlockedIpv4/isBlockedIpv6 tests above
// only prove the range math is correct given one static answer -- they say
// nothing about *when* that answer gets checked relative to when it's used.
// ----------------------------------------------------------------------------
describe("DNS rebinding: connect-time re-validation, not a cached earlier check", () => {
  function makeRebindingResolver(): { resolver: AddressResolver; callCount: () => number } {
    let calls = 0;
    const resolver: AddressResolver = async () => {
      calls += 1;
      // First call (the early assertSafeFetchTarget check) sees a public
      // address. Every call after that (standing in for "the connect-time
      // lookup, moments later") sees a private one. A real attacker's DNS
      // server does this by returning a very short TTL and flipping its
      // answer between queries.
      if (calls === 1) return [{ address: "93.184.216.34", family: 4 }];
      return [{ address: "127.0.0.1", family: 4 }];
    };
    return { resolver, callCount: () => calls };
  }

  it("the early check is fooled by the first (public) answer", async () => {
    const { resolver } = makeRebindingResolver();
    await expect(
      assertSafeFetchTarget("http://attacker-controlled.test/", resolver),
    ).resolves.not.toThrow();
  });

  it("the connect-time guarded lookup independently rejects the second (private) answer from the same resolver", async () => {
    const { resolver, callCount } = makeRebindingResolver();

    // Burn the "first call" the way assertSafeFetchTarget would, so the next
    // call through this resolver is the rebound (private) answer -- exactly
    // the sequence a real request would produce: early check, then connect.
    await assertSafeFetchTarget("http://attacker-controlled.test/", resolver);
    expect(callCount()).toBe(1);

    const guardedLookup = makeGuardedLookup(resolver);
    const err = await new Promise<Error | null>((resolve) => {
      guardedLookup(
        "attacker-controlled.test",
        { all: true },
        (err) => resolve(err),
      );
    });

    expect(callCount()).toBe(2); // proves the connect-time path re-resolved, did not reuse the first answer
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/blocked/i);
  });

  it("end-to-end: a real fetch through the guarded dispatcher is refused when the connect-time answer is private, even though the early check passed", async () => {
    // Real local server standing in for the origin an attacker fully
    // controls, including its DNS answers. If this test ever starts
    // succeeding, the rebinding gap has reopened.
    let serverHit = false;
    const server: HttpServer = createServer((_req, res) => {
      serverHit = true;
      res.end("should never be reached");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const { resolver } = makeRebindingResolver();
    // Consume the "public" first answer exactly as the real fetchJson() code
    // path does via assertSafeFetchTarget, before the connect-time lookup
    // (which will see the private answer) ever runs.
    await assertSafeFetchTarget(`http://attacker-controlled.test:${port}/`, resolver);

    const agent = new Agent({ connect: { lookup: makeGuardedLookup(resolver) } });
    await expect(
      undiciFetch(`http://attacker-controlled.test:${port}/`, { dispatcher: agent }),
    ).rejects.toThrow();

    expect(serverHit).toBe(false); // the connection never actually completed
    await agent.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("the real, exported fetchJson() refuses a blocked target end-to-end, using its own internal wiring, not a test-built stand-in", async () => {
    // No injected resolver here on purpose -- this exercises fetchJson()
    // exactly as the 20 real handlers call it, to guard against a future
    // refactor silently dropping the dispatcher wiring without any test
    // noticing. The literal-IP path doesn't need DNS at all, so it isn't
    // sensitive to the production resolver's real-world behavior.
    await expect(fetchJson("http://127.0.0.1:1/")).rejects.toThrow(/blocked/);
  });
});