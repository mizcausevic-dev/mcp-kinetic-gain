# MCP registry distribution — current state + the one remaining submission

`mcp-kinetic-gain` v0.7.1 (63 tools, 11 specs, stdio over
[`npm i -g mcp-kinetic-gain`](https://www.npmjs.com/package/mcp-kinetic-gain))
is already in the registries that fit a stdio+npm server. This doc tracks
**what's live, what was pruned, and what's still outstanding** so the lane
doesn't drift back into "do all five again" thinking.

## Status (verified 2026-05-28)

| Registry | State | Notes |
| --- | --- | --- |
| Official MCP Registry | ✅ **LIVE** | `io.github.mizcausevic-dev/mcp-kinetic-gain` v0.7.1, `status: active`, published 2026-05-24. Verified via `GET /v0/servers?search=mcp-kinetic-gain`. |
| npm | ✅ **LIVE** | v0.7.1, `mcpName` set. |
| Cline marketplace | 🕐 **SUBMITTED** | Issue [cline/mcp-marketplace#1661](https://github.com/cline/mcp-marketplace/issues/1661) — open, awaiting Cline team review. |
| Glama | ⛔ **PRUNED** | Throws 500s + gates behind "Add billing / Top up balance". Not worth the friction. `glama.json` stays in repo for a future re-evaluation. |
| Smithery | ⛔ **PRUNED** | Their submit form requires a hosted HTTPS MCP server URL; this is stdio over npx. Not applicable until/unless we host it. `smithery.yaml` stays in repo for the future GitHub-deploy path. |
| mcp.so | ⏳ **PENDING** | The only outstanding manual submission. Form values + description below. |

Quick facts to paste anywhere:

- **Package:** `npm i -g mcp-kinetic-gain` · run: `npx -y mcp-kinetic-gain`
- **Version:** 0.7.1 · **Tools:** 63 (47 spec + 16 implementation-preview)
- **Specs:** all 11 Kinetic Gain Protocol Suite specifications
- **Transport:** stdio · **Optional env:** `AUDIT_STREAM_URL`
- **Repo:** https://github.com/mizcausevic-dev/mcp-kinetic-gain
- **Suite:** https://suite.kineticgain.com

---

## The remaining submission: mcp.so

Community directory with a submit form: https://mcp.so/submit. The site also
auto-crawls but submitting ensures the v0.7.1 metadata lands cleanly.

### Form values

| Field | Value |
| --- | --- |
| GitHub URL | `https://github.com/mizcausevic-dev/mcp-kinetic-gain` |
| npm package | `mcp-kinetic-gain` |
| Name | `mcp-kinetic-gain` |
| Tagline (one line) | Unified MCP server for the 11 Kinetic Gain Protocol Suite specs — 63 governance tools, stdio, no API key. |
| Tags | `governance`, `compliance`, `audit-stream`, `aeo-protocol`, `mcp-tool-cards`, `agent-cards`, `prompt-provenance`, `clinical-ai`, `student-ai`, `procurement` |
| Install command | `npx -y mcp-kinetic-gain` |

### Description (copy-paste)

```markdown
mcp-kinetic-gain is a single stdio MCP server that exposes all eleven
Kinetic Gain Protocol Suite specs to any MCP-compatible client (Claude
Desktop, Cline, Cursor, etc.) — 63 tools across AEO Protocol, Prompt
Provenance, Agent Cards, AI Evidence Format, MCP Tool Cards, AI Tutor
Cards, Student AI Disclosure, Classroom AI AUP, Clinical AI Disclosure,
AI Incident Card, and AI Procurement Decision Card.

Includes ed25519 attestation verification, hash-chained audit-stream
event composition and chain verification (offline AND live against a
running audit-stream-py via the optional AUDIT_STREAM_URL env var),
cross-spec drift detection, and a Decision Intelligence preview that
generates a PolicyBundle from a Decision Card, infers rubric status,
and plans incident remediation.

Also doubles as a CLI: `npx mcp-kinetic-gain validate path/to/doc.json`
auto-detects which Suite spec a JSON file belongs to and validates it
against the same zod schemas the MCP tools use.

No API key. No build step. Headline tools: aup_check_compliance,
decision_card_validate, decision_card_to_policy_bundle,
attestation_verify, suite_doc_drift, audit_chain_verify,
audit_event_emit.

Repo: https://github.com/mizcausevic-dev/mcp-kinetic-gain
Suite: https://suite.kineticgain.com
```

Estimated time at the keyboard: **~3 minutes**, signed in with @mizcausevic-dev.

---

## Reference: the moves that landed the others

Documented here so future version bumps don't need to re-derive the workflow.

### Official MCP Registry — how v0.7.1 got published

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

- **mcp-kinetic-gain bump > 0.7.x**: re-run `mcp-publisher publish` after npm ships.
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
