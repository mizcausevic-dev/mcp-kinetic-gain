# Loopback MCP interception source pilot

Status: unreleased review candidate. The current npm and MCP Registry package is
`mcp-kinetic-gain@0.10.0`; it does not contain this source pilot. Do not use
this document as evidence of deployed enforcement.

## Surface and start contract

The `node dist/secure-http.js` CLI is a proposed GCE-only entry point. It
requires an external Cloud Storage withdrawal record at startup, including a
working VM metadata server. It cannot start as an ordinary local checkout.
Local synthetic tests instead use the programmatic `startSecurePilot` API with
an injected revocation reader. After `npm ci` and `npm run build`, the proposed
GCE host would use these environment variables:

| Variable | Required value |
| --- | --- |
| `MCP_SECURE_PORT` | Loopback port, default `3187`. The process always binds `127.0.0.1`. |
| `MCP_SECURE_ISSUER` | Exact ASCII identifier of the trusted test JWT issuer. |
| `MCP_SECURE_PUBLIC_KEY_FILE` | Absolute path to that issuer's Ed25519 SPKI PEM public key. |
| `MCP_SECURE_POLICY_FILE` | Absolute path to the operator-owned JSON allowlist and revocation file. |
| `AUDIT_STREAM_URL` | Exact `http://127.0.0.1:<port>` URL, without a trailing slash, of the scoped Audit Sink. |
| `AUDIT_STREAM_TOKEN` | Dedicated 32–256 character scoped producer token bound by the Sink to source `mcp-kinetic-gain`. Never use a reader token. |
| `MCP_BROKER_PYTHON` | Absolute path to the installed Python Broker interpreter. The host invokes `-I -m mcp_permission_broker.runtime_bridge`. |
| `MCP_BROKER_CONFIG_FILE` | Absolute path to the operator-owned, short-lived Broker snapshot. Python validates its signed card, buyer key, identity and tool mappings, condition facts, and revocations. |
| `MCP_REVOCATION_GCS_BUCKET` | Required bucket name for the external synthetic withdrawal record. |
| `MCP_REVOCATION_GCS_OBJECT` | Required object name, such as `revocations/current.json`. |

The MCP endpoint is `http://127.0.0.1:<MCP_SECURE_PORT>/mcp`. The test issuer
must sign an EdDSA JWT with only these claims: `iss`, exact single-string `aud`
equal to that endpoint, `sub`, `client_id`, `jti`, `scope` equal to `mcp:tools`,
integer `iat`, `nbf`, and `exp`. The maximum lifetime is 300 seconds. The JWT
header must be exactly `{"alg":"EdDSA","typ":"JWT"}`. The source pilot does
not provide a token issuer, authorization server, OAuth discovery, consent
flow, or refresh path. A real identity provider and resource binding must be
selected and verified before a hosted release.

The local policy file is JSON with this shape:

```json
{
  "version": 1,
  "valid_until": 0,
  "clients": {
    "example-client": {
      "subject": "example-subject",
      "allowed_tools": ["suite_doc_detect_spec"]
    }
  },
  "revoked_jtis": []
}
```

`valid_until` is an **illustrative expired number**, not a working timestamp;
set it to a current Unix second no more than 300 seconds ahead. The process
reloads the file for tool discovery and again before and after the mandatory
pre-dispatch receipt. Missing, malformed, expired, or overlong policy files
fail closed. Update this operator-owned file with an atomic rename and restrict
its operating-system ACL; the source pilot cannot enforce those external file
management practices. This is local revocation, not durable identity-provider
withdrawal. There is still a race between the last file read and handler start.

For the proposed GCP drill, the required CLI external source reads the exact Cloud
Storage object over Google's JSON API on each selected discovery/call. It gets
a downscoped read-only access token from the VM metadata server, accepts no
caller-supplied URL, follows no redirects, and sends no upstream MCP bearer to
Google. The runtime identity must have object read permission on only the
approved revocation bucket and no write permission. Configure
both GCS location variables for the `node dist/secure-http.js` entry point;
the CLI blocks startup if either is absent or the initial read fails.
The VM must have the Cloud Storage read-only OAuth access scope compatible
with the downscoped metadata request, plus object read IAM on the specific
bucket. A different VM scope configuration requires its own live preflight.
Tests can pass an in-memory reader to the programmatic pilot API. The record
has this schema:

```json
{
  "version": 1,
  "revision": 1,
  "valid_until": 0,
  "revoked_jtis": [],
  "revoked_subjects": [],
  "revoked_client_ids": [],
  "revoked_decision_ids": []
}
```

`valid_until` above is deliberately expired; a live record must expire within
120 seconds and be refreshed by a separately authorized writer. The reader
rejects missing, stale, malformed, oversized, or inaccessible records. It
checks once before the Broker and again after the accepted pre-dispatch audit
receipt; it also checks the Broker's signed card decision ID. A lower revision
than the startup record or one already seen by the process is denied. A
same-revision record with different withdrawal sets is also denied; refreshing
`valid_until` without changing those sets is allowed. Duplicate or escaped
JSON keys are rejected before parsing. Restoring older VM policy and
Broker files cannot clear a withdrawal held in the external object. This
depends on separate write custody and IAM, which have not been configured or
verified. The revocation writer must update this mutable object and is separate
from the checkpoint's append-only uploader. A compromised writer could roll
the object back; the in-process revision high-water mark is lost on VM rollback,
and a still-valid older record may be replayed for up to 120 seconds. This adapter does
not prove buyer authorization or instantaneous revocation during a running
handler.

