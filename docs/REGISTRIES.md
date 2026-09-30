# Distribution and release state

## Observed on 2026-09-30 UTC

| Surface | Observed state | Evidence |
| --- | --- | --- |
| GitHub `v0.9.3` tag | `0d405133c194f5a2489e2804a44dec8d55b30d5e` | Fresh remote tag read; [PR #43](https://github.com/mizcausevic-dev/mcp-kinetic-gain/pull/43) merged after CI, actionlint, and CodeQL passed |
| npm `latest` | `0.9.3` | `npm view mcp-kinetic-gain version dist-tags --prefer-online --json`; exact public version record contains tarball integrity and SLSA provenance metadata |
| Official MCP Registry `latest` | `0.9.3` | [Publish workflow](https://github.com/mizcausevic-dev/mcp-kinetic-gain/actions/runs/36647990242) exited 0; exact-name `/v0.1/servers/io.github.mizcausevic-dev%2Fmcp-kinetic-gain/versions/latest` response reports package and server version `0.9.3` |
| GitHub Release | [v0.9.3](https://github.com/mizcausevic-dev/mcp-kinetic-gain/releases/tag/v0.9.3) with `cyclonedx.json` | Uploaded asset SHA-256 `a993ea331b472c68a8a9413a6865422ed4fe0a9a76ec99d409645b65c36723cd` matched the local CycloneDX 1.5 workspace inventory |

The `v0.9.3` tag workflow passed its audit, typecheck, tests, build, SBOM generation, and OIDC publish steps, but [ended in failure](https://github.com/mizcausevic-dev/mcp-kinetic-gain/actions/runs/36647695364) when its `npm view` polling step kept returning 404. A fresh direct npm version request succeeded and a clean install reported `mcp-kinetic-gain v0.9.3`. A stdio MCP smoke test against that installed package listed 75 tools, found `audit_event_emit` marked as mutating, and rejected a malformed Claims Card. `npm audit signatures` exited 0 with 115 verified registry signatures and 14 verified attestations. The GitHub Release and SBOM were created separately from the reviewed source tree. The publish workflow now checks the exact public version record with fresh requests, avoiding repeated local npm metadata-cache reads during post-publish verification.

The existing `v0.9.2` tag points to a commit before the OIDC-only npm publishing workflow fix. It was not reused or rewritten for this release.

Earlier mcp.so, Cline, Glama, and Smithery notes were not reverified in this review; they are not publication evidence for this candidate.

The previous 2026-07-12 handoff recorded an mcp.so submission, [Cline marketplace issue #1661](https://github.com/cline/mcp-marketplace/issues/1661), and decisions to defer Glama and Smithery. Those are historical notes only. The repository retains `assets/logo-400.png`, `glama.json`, `smithery.yaml`, and `llms-install.md` for any later channel review.

## Future release sequence

1. Merge a reviewed, version-aligned change after CI, actionlint, and CodeQL pass. Confirm the npm Trusted Publisher points to this repository and `.github/workflows/publish.yml`.
2. Create a new version tag on the reviewed main commit. The tag workflow audits, tests, builds, publishes with OIDC provenance, verifies the exact public npm version record, and attaches a workspace dependency SBOM to the GitHub Release.
3. Independently inspect the public npm tarball and provenance, then smoke-test an exact-version install. If publication succeeded but a later workflow step fails, do not rerun `npm publish` for that same version; verify and complete the missing evidence separately.
4. Manually run `.github/workflows/registry-publish.yml` after npm is live. It verifies the pinned publisher binary and exact package and Registry identities.
5. Verify the exact public Registry record and maintain a correction/rollback path.

If a released version is defective, publish a corrected version and deprecate the defective npm version. Do not rewrite an existing release tag. See [the release review](RELEASE_REVIEW_2026-09-29.md) for local evidence and remaining gates.
