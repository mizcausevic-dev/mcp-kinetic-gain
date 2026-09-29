# Release review, 2026-09-29

## Goal

Make the next `mcp-kinetic-gain` release reviewable and safe to publish without deploying in this session.

## Current state

Observed: the public repository was cloned at `95828b11f145d1e8cbef69841bb75bccc805ca5c` and a local `review/release-hardening-2026-09-29` branch was created. The release surfaces are an npm CLI/stdio MCP server, npm and MCP Registry workflows, and public installation docs. Baseline `npm run typecheck`, `npm test` (191 tests), and `npm run build` exited 0. `npm audit` reported five vulnerable packages.

## Scope

Fix confirmed fetch safety, validation, CLI, dependency, publication workflow, and documentation defects. Keep existing public tool contracts where safe. No deployment, publication, credential changes, or unrelated product work.

## Acceptance criteria

- URL tools cannot reach loopback or other nonpublic addresses through literal targets, DNS answers, or redirects.
- URL responses have a bounded body and redirect count.
- Claims Card validation agrees with the bundled schema; CLI validation fails when no files match.
- Lockfile audit, typecheck, tests, build, and package inspection produce recorded results.
- Registry publication uses a verified publisher binary and checks the exact server identity/version.
- Public docs and manifests describe the actual tool count, current version, and write behavior.

## Risks and release class

R3: a public agentic package with network tools and an optional write operation. Main risks are SSRF, resource exhaustion, false validation, misleading publication status, and sensitive event payloads. Rollback of a future release would require a new fixed version because npm publication and registry records are not safely rewound.

## Design

Use one guarded fetch path with per-hop URL validation and a shared response limit. Reuse the existing Claims Card Zod schema. Keep the npm `files` allowlist. Pin and verify the registry publisher artifact before OIDC login. Resolve version and identity from `server.json` during publication checks.

## Execution sequence

1. Fix and test `src/common.ts`, Claims Card validation, and CLI exits.
2. Update lockfile dependencies and rerun the audit.
3. Harden publication workflow and align docs.
4. Review the diff and rerun all affected checks.

## Verification

Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm audit`, `npm pack --dry-run`, focused CLI/MCP smoke checks, workflow static checks when available, and fresh remote checks.

## Deployment and rollback

No deployment is authorized for this session. A future release needs a new version and tag from a reviewed commit, successful GitHub Actions, npm package verification, and then the manually triggered MCP Registry workflow. If a published version proves defective, publish a fixed version and deprecate the defective npm version; do not rewrite an existing tag.

## Progress

- [x] Inspect checkout, instructions, baseline tests, and configuration.
- [x] Reproduce localhost reachability through `0.0.0.0` and a redirect.
- [x] Apply and verify fixes on the local review branch.
- [x] Review the final diff and record the release verdict.

## Decisions

The tagged `v0.9.2` publish workflow predates the OIDC-only fix at `main`; a new release must use a new version/tag. Existing `v0.9.2` history will not be changed.

## Outcome

**BLOCKED for production publication.** The local candidate passes the checks below, but it has not run in GitHub CI on Node 20/22, the npm Trusted Publisher account setting was not visible, and no `0.9.3` npm or MCP Registry release was authorized or executed. A successful CodeQL run on the old `main` commit is not evidence for this candidate.

### Fixes made

- Closed the reproduced `0.0.0.0`/`::` localhost aliases and redirect SSRF paths, broadened nonpublic IP denial, and bounded JSON fetches.
- Reused the bundled Claims Card schema; fixed unmatched-glob and unknown-command CLI exits; escaped GitHub Actions annotations.
- Bounded optional audit-stream traffic, refused redirects, and marked event emission as mutating. Clarified that attestation verification does not establish key identity.
- Updated five vulnerable lockfile packages, added audit gates, pinned the npm CLI and MCP Registry publisher, and changed Registry verification to the exact name/version.
- Aligned the package/Registry version to a new `0.9.3` candidate and corrected installation, licensing, and registry-status copy.

### Checks executed

| Check | Result |
| --- | --- |
| `npm ci --offline` with the workspace review cache | Exit 0; 188 packages installed, zero vulnerabilities reported at install time |
| `npm run typecheck` | Exit 0 |
| `npm test` | Exit 0; 8 files, 201 tests passed, including local SSRF, audit-stream, CLI, Claims Card, and MCP protocol cases |
| `npm run build` | Exit 0 |
| `npm audit --audit-level=moderate` | Exit 0; zero reported vulnerabilities after lockfile updates (baseline: five packages reported) |
| `actionlint -color -shellcheck=` | Exit 0; ShellCheck was unavailable locally |
| `npm pack --dry-run --ignore-scripts --json` | Exit 0; 72 files, 122286 bytes; roots limited to `dist`, `README.md`, `LICENSE`, `package.json`; `dist/server.js` present |
| `npm sbom --sbom-format cyclonedx --sbom-type library` | Exit 0; CycloneDX 1.5 workspace inventory, 159 components, including development dependencies |
| `gitleaks dir` and `gitleaks git` with redaction | Both exit 0 with no reported findings; no known-positive control was run, so this is not a verified-clean secret audit |
| `git diff --check` | Exit 0 |
| Built CLI smoke | `--version` exit 0 and reported `0.9.3`; mistyped command exit 3; unmatched glob exit 1 |
| Publisher archive SHA-256 | Downloaded official `v1.8.1` Linux archive; digest matched GitHub release metadata |
| Fresh remote reads | GitHub `main` `95828b1`; npm `latest` `0.9.1`; MCP Registry `latest` `0.9.1`, active |

### Remaining gates and limits

- Run the candidate's GitHub CI, actionlint, and CodeQL workflows after review branch publication; local checks ran on Windows with Node 24.11.0, not the Ubuntu Node 20/22 matrix.
- Confirm npm Trusted Publisher configuration for this repository/workflow, then verify actual npm provenance and the published tarball after a new release tag. The old `v0.9.2` tag cannot exercise the new publish workflow.
- Run the manual MCP Registry workflow only after npm is live and verify the exact public Registry record. No release workflow was triggered here.
- The optional live audit-stream tools were tested against local HTTP fixtures, not a production audit-stream instance. Its authorization, retention, and approval handling remain deployment-specific. MCP annotations inform clients but do not enforce human approval.
- No browser interface exists in this package, so browser and screen-reader UI checks were not applicable. Public Suite-site copy was not changed in this repository.
