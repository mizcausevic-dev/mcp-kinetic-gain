# Changelog

All notable changes to this project are documented here.

## [0.5.1] - 2026-05-13

### Added
- **CLI mode.** The same binary now doubles as a Suite JSON validator outside any MCP host: `mcp-kinetic-gain validate <paths...>` (also `--help`, `--version`). Auto-detects which of the ten Suite specs each input belongs to via its top-level version field and validates against the bundled zod schemas. GitHub-Actions-aware output (`::error::` annotations when `GITHUB_ACTIONS=true`). Exit codes: `0` pass, `1` fail, `2` no recognized spec, `3` usage error.
- `fast-glob` runtime dependency for glob expansion in the CLI.
- 12 new tests covering CLI dispatch (`--help`, `--version`, unknown flags, fallthrough to MCP) and `validate` behavior (pass, fail, parse error, unrecognized, mixed batches). Total test count: 86.

### Fixed
- Entry-point detection was broken on Windows. The previous `import.meta.url === \`file://\${argv[1]}\`` comparison failed because Node emits `file:///C:/...` (three slashes) for absolute Windows paths, but the constructed string had two. Replaced with `pathToFileURL(argv[1]).href === import.meta.url`, which is robust on both Windows and Unix.
- `fast-glob` patterns on Windows now normalize backslashes to forward slashes defensively (backslashes are glob escape characters in fast-glob's pattern dialect).

### Unchanged
- All 43 MCP tools and their behavior, the schemas, the well-known URLs, the cross-spec tools (`aup_check_compliance`, `incident_index_fetch`). Running `mcp-kinetic-gain` with no arguments still launches the stdio MCP server — existing Claude Desktop / Cursor configs continue to work.

### Published via
- First release through the new tag-driven GitHub Actions auto-publish workflow (`.github/workflows/publish.yml`) — `git tag v0.5.1 && git push --tags` triggered the build → test → publish pipeline. npm provenance attestation included.

## [0.5.0] - 2026-05-13

### Published
- First publish to the npm registry as **unscoped `mcp-kinetic-gain`**. Install with `npm i -g mcp-kinetic-gain` or run with `npx -y mcp-kinetic-gain`.
- 43 tools across all ten Kinetic Gain Protocol Suite specs: AEO Protocol, Prompt Provenance, Agent Cards, AI Evidence Format, MCP Tool Cards, AI Tutor Cards, Student AI Disclosure, Classroom AI AUP, Clinical AI Disclosure, and AI Incident Card.
- Headline cross-spec tools: `aup_check_compliance` (joins a Classroom AI AUP and a Student AI Disclosure into a machine-readable allow/deny call) and `incident_index_fetch` (aggregates a vendor's public `/.well-known/ai-incidents.json` registry).
- 74-test suite covering every tool's happy path plus error paths, including a live local-HTTP synthetic-index test for `incident_index_fetch`.

### License clarification
- The server (this repo): **AGPL-3.0**. Reference implementation. Commercial SaaS hosts must share modifications back.
- The Suite specs themselves: **MIT**. Maximally permissive. The split is deliberate.

## [1.0.0] - 2026-05-12

### Released
- Shipped **mcp-kinetic-gain** as a public artifact for teams dealing with mcp governance.
- Packaged the current implementation, documentation, validation flow, and proof surfaces into a repo that can be reviewed by technical and operating stakeholders.
- Clarified the core problem the project is addressing: tool-surface drift, weak schema review, and fragile governance around agent-connected systems.

### Why this mattered
- Existing approaches in traditional AppSec tools, cloud posture products, and generic observability stacks were useful for parts of the workflow.
- They still left out an operator-visible layer that could explain tool exposure, control posture, and prompt-driven risk in one place.
- This release made the repo read like an operational capability rather than a narrow technical demo.

## [0.1.0] - 2026-03-17

### Shipped
- Cut the first coherent internal version of **mcp-kinetic-gain** with stable domain objects, review surfaces, and decision outputs.
- Established the first reviewable version of the architecture described as: Unified MCP server exposing all 5 Kinetic Gain Protocol Suite specs as tools (18 total across AEO, Prompt Provenance, Agent Cards, AI Evidence, MCP Tool Cards). One Claude Desktop config entry. Companion to kinetic-gain-visualizer.
- Focused the repo around actionability instead of passive reporting.

## [Prototype] - 2025-02-08

### Built
- Built the first runnable prototype for the repo's main workflow and decision model.
- Validated the concept against pressure points such as MCP governance gaps, prompt injection, destructive tool exposure, and weak evidence chains.
- Used the prototype phase to test whether the project could drive action, not just present information.

## [Design Phase] - 2022-11-06

### Designed
- Defined the system around operator-first and decision-legible outputs.
- Chose interfaces and examples that made sense for platform engineering, AI governance, and security teams.
- Avoided reducing the project to a generic dashboard, CRUD app, or fashionable wrapper around the stack.

## [Idea Origin] - 2022-03-06

### Observed
- The original idea surfaced while looking at how teams were handling tool-surface drift, weak schema review, and fragile governance around agent-connected systems.
- The recurring pattern was that teams had data and tools, but still lacked a usable operating layer for the hardest decisions.

## [Background Signals] - 2022-08-09

### Context
- Earlier platform, governance, and operator-tooling work made one pattern hard to ignore: the systems that create the most drag are often the ones with partial controls and weak operational coherence, not the ones with no controls at all.
- That pattern shaped the thinking behind this repo well before the public version existed.