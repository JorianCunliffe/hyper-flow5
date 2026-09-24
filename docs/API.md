# HyperFlow API reference

Phase 01: direct task/email requests require a project in the authenticated organization. GET/POST `/api/communications/email-policy` reads/saves the organization email authority; writes require owner/admin and `{mode, version}` from the last read. Modes: draft_only (default), allow_send. Returns `{mode, configuredMode, version}`; 409 means reload before saving. Communications owns persistence and independently enforces policy. See [boundaries](architecture/BOUNDARIES.md) and [API fragment](../contracts/phase01.openapi.json).

This reference describes the HTTP handlers under `api/`, their local Express equivalents, and the Communications Service requests emitted by the current HyperFlow client.

## Phase 04 obligations API

`/api/commitments` requires the normal Firebase bearer token and selected organization membership on Express and Vercel. Organization and actor come from authentication, never a body override. See [state and authority contract](architecture/COMMITMENTS.md).

| Method | Inputs | Result |
|---|---|---|
| GET | Optional `id` | `{item,viewerUid}` for one scoped obligation. |
| GET | `view=all\|owing\|owed`, optional `projectId`, `party`, `after` | `{data,next,viewerUid}`. Party is `user:<uid>` or `contact:<canonicalId>`; owing/owed use the authenticated member. Pages contain at most 50 underlying records before filtering. Follow `next` even on an empty filtered page. |
| GET | `view=parties` | Current member and available canonical contact choices. |
| GET | `view=candidates&projectId=...`, optional `threadId` | `{data,bounded:true}` with stable source IDs, versions and current permitted excerpts. Project discovery shows open extracted promises; thread lookup also covers historical evidence. |
| POST | `{projectId,terms}` | New manual candidate. This operation is not retry-idempotent; inspect before repeating an uncertain request. |
| POST | `{projectId,sourceId,threadId?}` | Import/refresh source candidate. Server re-fetches evidence; repeated source/version is idempotent. Caller cannot supply trusted source content or status. |
| PATCH | `{id,projectId?,expectedVersion,action,...}` | Updated `{item,viewerUid}` after an atomic transition. |

`terms` has `owner`, `beneficiary`, `deliverable`, `criteria`, `dueAt` (ISO instant with explicit offset) and `timezone` (recognized timezone). Missing/invalid fields keep a candidate in clarification. Contact/member references are checked against the organization.

PATCH actions: `terms` includes `terms` and, for renegotiation, `note`; `respond` includes current `askId`, `note`, and `decision=approved|revise|rejected` for an approval Ask, or complete `terms` without a decision for clarification. `progress`, `submit`, `dispute`, `cancel`, and `dismiss` require a note. `follow_up` includes boolean `enabled` and numeric `leadHours` from 0–720. Follow-up is saved for web review, with no automatic delivery. Do not send edited terms alongside an approval: save them first.

Every item includes aggregate `version`, lifecycle, current review and decision history, and derived `timing.overdue/atRisk`. Ask capability tokens and cached raw source wording are omitted. Retrieve current raw evidence through `/api/communications/memory`. Accepted terms/history persist as operational records if the source later changes. Unaccepted source-derived candidates are suppressed or return 409 when source access/version is no longer current.

Errors: 400 invalid input; 403 inaccessible project/party or unauthorized decision; 404 absent scoped record/source; 409 stale aggregate/current Ask/source or invalid lifecycle transition; 405 unsupported method. Source outages fail closed. The API does not release workflow runs or send communications.

## General conventions

- Request and response bodies are JSON unless stated otherwise.
- HyperFlow request fields use camelCase; the Communications boundary uses snake_case.
- Errors use `{ "error": "message" }`. Task execution errors may also include `status` and `logs`.
- Browser-authenticated endpoints use `Authorization: Bearer <Firebase ID token>`.
- When a request identifies an organization, HyperFlow verifies membership from `organizations/{orgId}/members/{uid}` rather than trusting the supplied ID.

## Authentication

| Endpoint | Authentication |
|---|---|
| `POST /api/organizations/create` | Firebase ID token. |
| `POST /api/invites/create` | Firebase ID token; current member must be an owner or admin. |
| `POST /api/invites/consume` | Firebase ID token; authenticated email must match the invite. |
| `POST /api/tasks/execute` | Firebase ID token and organization membership. |
| `POST /api/flow/advance` | Either Firebase ID token and organization membership, or `x-webhook-secret: $WEBHOOK_SECRET`. |
| `GET|POST /forms/ask/{token}` | Ask capability token in the path; optional Firebase token verifies reviewer identity. |
| `GET|POST /api/asks/{token}` | Same handler and authentication as the public form path. |
| `POST /api/events` | Timestamped V2 signature headers in production using `COMMUNICATIONS_WEBHOOK_SECRET`; legacy HMAC remains available only for controlled non-production/migration compatibility. |
| `POST /api/agent/voice-context` | Timestamped V2 Communications signature using `COMMUNICATIONS_WEBHOOK_SECRET`; no browser authentication. |
| `POST /api/send-email` | Firebase ID token and organization membership. |
| `GET /api/communications/status` | Firebase ID token and organization membership. |
| `/api/integrations/*`, `/api/coaching/sessions` | Firebase ID token and organization membership; OAuth callback validates signed, single-use state. |
| `/api/operations`, `/api/operations/agent-jobs/replay` | Firebase ID token and organization membership. |
| `GET|PATCH /api/triage` | Firebase ID token and organization membership. |
| `GET|POST|PATCH|DELETE /api/schedules` | Firebase ID token and organization membership. |
| `POST /api/schedules/run` | Firebase ID token and organization membership. |
| `GET|POST /api/schedules/tick` | `Authorization: Bearer $CRON_SECRET`, `x-hyperflow-scheduler-secret: $SCHEDULER_SECRET`, or for an empty `POST` the current timestamped Communications V2 HMAC headers. |
| `POST /api/gemini/*` | Firebase ID token and organization membership. |

Common authentication responses are `401` for a missing, invalid, or expired Firebase token; `403` for missing organization membership or insufficient role; and `503` when server-side Firebase authentication is not configured.

