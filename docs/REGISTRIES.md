# MCP registry distribution

`mcp-kinetic-gain` (v0.7.0, 63 tools, npm package `mcp-kinetic-gain`) is
already discoverable via auto-scrapers (e.g. mcpmarket.com). This guide lists
the **registries you control** so the *accurate, current* listing is what
spreads. The in-repo metadata is done — the steps below are the auth-gated
publish/claim actions to run with your own GitHub account.

In-repo metadata already added:
- `server.json` — official MCP Registry manifest (namespace `io.github.mizcausevic-dev/mcp-kinetic-gain`)
- `smithery.yaml` — Smithery stdio config (+ optional `AUDIT_STREAM_URL`)
- `glama.json` — Glama maintainer claim (`mizcausevic-dev`)
- `llms-install.md` — AI-readable install guide (Cline/agent friendly)

---

## 1. Official MCP Registry (registry.modelcontextprotocol.io) — **highest value**

Publishing claims the `io.github.mizcausevic-dev/*` namespace via GitHub OAuth,
so only you can publish under it.

```bash
# install the publisher CLI (Go binary; see github.com/modelcontextprotocol/registry/releases)
# macOS: brew install mcp-publisher   |   or download the release binary

# from the repo root (where server.json lives):
mcp-publisher login github      # opens browser, authorizes the io.github.mizcausevic-dev namespace
mcp-publisher publish           # reads ./server.json and publishes v0.7.0
```

If the bundled `$schema` date in `server.json` is ever rejected, run
`mcp-publisher init` to regenerate a fresh manifest, then re-apply the npm
identifier + `AUDIT_STREAM_URL` env var and `mcp-publisher publish`.

## 2. Glama (glama.ai)

Glama auto-indexes public GitHub MCP servers. To **claim** it (so you can edit
metadata and it shows you as maintainer):
1. Sign in at https://glama.ai with GitHub (`mizcausevic-dev`).
2. Find the `mcp-kinetic-gain` server page → **Claim** (the `glama.json`
   `maintainers` entry verifies ownership).

## 3. Smithery (smithery.ai)

1. Sign in at https://smithery.ai with GitHub.
2. **Add Server** → select `mizcausevic-dev/mcp-kinetic-gain`.
3. Smithery reads `smithery.yaml` (stdio + `auditStreamUrl` config). Confirm and publish.

## 4. Cline Marketplace (github.com/cline/mcp-marketplace)

Cline takes submissions as a GitHub issue on their repo. Requirements are now
satisfied by this repo: public GitHub URL, a README with a clear setup section,
and `llms-install.md`. You'll also need a **400×400 PNG logo**.
1. Open https://github.com/cline/mcp-marketplace/issues/new (use their submission template).
2. Repo URL: `https://github.com/mizcausevic-dev/mcp-kinetic-gain`. Attach the logo.

## 5. mcp.so

Community directory with a submit form: https://mcp.so/submit — paste the GitHub
URL and the npm package `mcp-kinetic-gain`. (It also auto-crawls, but submitting
ensures the v0.7.0 metadata.)

---

## Quick facts to paste into any listing

- **Package:** `npm i -g mcp-kinetic-gain` · run: `npx -y mcp-kinetic-gain`
- **Version:** 0.7.0 · **Tools:** 63 (47 spec + 16 implementation-preview)
- **Specs:** all 11 Kinetic Gain Protocol Suite specifications
- **Transport:** stdio · **Optional env:** `AUDIT_STREAM_URL`
- **Repo:** https://github.com/mizcausevic-dev/mcp-kinetic-gain
- **Suite:** https://suite.kineticgain.com · **License:** see repo