## Enforced MCP path

All HTTP requests must have the exact loopback Host and no Origin. GET and
DELETE are 405 before MCP handling; the pilot accepts only POST `/mcp`, which
requires exactly one bearer Authorization header. The installed SDK v1 transport bounds a
POST body to 32 KiB even when it arrives in chunks. The server creates a new
stateless transport and `Server` for each request so verified identity is
request-scoped. `tools/list` exposes only `suite_doc_detect_spec` to a signed,
nonrevoked client mapped in the local policy whose current Broker decision is
allow. Unlisted tool calls and unexpected
top-level arguments are denied; a document passed as `body` cannot override
the signed or server-owned caller facts.

The host invokes a fresh Python Broker child over private stdio before each
selected call. It passes only verified subject, client ID, token ID and expiry,
plus the tool name. It never passes the bearer, document body, buyer, tenant,
vendor, or conditions. Python reloads its operator snapshot and verifies the
raw signed Decision Card before evaluating the request. Missing child, invalid
snapshot, non-allow decision, timeout, malformed response, or crash blocks the
handler. After the receipt, the host repeats the check and requires the same
snapshot digest. This source integration is not proof of a real buyer mandate
or current condition facts. At most four Broker child checks can run at once;
excess checks fail closed. This cap is not a per-client rate limiter.

Before invoking the selected pure handler, the host POSTs a provisional
`tool_invocation_allowed` event to the scoped Audit Sink. Its payload contains
only `correlation_id`, `tool_name`, signed `client_id`,
`gate_config_version: 1`, `decision_phase: "pre_dispatch"`, the Broker check correlation ID, the signed card's
decision ID, and the snapshot digest. It omits input content, token, subject,
and result. The host requires HTTP 201 and exact source, kind, and payload
equality plus a positive event ID and 64-character hash in the returned receipt. Missing,
invalid, redirected, slow, or oversized responses deny execution. The host
rechecks token expiry, the local policy, and the Broker decision after the
receipt.

After handler execution, the host attempts a linked
`tool_invocation_completed` or `tool_invocation_failed` event. It suppresses a
successful tool response if that write fails. Because the handler has already
run, a failed outcome write cannot undo it. Only one deterministic,
nonnetwork, nonmutating tool is available for this reason. An authenticated
denial attempts `tool_invocation_denied`; a Sink outage can leave that denial
unrecorded. Pre-auth HTTP rejections are not sent to the Sink. A required
pre-dispatch receipt can also remain unmatched if the external withdrawal
source and denial write fail after acceptance. An unmatched allowed event
means **unknown execution status**, never proof that the handler ran. Only a
linked completion event supports an execution claim. Reconcile unmatched
receipts and drill the outage path before treating this as a complete ledger.

The Sink's 201 response is evidence that the configured Sink accepted an event
through this local connection. It is not proof of independent checkpoint
custody, complete producer coverage, or production durability. The Sink must
run in scoped SQLite mode with the dedicated source-bound producer token;
legacy shared-token mode is outside this pilot's tested contract.

## Release limits and rollback

The published stdio command remains an ungated 75-tool local preview. This
source HTTP process calls the Python Broker for a signed-card decision, but its
operator snapshot alone cannot establish a real issuer, buyer mandate, tenant
membership, vendor binding, or observed condition facts. Without the opt-in
external source, an older still-valid snapshot can restore an approval after
restart. The GCP adapter is locally tested with synthetic records; no hosted
read, IAM separation, outage, or rollback was verified. There is also a small
race between the last external read and the handler start. Do not claim immediate
or buyer-governed revocation from this path. Do not proxy it to a public endpoint or
claim a governed 75-tool runtime. A later private pilot
needs an exclusive route, independently verified issuer and fact provenance,
durable revocation, complete outcomes, independent audit checkpoint custody,
and hosted outage, restore, and rollback drills. The separate Broker package
must be installed in the exact Python environment; npm does not bundle it.
The review CI pins the Broker source commit and installs its Python 3.11 host
dependencies from `docs/broker-host-requirements.lock` with package hashes.
The Broker wheel is then built from that pinned source without resolving new
dependencies. The lock was installed and checked in a disposable Windows
Python 3.11 environment, and the prior review head's Node 20/22 Linux CI
passed. Final-head CI must pass again after this fix. A local Linux Docker
image archive has been built and smoke tested without network access, but its
final source hash and a hosted artifact remain to be verified. A
private release still needs package integrity and provenance evidence for the
actual deployed bytes.

To roll back this unshipped source pilot, stop `node dist/secure-http.js` and
revert its review branch. It has no production state or public package to
roll back. If a future release publishes this code, use a new package version
and tag after reviewed CI; do not reuse `0.10.0`.