## Endpoint index

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/organizations/create` | Create an organization and owner membership. |
| `POST` | `/api/invites/create` | Create a one-use organization invite. |
| `POST` | `/api/invites/consume` | Join the invited organization. |
| `POST` | `/api/tasks/execute` | Execute one action. |
| `POST` | `/api/flow/advance` | Advance one persisted project. |
| `GET`, `POST` | `/forms/ask/{token}` | Render/read or answer one Ask. |
| `GET`, `POST` | `/api/asks/{token}` | Direct Ask handler behind the form rewrite. |
| `POST` | `/api/events` | Receive signed Communications events. |
| `POST` | `/api/agent/voice-context` | Select an authorized project and return bounded live-call context. |
| `POST` | `/api/send-email` | Submit a tenant-correlated email to Communications. |
| `GET` | `/api/communications/status` | Check Communications connectivity and tenant identity selection. |
| `GET`, `PATCH` | `/api/integrations` | List non-secret connection health and read/update the tenant agent profile. |
| `POST`, `GET` | `/api/integrations/google/start`, `/api/integrations/google/callback` | Start/complete protected Google Workspace OAuth. |
| `GET`, `PUT` | `/api/integrations/google/resources`, `/api/integrations/google/grant` | List Google files and save a project resource allowlist. |
| `GET` | `/api/integrations/google/document`, `/api/integrations/google/sheet` | Read the project-allowlisted Doc or Sheet. |
| `POST` | `/api/integrations/mailbox/start`, `/api/integrations/mailbox/sync` | Start Gmail/Outlook OAuth through Communications or reconcile the selected mailbox. |
| `GET`, `POST`, `PUT` | `/api/service-projects/setup-draft` | Resume or save a tenant-and-user-scoped setup draft that expires after 24 hours. |
| `POST` | `/api/service-projects/validate` | Authoritatively validate the selected mailbox or coaching resources before project creation. |
| `GET` | `/api/service-projects/status` | Aggregate project readiness, connections/resources, schedule, last run/digest, and scheduler health. |
| `GET` | `/api/coaching/sessions` | List tenant/project coaching session projections. |
| `GET`, `POST` | `/api/operations`, `/api/operations/agent-jobs/replay` | Inspect tenant operations and replay a failed/review-held agent job. |
| `GET`, `PATCH` | `/api/triage` | List and review tenant communications triage. |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/schedules` | Manage tenant communications-reconciliation schedules. |
| `POST` | `/api/schedules/run` | Run one tenant schedule immediately. |
| `GET`, `POST` | `/api/schedules/tick` | Run due schedules from a platform timer. |
| `POST` | `/api/gemini/brainstormSubtasks` | Generate five subtask suggestions. |
| `POST` | `/api/gemini/generateProjectStructure` | Generate a milestone graph. |
| `GET`, `POST` | `/api/files` | Managed file storage. See [managed files](MANAGED_FILES.md). |
| `GET`, `POST` | `/api/publishing` | Versioned publishing reviews. See [publishing](PUBLISHING_API.md). |
| `GET`, `POST` | `/api/artifacts` | Generated artifact records. See [artifacts](ARTIFACT_API.md). |
| `GET`, `POST` | `/api/calendar` | Calendar reads and scheduling. |
| `GET`, `POST` | `/api/meetings` | Meeting records and participant audit. |
| `GET`, `POST` | `/api/cockpit` | Aggregated tenant cockpit snapshot and configuration. |
| `GET`, `PUT` | `/api/workspace` | Workspace snapshot; see [Phase 11](#phase-11-account-and-workspace-apis). |
| `GET`, `POST` | `/api/tenant` | Account controls; see [Phase 11](#phase-11-account-and-workspace-apis). |
| `GET`, `POST` | `/api/flows` | Bounded flow pages and flow creation; see [Phase 11](#phase-11-account-and-workspace-apis). |
| `GET`, `POST`, `PATCH` | `/api/commitments` | Obligations; see [Phase 04](#phase-04-obligations-api). |
| `GET`, `POST`, `PATCH` | `/api/thread-register`, `/api/thread-register/*` | Canonical threads; see [Phase 02](#phase-02-canonical-thread-register). |
| `GET`, `POST` | `/api/communications/email-policy` | Read or save the organization email authority. |
| `POST` | `/api/communications/memory` | Read current raw communication evidence for a bounded context request. |

Every path above is a real route. Public paths are rewritten in [`vercel.json`](../vercel.json) onto a small number of serverless functions so the Vercel Hobby deployment stays under its function limit; the rewrite target is an implementation detail and is not part of the contract.

## Organizations and invites

### Create an organization

```http
POST /api/organizations/create
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

```json
{
  "name": "Acme Projects"
}
```

The trimmed name must contain 1-120 characters. The account must not already belong to an organization.

Success: `201`

```json
{
  "ok": true,
  "orgId": "org_..."
}
```

HyperFlow creates the organization, an owner membership, and the private user-to-organization record on the server.

### Create an invite

```http
POST /api/invites/create
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

```json
{
  "email": "person@example.com"
}
```

The caller must be an owner or admin. Success returns `201` with a one-use token:

```json
{
  "ok": true,
  "token": "invite_..."
}
```

### Consume an invite

```http
POST /api/invites/consume
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

```json
{
  "token": "invite_..."
}
```

The Firebase account email must match the invited email. Invites expire after seven days and cannot move an existing member to a different organization. An identical retry by the member who consumed the invite is safe.

Success: `200`

```json
{
  "ok": true,
  "orgId": "org_..."
}
```

Invalid, expired, already-used, mismatched-email, and missing-token requests return `400`.

## Execute an action

### `POST /api/tasks/execute`

```http
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

```json
{
  "taskType": "send_sms",
  "templateFile": "{\"to\":\"+61400000000\",\"body\":\"Project {{project_name}} is ready.\"}",
  "projectData": {
    "project_name": "North Site"
  },
  "correlation": {
    "orgId": "org_1",
    "projectId": "project_1",
    "nodeId": "SMS_1",
    "runId": "run_1"
  },
  "revision": {
    "feedback": "Use a shorter executive summary.",
    "priorOutput": {},
    "count": 1
  }
}
```

The server replaces `correlation.orgId` with the authenticated member's organization. SMS and voice actions require all four correlation values so a later event can resolve one exact run.

Canonical task types:

| `taskType` | Template JSON | Behavior |
|---|---|---|
| `send_email` | `{ "to", "cc?", "bcc?", "subject", "body", "from?", "service_identity_id?", "provider_connection_id?" }` | Submits an idempotent tenant-correlated email to Communications. |
| `send_sms` | `{ "to", "from?", "body" }` | Starts an SMS through Communications. |
| `outgoing_call` | `{ "to", "from?", "instruction" }` | Starts a call; `prompt` or `body` may supply the instruction. |
| `webhook` | `{ "url", "method?", "headers?", "payload?" }` | Calls a public HTTPS/443 endpoint. |
| `write_report` | `{ "prompt", "sop?", "template?", "eval_criteria?" }` | Generates, evaluates, and when required revises a report with Gemini. |
| `read_google_doc` | `{}` | Reads the Doc allowlisted for the authenticated tenant/project and returns bounded text plus revision metadata. |
| `read_google_sheet` | `{}` | Reads up to 500 rows and 50 columns from the allowlisted Sheet range. |
| `append_google_sheet` | `{ "idempotency_key", "values" }` | Appends 1-100 rows to the allowlisted Sheet range under an external-action receipt. Values use Google `RAW` input so imported/model text cannot become a formula. |
| `upsert_google_sheet` | `{ "idempotency_key", "key_column", "key_value", "values" }` | Updates the unique matching row or appends one row inside the allowlisted A1 range. `key_column` is zero-based and values use Google `RAW` input. |
| `extract_coaching_result` | `{ "minimum_confidence?", "instruction?" }` | Extracts an evidence-bounded typed coaching result from a verified human call; low confidence raises review. |

Friendly aliases such as `email`, `sms`, `call`, `voice`, `http`, and `report` are normalized to the canonical types.

Google task actions ignore arbitrary file IDs in the template: the authenticated tenant/project resource grant is authoritative. Sheet append accepts at most 50 columns per row. Sheet upsert requires an A1 range such as `Coaching!A2:G`, rejects duplicate matching keys, and requires the row value at `key_column` to equal `key_value`. Both actions reuse a completed receipt for an identical idempotency key/content pair; changing content under the same key fails closed.

SMS and call destination numbers fall back to `projectData.contact_phone` or `projectData.phone_number`. Destination and sender numbers must use E.164 format. Sender precedence is action template, `projectData.communications_from_number`, tenant Settings, then `COMMUNICATIONS_FROM_NUMBER`.

Webhook methods are `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, and `DELETE`. Destinations must be public HTTPS on port 443. HyperFlow validates DNS and every redirect, blocks local/private/reserved destinations, allows at most three redirects, times out after 15 seconds, and reads at most 64 KiB. `WEBHOOK_ALLOWED_HOSTS` can further restrict hostnames.

Synchronous success: `200`

```json
{
  "status": "success",
  "output": {
    "report_written": true,
    "report_content": "...",
    "evaluation": {}
  },
  "logs": ["..."]
}
```

Accepted SMS or voice work: `202`

```json
{
  "status": "success",
  "pending": true,
  "externalId": "comm_123",
  "externalExecutionId": "comm_123",
  "externalService": "communications",
  "startedAt": 1786400000000,
  "output": {
    "communication_id": "comm_123",
    "communication_status": "accepted"
  },
  "logs": ["Communication comm_123 accepted with status accepted"]
}
```

A voice action's `output` additionally carries `conversation_context` describing the cross-channel history offered to that call; see [outbound conversation context](#outbound-conversation-context).

An accepted SMS or voice action remains waiting until a mapped terminal event arrives. A `send_email` action is different: it returns `200` when Communications accepts the email, and later provider delivery/failure and reply events do not reopen that completed action. A Communications response explicitly marked `failed` returns `502`; validation, configuration, provider HTTP, timeout, and other execution failures currently return `500`. Unknown task types return `400`.

| Status | Meaning |
|---|---|
| `200` | Action completed synchronously, including an email accepted by Communications. |
| `202` | SMS or voice communication accepted and the action is waiting for a terminal event. |
| `400` | Unknown task type or invalid request understood by the task handler. |
| `500` | Execution or configuration failure. |
| `502` | A successful Communications HTTP response explicitly contained normalized status `failed`. Communications HTTP errors currently pass through the task catch path as `500`. |

## Receive external events

### `POST /api/events`

Headers:

```http
Content-Type: application/json
X-Communications-Event-Id: evt_...
X-Communications-Signature: sha256=<HMAC-SHA256 of the exact raw JSON body>
```

The HMAC key is `COMMUNICATIONS_WEBHOOK_SECRET`. Communications only emits a signature when that secret is configured, while HyperFlow requires it; therefore the secret must be enabled in both deployments. The preferred V2 headers are:

```http
X-Communications-Timestamp: 1788070000
X-Communications-Signature-V2: sha256=<HMAC-SHA256 of "1788070000.<exact raw JSON body>">
```

HyperFlow requires the complete V2 pair when either V2 header is present, accepts only ten-digit Unix seconds within a five-minute clock-skew window, and verifies the exact raw bytes before parsing JSON. The legacy raw-body signature remains accepted for compatibility when no V2 header is present. The complete event is persisted before it is applied. `event_id` in the body is the durable idempotency key. `X-Communications-Event-Id` is observability metadata; the body remains authoritative.

### Canonical inbound communication event

`communication.received` is the canonical event for an ordinary inbound email or SMS. `sms.received` is accepted as a legacy alias. These events create or update tenant-scoped triage evidence; they do not resolve a Human Ask, complete a waiting task run, or merge reply text into Project Data.

```json
{
  "contract_version": "2.0",
  "tenant_id": "org_1",
  "event_id": "evt_inbound_123",
  "communication_id": "comm_inbound_123",
  "type": "communication.received",
  "occurred_at": "2026-08-30T03:57:42.294Z",
  "correlation": {
    "tenant_id": "org_1",
    "external_project_id": "project_1",
    "run_id": "run_1",
    "task_id": "SMS_1"
  },
  "payload": {
    "channel": "sms",
    "content": "SMS TEST OK",
    "memory_eligible": true,
    "thread_id": "thread_123"
  }
}
```

For email, HyperFlow retrieves the authoritative tenant-scoped communication before projecting the triage item. For SMS and voice, response text is taken from the signed canonical payload. Eligible generic messages are queued idempotently for the tenant agent after the triage projection. If tenant triage policy is `correlated_only`, an inbound event with neither an Ask nor project link is acknowledged and ignored before agent routing. Eligible text may be enriched asynchronously into Communications Service memory; HyperFlow's triage `memoryEligible` field records eligibility, not enrichment completion.

### Ask response event

An `ask.response.received` event carrying an explicit `ask_id` is routed to the canonical ask response service. It does not enter the task-run resolver.

```json
{
  "contract_version": "2.0",
  "tenant_id": "org_1",
  "event_id": "evt_ask_123",
  "type": "ask.response.received",
  "occurred_at": "2026-08-11T02:30:00.000Z",
  "communication_id": "comm_123",
  "purpose": {
    "type": "human_ask",
    "ask_id": "ask_123"
  },
  "correlation": {
    "tenant_id": "org_1",
    "external_project_id": "project_1",
    "person_id": "person_1"
  },
  "payload": {
    "ask_id": "ask_123",
    "channel": "voice",
    "transcript": { "segments": [{ "role": "user", "text": "Approved" }] },
    "disposition": "human_completed",
    "successful": true,
    "memory_eligible": true
  }
}
```

SMS response text is read from `payload.content`; voice response text is read from `payload.transcript`. Structured transcript objects are retained in the event evidence and do not bypass the existing `needsInterpretation` safeguard. A voice event explicitly marked unsuccessful, memory-ineligible, or with a disposition other than `human_completed` is acknowledged and ignored; it cannot enter the canonical Ask response path. HyperFlow applies an accepted answer, advances the flow, attempts any newly raised Ask deliveries, and persists the resulting project state before calling `POST /v1/asks/{ask_id}/resolve` with its `communication_id`. If that acknowledgement fails, the inbox event becomes `processing_failed` and a retry can reclaim it. On replay, `respondToAsk` returns the already-recorded local response only when its `communicationId` matches the event.

Communications currently returns a generic `409` for an already-resolved Ask without returning the existing resolver identity. The client treats that as idempotent only on the locally matched replay path described above; this is not independent proof that Communications used the same communication ID.

HyperFlow also retains compatibility with adapters that supply `response.structured`; for question asks those values are keyed by the ask field names. The current Communications Service SMS/voice events supply text or transcript rather than this structure:

```json
{
  "response": {
    "text": "The site is 12 Main Street.",
    "structured": {
      "site_address": "12 Main Street"
    }
  }
}
```

### Terminal communication event

Only `call.completed` and `sms.delivered` are successful terminal events. `call.failed` and `sms.failed` map to failure. A contradictory `call.completed` payload that explicitly has `successful: false`, `memory_eligible: false`, or a non-`human_completed` disposition also fails closed. Every other current or future event defaults to non-terminal, apart from defensive normalization of a legacy `sms.sent` payload whose status is already terminal. Terminal events require `tenant_id`, `external_project_id` (or the transitional `project_id` alias), `run_id`, and `task_id`; `communication_id` adds an additional exact-run match when present.

```json
{
  "event_id": "evt_call_123",
  "source": "communications",
  "type": "call.completed",
  "occurred_at": "2026-08-11T02:35:00.000Z",
  "communication_id": "comm_123",
  "correlation": {
    "tenant_id": "org_1",
    "project_id": "project_1",
    "task_id": "CALL_1",
    "run_id": "run_1"
  },
  "payload": {
    "provider_status": "completed",
    "disposition": "human_completed",
    "successful": true,
    "memory_eligible": true,
    "failure_code": null,
    "failure_reason": null,
    "outcome_source": "transcript_model",
    "outcome_confidence": 0.98
  }
}
```

A failed call uses the same correlation and a `call.failed` type, for example:

```json
{
  "event_id": "evt_call_124",
  "source": "communications",
  "type": "call.failed",
  "communication_id": "comm_124",
  "correlation": {
    "tenant_id": "org_1",
    "project_id": "project_1",
    "task_id": "CALL_1",
    "run_id": "run_1"
  },
  "payload": {
    "provider_status": "completed",
    "disposition": "voicemail",
    "successful": false,
    "memory_eligible": false,
    "failure_code": "voicemail",
    "failure_reason": "Twilio detected an answering machine"
  }
}
```

The complete payload is retained on `lastRun.output`, while normalized fields are also stored on `lastRun.communicationOutcome`. Failed output is never merged into Project Data and therefore cannot unlock a downstream decision.

Successful application:

```json
{
  "ok": true,
  "log": ["..."],
  "pending": []
}
```

Duplicate event:

```json
{
  "ok": true,
  "duplicate": true
}
```

Status codes:

| Status | Meaning |
|---|---|
| `200` | Event accepted, ignored, duplicated, or processed with `ok: true`. Inspect `ignored` and `reason`. |
| `400` | Invalid JSON or envelope, such as a missing `event_id` or `type`. |
| `401` | HMAC signature is missing or incorrect. |
| `405` | Method is not `POST`. |
| `422` | The signed event was understood but could not be applied and was not marked retryable, such as incomplete terminal correlation. |
| `500` | Unexpected handler failure. |
| `503` | Webhook HMAC secret or server-side Firebase persistence is not configured, or an otherwise valid event reached a retryable application failure. Communications should retry the same `event_id`. |

Unsupported sources and non-terminal task events return `200` with `ignored: true`. Canonical inbound communication events also return `200` after triage projection. In particular, a normal `sms.sent` event is non-terminal: an SMS action remains waiting until `sms.delivered` or `sms.failed`. There is currently no HyperFlow delivery timeout, so a missing terminal carrier event leaves the action waiting.

The local Express compatibility handler returns `409` for a retryable application result and `200` for a non-retryable one. The deployed Vercel handler uses `503` and `422` respectively. Durable senders must retry `409` or `503` with the same `event_id`.

## Advance a flow

### `POST /api/flow/advance`

Browser call:

```http
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

Machine call:

```http
x-webhook-secret: <WEBHOOK_SECRET>
Content-Type: application/json
```

Body:

```json
{
  "orgId": "org_1",
  "projectId": "project_1"
}
```

Success returns `200` with the server advancement outcome. Missing IDs return `400`; a missing project returns `404`; advancement failure returns `500`; and unavailable server persistence returns `503`.

If `WEBHOOK_SECRET` is unset or the supplied shared secret does not match, the request must pass Firebase membership authentication instead.

## Read or answer an Ask

### `GET /forms/ask/{token}?org={orgId}&project={projectId}`

Vercel rewrites `/forms/ask/{token}` to `/api/asks/{token}`. The token is a capability scoped to one Ask; `org` and `project` are routing values and are not authorization by themselves.

Requests whose `Accept` header contains `text/html` receive a rendered, CSP-restricted form with `Cache-Control: no-store`. Other clients receive `200` JSON:

```json
{
  "projectName": "North Site",
  "nodeName": "Draft report",
  "ask": {
    "id": "ask_123",
    "kind": "approval",
    "status": "open",
    "prompt": "Review the report.",
    "fields": [],
    "artifact": {
      "kind": "markdown",
      "title": "Draft report",
      "content": "# Draft"
    },
    "createdAt": 1786400000000,
    "dueAt": 1786486400000,
    "responses": []
  }
}
```

The JSON response excludes Project Data and raw provider payloads. Missing routing values return `400`; an unknown token/project combination returns `404`; and unavailable server persistence returns `503`.

### `POST /forms/ask/{token}?org={orgId}&project={projectId}`

```json
{
  "decision": "approved",
  "text": "Looks good.",
  "values": {},
  "uploads": [
    {
      "field": "supporting_file",
      "name": "evidence.pdf",
      "mime": "application/pdf",
      "base64": "JVBERi0xLjQ..."
    }
  ]
}
```

`decision` may be `approved`, `rejected`, or `revise`; the accepted fields depend on the Ask kind. A revision requires a comment. `text` is limited to 20,000 characters. Uploads are accepted only for file fields declared by that Ask, with at most three files and 2 MB per file. Allowed types are PDF, plain text, CSV, PNG, JPEG, WebP, DOCX, and XLSX. Caller-supplied `attachments`, URLs, storage paths, and actor identities are ignored.

When a valid Firebase token is supplied, HyperFlow derives a verified reviewer identity from the authenticated member. Without it, a delivery-specific capability token identifies the assigned recipient. The rendered form escapes artifact content, permits only safe HTTPS artifact links, and uploads through Firebase Admin to an Ask-scoped private object path.

Success: `200`

```json
{
  "ok": true,
  "askStatus": "answered",
  "log": ["..."],
  "needsInterpretation": false
}
```

Invalid responses return `400`, an invalid optional Firebase token returns `401`, missing authenticated membership returns `403`, unknown routing returns `404`, an already answered Ask returns `409`, and an overlong comment returns `413`.

## Send an email

### `POST /api/send-email`

```http
Authorization: Bearer <Firebase ID token>
Content-Type: application/json
```

```json
{
  "to": "person@example.com",
  "subject": "Project update",
  "html": "<p>The report is ready.</p>",
  "projectId": "project_1",
  "taskId": "EMAIL_1",
  "runId": "run_1"
}
```

The tenant must have `settings.communications.defaultEmailIdentity`; `connectionId` is passed when configured. Success returns `202` with `{ "communication": { ... } }`. The request is idempotent for the same tenant/project/task/run correlation. Configuration, validation, and Communications errors return an error response.

This endpoint, the `send_email` action, organization invitations, and email Human Asks all use Communications. A reply to an ordinary workflow email arrives as `communication.received` and becomes triage evidence. An email sent with `purpose.type: human_ask` may also produce `ask.response.received`; only that Ask-specific event can enter `respondToAsk` and progress the workflow. Email Ask messages include the secure form as a fallback.

## Communications triage

### `GET /api/communications/status`

Returns `connected`, `emailReady`, the selected non-secret connection and email identity IDs, or a sanitized connectivity error. `emailReady` means a tenant outbound identity is selected; it does not expose or validate provider credentials. The endpoint never returns API keys or provider credentials.

## Agent and connection APIs

The following public paths are rewrites into the consolidated Communications status handler so the Vercel Hobby deployment stays under its function limit. Every browser route below requires Firebase membership except the signed Google callback.

- `GET /api/integrations` returns the tenant agent profile, safe Communications person references, and non-secret mailbox/Workspace connection references. `PATCH` with `{ "agent": { ... } }` updates display name, timezone, stable primary Communications person, tenant-wide allowed/default projects, `personProjectAccess` grants, service identities, clarification policy, and action policy. Inbound people fail closed until a primary person or explicit grant exists; when person grants exist, an unlisted person is denied.
- `POST /api/integrations/mailbox/start` accepts `provider: "gmail" | "outlook"`, an optional expiring `setupDraftId`, and an allowlisted HyperFlow `returnTo`. Communications owns OAuth credentials; HyperFlow stores only the returned opaque connection reference. `POST /api/integrations/mailbox/sync?connectionId=...` runs authoritative provider-cursor reconciliation.
- `POST /api/integrations/google/start` starts HyperFlow-owned Google Workspace OAuth. `GET /api/integrations/google/callback` verifies a ten-minute, single-use state bound to tenant and user, exchanges the code, and stores encrypted credentials.
- `GET /api/integrations/google/resources?connectionId=...&kind=document|spreadsheet` lists selectable Drive metadata.
- `GET|PUT /api/integrations/google/grant?projectId=...` reads or writes the project's allowlisted connection, Doc ID, Sheet ID, and Sheet range.
- `GET /api/integrations/google/document?projectId=...` and `/api/integrations/google/sheet?projectId=...` read only the allowlisted resource.
- `GET /api/coaching/sessions?projectId=...&limit=50` lists coaching projections for that tenant/project.

### `POST /api/agent/voice-context`

Communications calls this before exposing project context during an inbound voice session and again through its `select_hyperflow_project` tool when the caller selects or switches projects. The exact JSON bytes must carry `X-Communications-Timestamp` and `X-Communications-Signature-V2` just like `/api/events`:

```json
{
  "request_id": "voice_ctx_...",
  "tenant_id": "tenant_1",
  "person_id": "communications-person-uuid",
  "thread_id": "thread_...",
  "communication_id": "comm_...",
  "service_identity": "+61411111111",
  "utterance": "Daily Coaching"
}
```

The tenant, person, thread, communication, and service identity are resolved by Communications from its verified webhook and persistence; they are not copied from caller speech. HyperFlow validates the service identity and person-specific project grants. It returns a routed project with bounded safe facts or a clarification containing only visible project names. Requests are timestamp-windowed and request-ID idempotent; reusing an ID with different bytes fails. No raw Google Doc, transcript, token, credential, or secret is returned.

### Operations and replay

`GET /api/operations` returns the authenticated tenant's recent agent inbox jobs, coaching call/session outcomes, Google/external action receipts, and schedules. `POST /api/operations/agent-jobs/replay` accepts `{ "jobId": "..." }` and requeues only a `failed` or `needs_review` agent job, resetting its bounded attempt counter. The Communications triage screen exposes the same snapshot and replay action. Completed jobs cannot be replayed.

Google credentials are sealed with AES-256-GCM under `INTEGRATION_ENCRYPTION_KEY`. Connected Gmail and Outlook credentials stay in Communications Service under its independent encryption key. Neither API returns OAuth tokens.

### Service-project setup

The frontend uses one wizard from **Create Project** and **Settings → Service Projects**. It saves non-secret progress with `POST|PUT /api/service-projects/setup-draft`; `GET ...?id=` resumes only for the same authenticated tenant and user before the 24-hour expiry. OAuth state carries the opaque draft ID, never its contents.

`POST /api/service-projects/validate` accepts `{ "setup": ... }`. Email triage validation performs a live mailbox sync/health check, verifies provider/draft capabilities, tenant classification/draft ceilings, digest recipient, time, and timezone. Coaching validation verifies the person and E.164 phone/voice identity, Google connection, Doc read, Sheet read/edit capability, range, retry policy, reviewer reachability, schedule, and the tenant `sheet_write` ceiling. A `422` response includes all readiness checks; a project must not be created until `validation.ready=true`.

`GET /api/service-projects/status?projectId=...` returns the project schedules, safe connection references, latest run and digest, global scheduler `lastTickAt`/`lastSuccessfulTickAt`, overdue warning, and upgrade state. The status path is read-only. Legacy unbound triage schedules are reported through upgradeRequired and unboundScheduleIds; use an explicit schedule update to attach or pause them. Enabled mailbox-bound legacy schedules retain their existing scheduler compatibility behavior until changed.

### `GET /api/triage?limit=100`

Returns `{ "data": TriageItem[], "digests": TriageDigest[] }`, newest first, for the authenticated organization only. Canonical inbound email, SMS, and eligible voice events can appear here. Each item includes channel, direction, sender/subject/preview where available, workflow and Ask links, memory eligibility, disposition, proposed action, interpretation evidence/confidence, optional typed `agentProposal`, and audit entries. Digests are occurrence-idempotent and record their delivery channel/status, counts, item IDs, summary, and any delivery error.

An ordinary inbound item is not an Ask answer merely because it shares project, run, task, or thread correlation. `ask.response.received` plus an explicit Ask ID is required for automatic Ask handling. `memoryEligible` means the communication is permitted to enter Communications Service memory; this endpoint does not report the asynchronous enrichment job's completion state.

### `PATCH /api/triage`

Disposition update:

```json
{ "id": "comm_123", "action": "resolve", "disposition": "resolved" }
```

Accept an uncertain linked Ask interpretation:

```json
{ "id": "comm_123", "action": "accept_interpretation", "decision": "approved", "text": "Approved" }
```

For question and choice Asks, send `values` matching the Ask's declared fields instead of a decision. Revision decisions require a non-empty explanatory `text` value.

Approve or reject a typed coaching proposal:

```json
{ "id": "comm_123", "action": "approve_agent_proposal" }
```

```json
{ "id": "comm_123", "action": "reject_agent_proposal" }
```

Only `coaching_commitment`, `coaching_next_action`, and `request_coaching_call` proposals linked to a Daily Coaching project are executable. Approval is authenticated and atomically claims the proposal. Commitment/next-action approval appends one idempotent row to the project's allowlisted Sheet and records the update in Project Data. Call approval starts one stable, correlated coaching occurrence. Model output alone never executes either action. A failed proposal remains reviewable and reuses the same external-action idempotency key.

Automatic agent replies and connected-mailbox drafts are limited per semantic thread to one every 15 seconds and six within a rolling one-hour window. The counters live in durable conversation context; excess work is held as `needs_review` rather than delivered.

Allowed dispositions are `new`, `linked_workflow`, `awaiting_interpretation`, `draft_prepared`, `needs_review`, `ignored`, `resolved`, `spam_automatic`, and `delivery_failure`. Accepting an interpretation uses canonical `respondToAsk`; it replaces the provisional response for that communication.

## Durable schedules

### `/api/schedules`

`GET` lists the authenticated tenant's schedules. `POST` creates and `PATCH` updates a typed schedule. New service projects use a project-bound daily `flow_start` schedule with `resetPolicy: "flow"`; the generated Email Triage action is therefore the same implementation used by **Advance Flow** and **Run now**. Legacy `communications_triage` records remain accepted during migration and support these project-specific fields:

```json
{
  "id": "optional_existing_id",
  "name": "Inbox triage",
  "enabled": true,
  "activity": "communications_triage",
  "projectId": "project-id-required-for-new-records",
  "connectionId": "opaque-mailbox-connection-id",
  "triagePolicy": "human_only",
  "createDrafts": true,
  "recurrence": { "kind": "daily", "localTime": "08:00" },
  "misfirePolicy": "run_once",
  "timezone": "Australia/Brisbane",
  "connectionId": "connection_123",
  "policy": "draft_only",
  "digestChannel": "web"
}
```

A daily project occurrence uses `flow_start`:

```json
{
  "name": "Daily coaching",
  "activity": "flow_start",
  "projectId": "project_1",
  "flowId": "coaching",
  "recurrence": { "kind": "daily", "localTime": "09:00" },
  "timezone": "Australia/Brisbane",
  "misfirePolicy": "run_once",
  "resetPolicy": "flow",
  "clearProjectDataKeys": ["google_doc_text", "transcript", "coaching_summary"]
}
```

Recurrence may instead be `{ "kind": "interval", "intervalMinutes": 15 }`; intervals are clamped to 5-1440 minutes. Misfire policy is `run_once`, `catch_up`, or `skip`. Non-web digests require `digestRecipient`. Connected Gmail or Outlook creates a provider-native draft when both the project and tenant permit `create_draft`. SMS or transactional email sends require schedule `policy: "automatic"` and tenant `send_reply` permission. Digest delivery failure is recorded on the digest but does not roll back a completed mailbox reconciliation. `DELETE /api/schedules?id={scheduleId}` removes only a schedule in the authenticated tenant.

`POST /api/schedules/run` with `{ "id": "scheduleId" }` triggers one authenticated manual occurrence without moving the schedule's next daily occurrence. `GET /api/schedules/tick` is the platform-timer route; Vercel Cron supplies `Authorization: Bearer $CRON_SECRET`. The checked-in Vercel schedule runs daily so it can deploy on Hobby. An external timer may call `POST` with `x-hyperflow-scheduler-secret: $SCHEDULER_SECRET`. The Communications VM can instead send an empty `POST` with `X-Communications-Timestamp` and `X-Communications-Signature-V2`; HyperFlow verifies the shared `COMMUNICATIONS_WEBHOOK_SECRET` and the five-minute replay window. This reuses an existing backend-only secret and never places it in the URL.

Each occurrence has a transaction lease under `schedule_runs/{orgId}/{scheduleId}/{scheduledFor}`. Completed occurrences cannot run twice; stale claims and failed occurrences can retry. `flow_start` resets only configured transient flow state and writes authoritative occurrence correlation before advancing the persisted project. Email triage synchronizes only the selected mailbox, applies the project's inbound policy, reads complete threads, classifies tenant-scoped items, optionally creates provider-native drafts, stores one project digest, and advances the `projectId + connectionId` cursor only after every included item is persisted. A failed occurrence leaves both schedule time and cursor unchanged. SMS and voice rely on signed event delivery rather than mailbox cursor scanning.

The same tick claims sparse `agent_inbox_pending` and `coaching_retry_pending` indexes. Jobs carry two-minute leases and remain recoverable after a worker crash; completed/held work is removed from the index. Coaching retries are bounded by the project attempt/window settings and never redispatch from the same terminal callback.

Coaching defaults to **two total attempts** (the original call plus one retry), waiting **ten minutes after the failed call resolves**. Voicemail, early hangup (`no_meaningful_response` and explicit hangup aliases), no answer, busy and provider failure are retryable; success, wrong number, cancellation, fax and automated-system outcomes are not. The retry runs on the first scheduler tick at or after its due time, only within the configured retry window. Counts are scoped to the current occurrence, and stale retries cannot start a later day's occurrence. The unversioned legacy 2-attempt/30-minute/180-minute default upgrades to ten minutes; separately customised settings and newly saved versioned policies are preserved. Setup's total-attempts field includes the initial call, so set it to `1` to disable automatic retries.

## Gemini helpers

### `POST /api/gemini/brainstormSubtasks`

```json
{
  "milestoneName": "Prepare development application",
  "projectContext": "Residential project in Queensland"
}
```

Success returns `200` with an array of five `{ "name", "description" }` objects.

### `POST /api/gemini/generateProjectStructure`

```json
{
  "name": "North Site Launch",
  "type": "Property development"
}
```

Success returns `200` with an object containing a `milestones` array. Each milestone contains `id`, `name`, `dependsOn`, and `subtasks`.

Both endpoints use `GEMINI_API_KEY`. Model, configuration, and response-parsing failures return `500`.

## Outbound Communications Service contract

HyperFlow calls the service configured by `COMMUNICATIONS_API_URL`. Every request includes:

```http
X-API-Key: <COMMUNICATIONS_API_KEY>
X-Tenant-Id: <tenant_id>
Accept: application/json
```

POST requests include `Content-Type: application/json`. Email, SMS, and call creation also include:

```http
Idempotency-Key: hyperflow:{tenant_id}:{external_project_id}:{run_id}:{task_id}:{channel}:{ask_id-or-action}
```

The client times out after 15 seconds. It reads the canonical `communication_id` and accepts a legacy `id` alias or `communication` response wrapper for adapter compatibility. A successful create response without `status` is normalized to `accepted`.

`COMMUNICATIONS_API_URL` is the service origin, with no `/v1` suffix. The current production shape is `https://communications-service.replit.app`; the client appends routes such as `/v1/messages`. HyperFlow sends `{PUBLIC_BASE_URL}/api/events` as each request's `callback_url`, so `PUBLIC_BASE_URL` must be a public HTTPS HyperFlow origin whose webhook route is not intercepted by deployment login protection.

### Send SMS

```http
POST {COMMUNICATIONS_API_URL}/v1/messages
```

```json
{
  "to": "+61400000000",
  "from": "+61411111111",
  "body": "Can you attend tomorrow?",
  "correlation": {
    "tenant_id": "org_1",
    "external_project_id": "project_1",
    "run_id": "run_1",
    "task_id": "SMS_1"
  },
  "callback_url": "https://hyperflow.example.com/api/events"
}
```

Communications requires `to` and `from` in E.164 format, a body of 1-1600 characters, and a stable idempotency key. HyperFlow validates the numbers and relies on Communications for the body-length limit.

A successful `sms.delivered` callback completes the waiting action but proves carrier delivery only. A recipient reply creates a separate inbound communication and `communication.received` event. If the SMS was delivered as a Human Ask, Communications additionally emits `ask.response.received` with the response text in `payload.content`.

### Start a voice call

```http
POST {COMMUNICATIONS_API_URL}/v1/calls
```

```json
{
  "to": "+61400000000",
  "from": "+61411111111",
  "overrides": {
    "systemMessage": "You are making an outbound call for HyperFlow...",
    "greetingText": "Begin the call briefly and then: Confirm Thursday at 10:30.",
    "aiSpeaksFirst": true,
    "liveTranscript": true
  },
  "purpose": {
    "type": "workflow_action"
  },
  "correlation": {
    "tenant_id": "org_1",
    "external_project_id": "project_1",
    "run_id": "run_1",
    "task_id": "CALL_1"
  },
  "callback_url": "https://hyperflow.example.com/api/events"
}
```

`purpose.type` defaults to `workflow_action` and can be overridden with the action template's `purpose_type`.

HyperFlow sends only the four allow-listed voice override keys shown above. `systemMessage` is not only the action instruction: before each call HyperFlow resolves cross-channel conversation context for the destination number and appends it to that key. The other three keys are sent verbatim.

### Outbound conversation context

The appended block carries continuity rules, the tenant's configured voice conversation style, and a delimited `AUTHORIZED CONVERSATION DATA` section holding recent evidence. It is assembled server-side; the action template cannot supply or extend it.

Context is included only when every check passes: the tenant has an agent profile, `conversation.historyEnabled` is not `false`, the destination number resolves to exactly one Communications person, and that person holds a grant for this project. Evidence is limited to inbound, memory-eligible communications from the last seven days, excluding `human_ask`, `workflow_action`, and `workflow_notification` purposes. Any failure falls back to an explicit instruction not to guess at unverifiable history, so a lookup outage cannot cause the assistant to invent one.

The resulting status is reported on the action run under `output.conversation_context`:

```json
{
  "conversation_context": {
    "status": "current",
    "sourceIds": ["comm_earlier_1", "comm_earlier_2"]
  }
}
```

`status` is `current`, `stale`, `unavailable`, or `disabled`. `disabled` means the tenant turned history off; `unavailable` covers a missing profile, an ambiguous or ungranted person, and any lookup failure. `sourceIds` lists only the evidence identifiers, never the retrieved content. The same status is written to the action logs.

### Send email

```http
POST {COMMUNICATIONS_API_URL}/v1/emails
```

The body contains recipients, subject, text or HTML, `service_identity_id` or an explicit sender, optional `provider_connection_id`, purpose, callback URL, and the same tenant/project/run/task correlation used by other channels. HyperFlow does not store or expose provider credentials.

Connected Gmail is a different adapter and is never passed to `/v1/emails`. HyperFlow uses:

```http
GET  {COMMUNICATIONS_API_URL}/v1/mailboxes
POST {COMMUNICATIONS_API_URL}/v1/mailboxes/oauth/google/start
POST {COMMUNICATIONS_API_URL}/v1/mailboxes/oauth/microsoft/start
POST {COMMUNICATIONS_API_URL}/v1/mailboxes/oauth/{gmail|outlook}/start
POST {COMMUNICATIONS_API_URL}/v1/mailboxes/{connectionId}/sync
POST {COMMUNICATIONS_API_URL}/v1/mailboxes/{connectionId}/drafts
GET  {COMMUNICATIONS_API_URL}/v1/mailboxes/{connectionId}/drafts/{draftId}
```

Draft creation requires its own stable `Idempotency-Key`, preserves provider thread/reply identifiers when present, and has no connected-mailbox send counterpart. The agent router prefers this draft route whenever a selected connected mailbox exists; a separately provisioned send-capable service identity is required for automatic transactional email.

### Deliver a Human Ask

There is no Communications `POST /v1/asks` delivery route. HyperFlow sends the Ask through `/v1/emails`, `/v1/messages`, or `/v1/calls` and adds:

```json
{
  "purpose": {
    "type": "human_ask",
    "ask_id": "ask_delivery_123",
    "token": "delivery_capability_token"
  },
  "correlation": {
    "tenant_id": "org_1",
    "external_project_id": "project_1",
    "run_id": "run_1",
    "task_id": "REVIEW_1",
    "person_id": "person_1"
  },
  "callback_url": "https://hyperflow.example.com/api/events"
}
```

HyperFlow resolves each assignee to one unambiguous email address or E.164 number before delivery. The tokenized web form remains available as an email fallback.

### Resolve a Communications Ask

```http
POST {COMMUNICATIONS_API_URL}/v1/asks/{deliveryAskId}/resolve
Content-Type: application/json
```

```json
{
  "communication_id": "comm_final_answer"
}
```

An identical replay returns success with `duplicate: true`. `400` means the communication is missing or not in the Ask thread, `404` means there is no Ask binding, and `409` means the Ask is cancelled or was resolved by another communication. HyperFlow keeps failed acknowledgements in its retryable Ask-resolution outbox.

### Read a communication

```http
GET {COMMUNICATIONS_API_URL}/v1/communications/{communicationId}
```

The current client supports `accepted`, `queued`, `ready`, `running`, `in_progress`, `waiting`, `completed`, and `failed` statuses.

HyperFlow also reads `GET /v1/communications` with tenant-scoped filters, `GET /v1/inbox` for provider-side triage, and `GET /v1/threads/{threadId}`. Provider-side disposition changes use `POST /v1/communications/{communicationId}/disposition`.

## Environment variables

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini helpers, report actions, and optional ambiguous-response interpretation. |
| `COMMUNICATIONS_API_URL` | Communications Service base URL. |
| `COMMUNICATIONS_API_KEY` | Backend-only outbound `X-API-Key` credential. |
| `COMMUNICATIONS_WEBHOOK_SECRET` | Backend-only HMAC secret for `/api/events` and `/api/agent/voice-context`; must match Communications. |
| `COMMUNICATIONS_REQUIRE_SIGNATURE_V2` | Optional explicit webhook policy; production defaults to `true`. Set `false` only during a controlled legacy-sender migration. Voice context always requires V2. |
| `COMMUNICATIONS_FROM_NUMBER` | Optional global E.164 sender fallback. |
| `COMMUNICATIONS_EMAIL_IDENTITY` | Optional global email service-identity fallback; prefer tenant settings. |
| `COMMUNICATIONS_CONNECTION_ID` | Optional global provider-connection fallback for Ask email delivery; prefer tenant settings. |
| `COMMUNICATIONS_INTENT_MODEL` | Optional Gemini model for conservative ambiguous-response extraction. |
| `CRON_SECRET` | Secret supplied by Vercel Cron to `/api/schedules/tick`. |
| `SCHEDULER_SECRET` | Optional secret for a non-Vercel timer caller. |
| `WEBHOOK_ALLOWED_HOSTS` | Optional comma-separated allowlist for webhook action hostnames. |
| `PUBLIC_BASE_URL` | Public HTTPS origin for form links and Communications callbacks. |
| `WEBHOOK_SECRET` | Shared secret for machine calls to `/api/flow/advance`. |
| `FIREBASE_SERVICE_ACCOUNT` | Privileged server-side Firebase credentials, as JSON or base64. |
| `FIREBASE_DATABASE_URL` | Server-side Realtime Database URL; must match the browser database. |
| `FIREBASE_STORAGE_BUCKET` | Server-side Firebase Storage bucket; required only for external Ask uploads. |
| `GOOGLE_CLIENT_ID` | Backend Google OAuth web-client ID for Workspace. |
| `GOOGLE_CLIENT_SECRET` | Backend Google OAuth web-client secret for Workspace. |
| `GOOGLE_OAUTH_STATE_SECRET` | At least 32 random characters used to sign tenant/user-bound OAuth state. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Optional exact callback; defaults to `{PUBLIC_BASE_URL}/api/integrations/google/callback`. |
| `INTEGRATION_ENCRYPTION_KEY` | Exactly 32 random bytes encoded as 64 hex characters or base64; seals Workspace tokens. |
| `EMAIL_TRIAGE_BATCH_SIZE` | Optional cap on threads reconciled per email triage occurrence; defaults to 5. A schedule's own `batchSize` takes precedence. |
| `EMAIL_SEND_POLICY_BY_TENANT` | Optional JSON object mapping organization ID to email authority mode, such as `{"org_1":"draft_only"}`. See [boundaries](architecture/BOUNDARIES.md). |
| `HYPERFLOW_MANAGED_FILES` | Set `true` to enable private managed file storage; also requires `FIREBASE_STORAGE_BUCKET` and `FIREBASE_ENFORCE_TENANT_LIFECYCLE=true`. See [managed files](MANAGED_FILES.md). |
| `FIREBASE_ENFORCE_TENANT_LIFECYCLE` | Set `true` to enable tenant suspend/resume mutations and managed files; requires matching deployed database rules. |

Cross-service values must be paired as follows:

| HyperFlow value | Communications Service value |
|---|---|
| `COMMUNICATIONS_API_URL=https://communications-service.replit.app` | The deployed service origin; do not include `/v1`. |
| `COMMUNICATIONS_API_KEY=<secret>` | `API_KEY=<same secret>` for the compatibility credential, or the corresponding tenant-scoped API credential. |
| `COMMUNICATIONS_WEBHOOK_SECRET=<secret>` | `COMMUNICATIONS_WEBHOOK_SECRET=<same secret>`. |
| `PUBLIC_BASE_URL=https://<public-hyperflow-origin>` | `HYPERFLOW_EVENT_URL=https://<same-origin>/api/events` as the default durable destination. |
| `PUBLIC_BASE_URL=https://<public-hyperflow-origin>` | `HYPERFLOW_AGENT_CONTEXT_URL=https://<same-origin>/api/agent/voice-context` for live inbound voice. |

Per-request `callback_url` wins over `HYPERFLOW_EVENT_URL`. The HyperFlow callback route is `/api/events`; `/api/communications/events` does not exist. Use the stable production origin and verify that anonymous requests reach both `/api/events` and `/api/agent/voice-context` without an interactive login redirect. An application JSON `401` is the expected unsigned result. Generated Vercel deployment and preview URLs may remain protected even when the production domain is public. If the selected origin is actually blocked, configure Communications backend-only `HYPERFLOW_VERCEL_AUTOMATION_BYPASS_SECRET`; Communications sends `x-vercel-protection-bypass` only to the exact configured HyperFlow origin.

Browser Firebase overrides are public application configuration, not server credentials:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MEASUREMENT_ID`

Set the required browser values as one consistent Firebase project configuration, and keep `FIREBASE_DATABASE_URL` pointed at the same Realtime Database. See [`.env.example`](../.env.example) for format notes. Do not expose any backend secret through a `VITE_*` variable.


## Phase 02: canonical thread register

All routes use verified HyperFlow organization membership and call Communications REST; no canonical membership is stored in HyperFlow.

| Route | Method | Inputs |
|---|---|---|
| `/api/thread-register` | GET | `status`, `personId`, `projectId`, `limit`, `offset`, `threadId`, `communicationOffset` |
| `/api/thread-register/candidates` | GET | `communicationId` |
| `/api/thread-register/correction` | POST | `communicationId`, exactly one `thread_id`/`create_new`, `reason_code`, optional `reason_detail`, `person_id`, `update_identity`, `external_project_id` |
| `/api/thread-register/thread` | PATCH | `threadId`, editable `title`, `summary`, `status`, `external_project_id` |

Tenant and initiator are derived server-side. Source/destination project references on writes must belong to the organization. Communications additionally validates tenant/project consistency and rejects workflow-bound project changes. Invalid shape is 400, inaccessible project 403, wrong method 405. Upstream 4xx is preserved; upstream service failure maps to 502. Older-server 404 is surfaced as unavailable; no local substitute writes occur.

The register uses 100-thread UI pages, up to 200 via API, and 20-communication history pages. The text filter searches only the loaded page. The UI resets on organization change. See [Phase 02 evidence](implementation/P02.md) for test tiers and release requirements.

## Phase 11 account and workspace APIs

The [Phase 11 OpenAPI supplement](../contracts/phase11.openapi.json) and [standalone TypeScript client](../lib/client/hyperflow.ts) cover account controls, workspace snapshots and bounded flow/artifact pages. They supplement the existing endpoint reference.

- GET `/api/tenant` returns the authenticated administrator's redacted client registry, control revision, budget, usage and audit. POST accepts `create_client`, `rotate_client`, `revoke_client` or `budget`; only a current human owner/admin may mutate these controls.
- Clients supply a high-entropy URL-safe secret, explicit read/write scopes and expiry within 366 days. Creation uses a stable `requestId`; rotation/revocation/budget use the latest control revision. The browser retains an uncertain request for explicit retry. Identical creation/rotation replay is safe; client secrets and hashes are never returned by the server. The browser displays its locally generated credential once.
- Machine authorization uses `Bearer hf.<organization>.<client-id>.<secret>`. Current issuer membership, expiry, scope and revocation are checked for every request. Scopes do not override project permissions, provider grants or draft-only email policy. Tenant control writes require a human session even with a machine credential issued by an owner.
- GET `/api/workspace` returns the existing workspace snapshot. PUT takes `{expectedRevision,data}` and checks tenant and project revisions, with a 3.8 MB request cap. Existing browser Firebase saves remain supported. This resource does not merge Communications data or the separate operational stores into the project snapshot.
- GET `/api/flows?shape=summary` and `/api/artifacts?shape=summary&projectId=...` accept `after` and `limit` (1–100, default50). Follow `next` even when a filtered page is empty. Read an individual record by `id` for full details.

Daily request limits count admitted API-client calls, including calls that later fail; scope-denied requests, browser sessions and provider charges are excluded. Zero means unlimited. Usage claims may advance the account revision, so reload before retrying an administrator edit that returns409. Revocation takes effect at the next authorization check; it does not recall already dispatched effects. The existing separate SMS/phone contact controls still apply.

The standalone client pins the destination origin, keeps its credential private, supports an abort signal and performs no automatic write retries. Use current resource revisions and read/reconcile operations after uncertain outcomes. Browser logout, organization change or subscription permission loss clears the current cloud view and safety backup; downloaded files and local-only workspaces are outside that cache boundary.

### Account recovery and portable exports

`GET /api/tenant?view=lifecycle` requires a current human owner or administrator Firebase token (machine clients are rejected). It returns HyperFlow database state, receipt history and export datasets. `service=communications` reads the separate Communications lifecycle through its API. The composition never copies Communications evidence into HyperFlow's data stores.

`POST` on the same view takes `{operation: "suspend" | "resume", revision, requestId}`. With `service: "communications"`, HyperFlow durably records the human initiator before forwarding and reconciles the same request after a lost response. Without it, only HyperFlow database activity changes. Suspend Communications first, then suspend HyperFlow; unresolved HyperFlow work blocks suspension and restores database access with a blocked receipt. A crash during inspection leaves a working receipt that can be retried by its original administrator and request identity. Do not invent new identities to bypass held work.

HyperFlow mutations require `FIREBASE_ENFORCE_TENANT_LIFECYCLE=true` and deployed matching database rules. This uses Firebase's [limited Admin privileges](https://firebase.google.com/docs/database/admin/start#authenticate-with-limited-privileges), with a separate privileged controller reserved for current-owner recovery. Normal application writes are denied while paused. File storage and provider resources are outside this database-only boundary. HyperFlow erasure and automatic retention are not enabled by this release.

Export uses `dataset`, `revision` and byte `offset`. A current suspended revision is required. Each response contains up to512000 bytes encoded as base64, `nextOffset`, `totalBytes`, full `sha256` and `chunkSha256`. Concatenate decoded chunks, verify the full hash, then parse JSON. Credentials and capability links are redacted; credential stores, actual file contents and Communications records are excluded. The browser verifies the hash and caps a download at50MB; larger datasets use the paged API. Export reads the source dataset into server memory, so this is not an unlimited-size backup service. Audit retains up to1000 lifecycle entries and requires manual retention review at the cap.

An owner or administrator can reach recovery controls from the revoked-workspace screen. Downloaded exports remain outside browser cache invalidation. Resume does not automatically resume the other service or reconnect providers. No portable-export restore or whole-account erasure guarantee is claimed.

### Service-project setup parity

Express and Vercel share the handlers for `/api/service-projects/setup-draft` (GET, POST, PUT), `/api/service-projects/validate` (POST) and `/api/service-projects/status` (GET). API credentials require `service-projects:read` or `service-projects:write` as appropriate, in addition to current membership. Drafts are scoped to both the authenticated tenant and user. Status reads do not change schedules: `upgradeRequired` and `unboundScheduleIds` identify legacy schedules requiring an explicit schedule update. `mailboxStatus` distinguishes `available` from `unavailable`; an unavailable lookup must not be treated as proof of no mailboxes. See the [coverage audit](API_PARITY.md) for current limits and remaining work.
