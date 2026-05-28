# MCP registry distribution — fire-ready submission guide

`mcp-kinetic-gain` (v0.7.1, 63 tools, npm package
[`mcp-kinetic-gain`](https://www.npmjs.com/package/mcp-kinetic-gain)) is already
discoverable via auto-scrapers (e.g. mcpmarket.com). This guide is the
**stage-up sheet** for the five registries you control. The in-repo metadata is
done — the steps below are the auth-gated publish/claim actions that need
Miz's GitHub account at the keyboard. Every block is copy-paste-ready.

## Pre-flight (already done)

| Artifact | Location | State |
| --- | --- | --- |
| Official Registry manifest | `server.json` | v0.7.1, namespace `io.github.mizcausevic-dev/*` |
| Smithery config | `smithery.yaml` | stdio + optional `AUDIT_STREAM_URL` |
| Glama maintainer claim | `glama.json` | `maintainers: ["mizcausevic-dev"]` |
| Cline AI-readable install | `llms-install.md` | one config block + audit-stream env note |
| Marketplace logo (400×400) | `assets/logo-400.png` | required for Cline submission |
| npm publish | npm registry | v0.7.1 live; `mcpName` field set |

Quick facts to drop into any listing:

- **Package:** `npm i -g mcp-kinetic-gain` · run: `npx -y mcp-kinetic-gain`
- **Version:** 0.7.1 · **Tools:** 63 (47 spec + 16 implementation-preview)
- **Specs:** all 11 Kinetic Gain Protocol Suite specifications
- **Transport:** stdio · **Optional env:** `AUDIT_STREAM_URL`
- **Repo:** https://github.com/mizcausevic-dev/mcp-kinetic-gain
- **Suite:** https://suite.kineticgain.com · **License:** see repo

---

## 1. Official MCP Registry (registry.modelcontextprotocol.io) — **highest value**

Publishing claims the `io.github.mizcausevic-dev/*` namespace via GitHub OAuth,
so only you can publish under it. **Do this one first** — the others auto-pick-up
once the namespace is owned.

```bash
# 1. Install the publisher CLI (one-time):
#    macOS: brew install mcp-publisher
#    Other: download binary from github.com/modelcontextprotocol/registry/releases
mcp-publisher --version

# 2. From repo root (where server.json lives):
cd /path/to/mcp-kinetic-gain

# 3. Authenticate via GitHub OAuth (browser opens):
mcp-publisher login github

# 4. Publish v0.7.1 — reads ./server.json:
mcp-publisher publish

# 5. Verify it landed:
curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=kinetic-gain' | jq
```

If the bundled `$schema` date in `server.json` is rejected, run
`mcp-publisher init` to regenerate a fresh manifest, then re-apply the npm
identifier (`mcp-kinetic-gain`) + the `AUDIT_STREAM_URL` env var, and
`mcp-publisher publish` again.

---

## 2. Glama (glama.ai)

Glama auto-indexes public GitHub MCP servers. To **claim** ownership (so you
can edit metadata and the listing shows you as maintainer):

1. Sign in at https://glama.ai with GitHub (`mizcausevic-dev`).
2. Search the directory for `mcp-kinetic-gain`.
3. Click **Claim** on the server page — the `glama.json` `maintainers`
   entry verifies ownership automatically.

Nothing to draft — Glama reads the repo.

---

## 3. Smithery (smithery.ai)

1. Sign in at https://smithery.ai with GitHub.
2. Click **Add Server** → select `mizcausevic-dev/mcp-kinetic-gain`.
3. Smithery reads `smithery.yaml` (stdio + `auditStreamUrl` config).
4. **Confirm and publish.**

If Smithery asks for a one-line summary, paste:

> Unified MCP server for the eleven Kinetic Gain Protocol Suite specs — 63 governance tools across AEO, Prompt Provenance, Agent Cards, AI Evidence Format, MCP Tool Cards, AI Tutor Cards, Student AI Disclosure, Classroom AUP, Clinical AI, AI Incident Card, AI Procurement Decision Card.

---

## 4. Cline Marketplace (github.com/cline/mcp-marketplace)

Cline takes submissions as a GitHub issue on their repo. Requirements satisfied
by this repo:

- ✅ Public GitHub URL
- ✅ README with a clear setup section
- ✅ `llms-install.md` for AI-readable install
- ✅ 400×400 PNG logo (`assets/logo-400.png`)

### Submission steps

1. Open https://github.com/cline/mcp-marketplace/issues/new and pick their
   submission template.
2. Use the title and body below.
3. Attach `assets/logo-400.png` from this repo.

### Issue title

```
Submission: mcp-kinetic-gain — unified MCP server for the 11 Kinetic Gain Protocol Suite specs
```

### Issue body (copy-paste)

```markdown
**GitHub Repo URL**
https://github.com/mizcausevic-dev/mcp-kinetic-gain

**Logo (400×400 PNG)**
Attached: `logo-400.png` (also at https://github.com/mizcausevic-dev/mcp-kinetic-gain/raw/main/assets/logo-400.png)

**Why this server**
One MCP server covers all eleven Kinetic Gain Protocol Suite specs — AEO
Protocol, Prompt Provenance, Agent Cards, AI Evidence Format, MCP Tool Cards,
AI Tutor Cards, Student AI Disclosure, Classroom AI AUP, Clinical AI
Disclosure, AI Incident Card, and AI Procurement Decision Card. 63 tools
total (47 spec + 16 implementation-preview) including ed25519 attestation
verification, hash-chained audit-stream event composition + chain
verification (offline AND live against a running audit-stream-py via
`AUDIT_STREAM_URL`), cross-spec drift detection, and a Decision Intelligence
preview (Decision Card → PolicyBundle, rubric status inference, incident
remediation planning).

**Setup test**
Verified per `llms-install.md`: one stdio config entry, `npx -y mcp-kinetic-gain`,
no API key, no build step. Optional `AUDIT_STREAM_URL` enables the three live
audit-stream tools (`audit_event_emit`, `audit_events_query`,
`audit_chain_verify_live`); without it, the other 60 tools run fully offline.

**Categories**
governance, compliance, AI evidence, audit, schema validation

**Maintainer**
@mizcausevic-dev
```

---

## 5. mcp.so

Community directory with a submit form: https://mcp.so/submit. It also
auto-crawls, but submitting ensures the v0.7.1 metadata propagates immediately.

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

---

## Order of operations (recommended)

1. **Official MCP Registry** (`mcp-publisher publish`) — claims namespace; ~5 min.
2. **Smithery** (Add Server flow) — pulls smithery.yaml automatically; ~3 min.
3. **Glama** (Claim button) — verifies via glama.json; ~2 min.
4. **Cline** (GitHub issue submission) — paste the title + body above, attach `logo-400.png`; ~5 min.
5. **mcp.so** (submit form) — paste the form values + description; ~3 min.

Total time at the keyboard: **~20 minutes**, all auth-gated on `@mizcausevic-dev`.
