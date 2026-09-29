# Distribution and release state

## Observed on 2026-09-29

| Surface | Observed state | Evidence |
| --- | --- | --- |
| GitHub `main` | `95828b11f145d1e8cbef69841bb75bccc805ca5c` | Fresh `git ls-remote origin refs/heads/main` |
| npm `latest` | `0.9.1` | `npm view mcp-kinetic-gain version --json` |
| Official MCP Registry `latest` | `0.9.1`, active | Exact-name `/v0.1/servers/io.github.mizcausevic-dev%2Fmcp-kinetic-gain/versions/latest` response |
| Local release candidate | `0.9.3`, not published | `package.json`, lockfile, `server.json`, changelog, and review branch |

The existing `v0.9.2` tag points to a commit before the OIDC-only npm publishing workflow fix. npm and the MCP Registry do not list `0.9.2` as the latest published version. Do not rewrite or rerun that tag to release this candidate. The next release needs a new reviewed commit and `v0.9.3` tag.

Earlier mcp.so, Cline, Glama, and Smithery notes were not reverified in this review; they are not publication evidence for this candidate.

The previous 2026-07-12 handoff recorded an mcp.so submission, [Cline marketplace issue #1661](https://github.com/cline/mcp-marketplace/issues/1661), and decisions to defer Glama and Smithery. Those are historical notes only. The repository retains `assets/logo-400.png`, `glama.json`, `smithery.yaml`, and `llms-install.md` for any later channel review.

## Release sequence after approval

1. Merge the reviewed branch after CI and workflow checks pass. Confirm npm Trusted Publisher still points to this repository and `.github/workflows/publish.yml`; this account setting was not visible during the local review.
2. Create and push a new `v0.9.3` tag from the reviewed commit. `.github/workflows/publish.yml` checks the tag/version match, audits dependencies, tests, builds, publishes to npm with provenance, and attaches an SBOM to the GitHub Release.
3. Verify `npm view mcp-kinetic-gain@0.9.3 version` and inspect the published tarball/provenance. A green workflow alone is not proof that the package is available to consumers.
4. Manually run `.github/workflows/registry-publish.yml` only after npm is live. The workflow checks the exact package/version, verifies a pinned `mcp-publisher` binary, validates `server.json`, publishes with GitHub OIDC, and checks the exact Registry server/version.
5. Verify the public Registry record and test installation of the published package from a clean environment.

If a released version is defective, publish a corrected version and deprecate the defective npm version. Do not rewrite an existing release tag. See [the release review](RELEASE_REVIEW_2026-09-29.md) for local evidence and remaining gates.
