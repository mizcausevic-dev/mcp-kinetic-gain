# MCP registry distribution — current state + the one remaining submission

`mcp-kinetic-gain` v0.8.0 (71 tools, 11 specs + DefenseTech 6-pack, stdio over
[`npm i -g mcp-kinetic-gain`](https://www.npmjs.com/package/mcp-kinetic-gain))
is already in the registries that fit a stdio+npm server. This doc tracks
**what's live, what was pruned, and what's still outstanding** so the lane
doesn't drift back into "do all five again" thinking.

## Status (verified 2026-06-02)

| Registry | State | Notes |
| --- | --- | --- |
| Official MCP Registry | 🔄 **NEEDS REPUBLISH** | Currently hosting v0.7.1 (`status: active`, published 2026-05-24). Local `server.json` bumped to 0.8.0 + 71 tools; re-run `mcp-publisher publish` to advance the Registry. |
| npm | ✅ **LIVE** | v0.8.0, `mcpName` set, 71 tools. |
| mcp.so | ✅ **LIVE** | Submitted 2026-06-01 — community directory auto-crawls metadata from the GitHub repo. |
| Cline marketplace | 🕐 **SUBMITTED** | Issue [cline/mcp-marketplace#1661](https://github.com/cline/mcp-marketplace/issues/1661) — open, awaiting Cline team review. |
| Glama | ⛔ **PRUNED** | Throws 500s + gates behind "Add billing / Top up balance". Not worth the friction. `glama.json` stays in repo for a future re-evaluation. |
| Smithery | ⛔ **PRUNED** | Their submit form requires a hosted HTTPS MCP server URL; this is stdio over npx. Not applicable until/unless we host it. `smithery.yaml` stays in repo for the future GitHub-deploy path. |

Quick facts to paste anywhere:

- **Package:** `npm i -g mcp-kinetic-gain` · run: `npx -y mcp-kinetic-gain`
- **Version:** 0.8.0 · **Tools:** 71 (47 spec + 16 implementation-preview + 8 DefenseTech)
- **Specs:** all 11 Kinetic Gain Protocol Suite specifications + DefenseTech 6-pack
- **Transport:** stdio · **Optional env:** `AUDIT_STREAM_URL`
- **Repo:** https://github.com/mizcausevic-dev/mcp-kinetic-gain
- **Suite:** https://suite.kineticgain.com

---

## Reference: the moves that landed the others

Documented here so future version bumps don't need to re-derive the workflow.

### Official MCP Registry — how publishing works (and what to bump)

```bash
# 1. Get mcp-publisher (one-time):
#    macOS: brew install mcp-publisher
#    Other: download binary from github.com/modelcontextprotocol/registry/releases
mcp-publisher --version

# 2. From repo root:
cd /path/to/mcp-kinetic-gain

# 3. Authenticate (browser opens):
mcp-publisher login github

# 4. Publish — reads ./server.json:
mcp-publisher publish

# 5. Verify it landed:
curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=kinetic-gain' | jq
```

For future version bumps: edit `server.json` `version` + `packages[].version`,
edit `package.json` `version`, ship npm first (CI handles it), then re-run
`mcp-publisher publish`. The npm tarball must carry `mcpName` in package.json
for the Registry to accept the package mapping.

### Cline marketplace — what was submitted

Issue [#1661](https://github.com/cline/mcp-marketplace/issues/1661) carries:
- Repo URL
- 400×400 logo (embedded inline; standalone copy in this repo at `assets/logo-400.png`)
- Reason + install testing checklist
- `llms-install.md` for AI-readable install

If Cline asks for revisions, the issue body can be edited in place — no
re-submission needed.

---

## When this lane re-opens

- **mcp-kinetic-gain bump > 0.8.x**: bump `server.json` `version` + `packages[].version` + `description` tool count to match, then re-run `mcp-publisher publish` after npm ships. (Lesson from 0.7.1 → 0.8.0: npm + README + CHANGELOG drifted ahead while `server.json` stayed at 0.7.1 for a week — every release must touch ALL three manifests together.)
- **A hosted HTTPS variant exists**: re-evaluate Smithery (the `smithery.yaml` is ready).
- **Glama unblocks billing-free submissions**: re-evaluate the claim flow.
- **Pulse Issue #5 (Aug)**: the lane shows up in Pulse measurements via the
  registry metadata — no action needed, just noting the dependency.

## Pre-flight artifacts already in repo

| Artifact | Path | Purpose |
| --- | --- | --- |
| Registry manifest | `server.json` | Official MCP Registry publish input |
| Smithery config | `smithery.yaml` | Reserved for future hosted variant |
| Glama claim | `glama.json` | Reserved for future Glama re-evaluation |
| Cline install guide | `llms-install.md` | AI-readable install for Cline |
| Marketplace logo | `assets/logo-400.png` | 400×400 PNG attached to Cline submission |
