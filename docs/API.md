# HyperFlow API

This document describes the HTTP surface currently implemented by the Vercel functions under `api/` and mirrored by the local Express server where applicable.

The outbound and event examples were audited against the Communications Service [`main` API reference](https://github.com/JorianCunliffe/communications-service/blob/main/docs/API_REFERENCE.md) dated 26 August 2026. HyperFlow's compatibility behavior is documented separately where it intentionally accepts legacy or defensive shapes not emitted by that reference.

## Conventions

- Request and response bodies use JSON unless stated otherwise.
- Timestamps in event envelopes are ISO 8601 strings or Unix millisecond values.
- Project APIs use camelCase (`orgId`, `projectId`).
- The Communications API boundary uses snake_case (`tenant_id`, `project_id`, `ask_id`).
- Errors generally use `{ "error": "message" }`. Task execution errors can also include `status` and `logs`.

## Authentication summary

| Endpoint | Authentication |
|---|---|
| `POST /api/events` | `X-Communications-Signature` HMAC using `$COMMUNICATIONS_WEBHOOK_SECRET` |
| `POST /api/flow/advance` | `x-webhook-secret: $WEBHOOK_SECRET` |
| `GET|POST /forms/ask/{token}` | Capability token in the path |
| `GET|POST /api/asks/{token}` | Capability token in the path |
| Other `/api/*` endpoints | No application-level authentication is currently implemented |

The unauthenticated execution, Gemini, and email endpoints should be protected at the deployment or gateway layer before exposing them beyond a trusted environment.

## Endpoint index

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/tasks/execute` | Execute one action. |
| `POST` | `/api/events` | Receive and persist Communications API events. |
| `POST` | `/api/flow/advance` | Advance one persisted project server-side. |
| `GET` | `/forms/ask/{token}` | Read one ask through its public form URL. |
| `POST` | `/forms/ask/{token}` | Respond to one ask. |
| `GET|POST` | `/api/asks/{token}` | Direct handler behind the public form rewrite. |
| `POST` | `/api/send-email` | Send an HTML email through Resend. |
| `POST` | `/api/gemini/brainstormSubtasks` | Generate milestone subtask suggestions. |
| `POST` | `/api/gemini/generateProjectStructure` | Generate a project milestone graph. |

## Execute an action

### `POST /api/tasks/execute`

Executes a canonical action type or a recognized friendly alias.

Request:

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

Canonical task types:

| `taskType` | Template JSON | Notes |
|---|---|---|
| `send_email` | `{ "to", "subject", "body" }` | Sends through Resend. |
| `send_sms` | `{ "to", "from?", "body" }` | Requires `orgId`, `projectId`, `nodeId`, and `runId` correlation. |
| `outgoing_call` | `{ "to", "from?", "instruction" }` | Also accepts `prompt` or `body` for the instruction. Requires full correlation. |
| `webhook` | `{ "url", "method", "headers", "payload" }` | `method` defaults to `POST`; timeout is 15 seconds. |
| `write_report` | `{ "prompt", "sop", "template", "eval_criteria" }` | Uses Gemini; revision context is applied when supplied. |

`send_sms` and `outgoing_call` also fall back to `projectData.contact_phone` or `projectData.phone_number` when the template omits `to`. For these action nodes, `from` resolves in this order: template, `projectData.communications_from_number`, the tenant Communications setting, then `COMMUNICATIONS_FROM_NUMBER`. Both numbers must be E.164. HyperFlow derives `callback_url` only from the server-side HTTPS `PUBLIC_BASE_URL`.

Synchronous success returns `200`:

```json
{
  "status": "success",
  "output": {
    "report_written": true,
    "report_content": "..."
  },
  "logs": ["..."]
}
```

The current Communications Service returns `201` canonical communication objects without a workflow status. HyperFlow normalizes the missing status to `accepted`, keeps the action waiting, and returns `202`:

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

Status codes:

| Status | Meaning |
|---|---|
| `200` | Action completed synchronously. |
| `202` | Communication accepted and the action is waiting for an event. |
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

The HMAC key is `COMMUNICATIONS_WEBHOOK_SECRET`. Communications only emits the signature when that secret is configured, while HyperFlow requires it; therefore the secret must be enabled in both deployments. HyperFlow verifies the signature before parsing JSON or defaulting a missing `source` to `communications`, then persists the complete event before applying it. `event_id` in the body is the idempotency key. `X-Communications-Event-Id` is emitted for observability but HyperFlow does not currently compare it with the body.

### Ask response event

An `ask.response.received` event carrying an explicit `ask_id` is routed to the canonical ask response service. It does not enter the task-run resolver.

```json
{
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
    "project_id": "project_1",
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

Only `call.completed` and `sms.delivered` are successful terminal events. `call.failed` and `sms.failed` map to failure. A contradictory `call.completed` payload that explicitly has `successful: false`, `memory_eligible: false`, or a non-`human_completed` disposition also fails closed. Every other current or future event defaults to non-terminal. Terminal events require `tenant_id`, `project_id`, `run_id`, and `task_id`; `communication_id` adds an additional exact-run match when present.

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
| `200` | Event accepted, ignored, duplicated, processed, or recorded with a non-retryable application result. Inspect `ok`, `ignored`, and `reason`. |
| `400` | Invalid JSON or envelope, such as a missing `event_id` or `type`. |
| `401` | HMAC signature is missing or incorrect. |
| `405` | Method is not `POST`. |
| `409` | Correlation did not match a waiting run, or the outbound Ask-resolution acknowledgement failed; Communications should retry the same `event_id`. |
| `500` | Unexpected handler failure. |
| `503` | Webhook HMAC secret or server-side Firebase persistence is not configured. |

Unsupported sources and non-terminal task events return `200` with `ignored: true`. In particular, `sms.sent` is non-terminal: an SMS action remains waiting until `sms.delivered` or `sms.failed`. There is currently no HyperFlow delivery timeout, so a missing terminal carrier event leaves the action waiting.

## Advance a project

### `POST /api/flow/advance`

Headers:

```http
x-webhook-secret: <WEBHOOK_SECRET>
Content-Type: application/json
```

Request:

```json
{
  "orgId": "org_1",
  "projectId": "project_1"
}
```

Response:

```json
{
  "ok": true,
  "log": ["Flow is up to date — nothing to advance."],
  "pending": []
}
```

Advancement evaluates decisions and loops, executes ready auto-run actions, raises review asks, attempts configured non-web Ask deliveries, and persists the resulting project. Individual delivery failures are recorded on the Ask and in the returned log; they do not make the entire advance request fail.

Status codes:

| Status | Meaning |
|---|---|
| `200` | Project advanced successfully. |
| `400` | `orgId` or `projectId` is missing. |
| `403` | Webhook secret is incorrect. |
| `404` | Project was not found. |
| `405` | Method is not `POST`. |
| `500` | Advancement failed. |
| `503` | Secret or server-side persistence is not configured. |

## Read or answer an ask

### `GET /forms/ask/{token}?org={orgId}&project={projectId}`

`/forms/ask/{token}` is rewritten to `/api/asks/{token}`. The token is a capability that authorizes access to only one ask.

Response:

```json
{
  "projectName": "North Site",
  "nodeName": "Draft report",
  "ask": {
    "id": "ask_123",
    "kind": "approval",
    "status": "open",
    "prompt": "Review the report and approve, or send it back with changes.",
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

Raw provider payloads and surrounding project data are not returned.

### `POST /forms/ask/{token}?org={orgId}&project={projectId}`

Approval response:

```json
{
  "actor": "Jorian",
  "decision": "approved",
  "text": "Looks good."
}
```

Question response:

```json
{
  "actor": "Jorian",
  "text": "12 Main Street",
  "values": {
    "site_address": "12 Main Street"
  },
  "attachments": []
}
```

Successful response:

```json
{
  "ok": true,
  "askStatus": "answered",
  "log": ["..."],
  "needsInterpretation": false
}
```

`text` is limited to 20,000 characters. The supplied `actor` is an audit label, not an independently verified identity; possession of the token is the authorization.

Status codes:

| Status | Meaning |
|---|---|
| `200` | Ask read or response recorded. |
| `400` | Missing routing values, invalid response, expired/cancelled ask, or revision without a comment. |
| `404` | Project, token, or ask was not found. The GET response deliberately does not distinguish them. |
| `405` | Unsupported method. |
| `409` | Ask was already answered. |
| `413` | Comment exceeds 20,000 characters. |
| `500` | Unexpected request failure. |
| `503` | Server-side persistence is not configured. |

## Send an email

### `POST /api/send-email`

Request:

```json
{
  "to": "person@example.com",
  "subject": "Project update",
  "html": "<p>The report is ready.</p>"
}
```

Successful response:

```json
{
  "data": {
    "id": "resend_message_id"
  }
}
```

This helper sends from `automation@projectflow.online`. The separate `send_email` task action currently sends from the fixed Resend onboarding sender `Acme Corp <onboarding@resend.dev>`. `RESEND_FROM_EMAIL` affects Human Ask email delivery only.

## Gemini helpers

### `POST /api/gemini/brainstormSubtasks`

```json
{
  "milestoneName": "Prepare development application",
  "projectContext": "Residential project in Queensland"
}
```

Returns an array of five objects containing `name` and `description`.

### `POST /api/gemini/generateProjectStructure`

```json
{
  "name": "North Site Launch",
  "type": "Property development"
}
```

Returns an object containing a `milestones` array. Each generated milestone contains `id`, `name`, `dependsOn`, and `subtasks`.

Both endpoints require `GEMINI_API_KEY` and return `500` when model generation or JSON parsing fails.

## Outbound Communications API contract

HyperFlow acts as a client of the service configured by `COMMUNICATIONS_API_URL`. Every request includes:

```http
X-API-Key: <COMMUNICATIONS_API_KEY>
Accept: application/json
```

POST requests also include `Content-Type: application/json`; GET requests do not. The client timeout is 15 seconds.

### Send SMS: `POST {COMMUNICATIONS_API_URL}/v1/messages`

```json
{
  "to": "+61400000000",
  "from": "+61411111111",
  "body": "Can you attend tomorrow?",
  "correlation": {
    "tenant_id": "org_1",
    "project_id": "project_1",
    "run_id": "run_1",
    "task_id": "SMS_1"
  },
  "callback_url": "https://hyperflow.example.com/api/events"
}
```

The Communications Service validates both numbers as E.164 and the body as 1–1600 characters. HyperFlow validates E.164 numbers before dispatch but currently relies on Communications for the body-length limit.

### Start call: `POST {COMMUNICATIONS_API_URL}/v1/calls`

```json
{
  "to": "+61400000000",
  "from": "+61411111111",
  "overrides": {
    "systemMessage": "You are making an outbound call for HyperFlow...",
    "greetingText": "Begin the call briefly and then: Confirm whether Thursday at 10:30 works.",
    "aiSpeaksFirst": true,
    "liveTranscript": true
  },
  "correlation": {
    "tenant_id": "org_1",
    "project_id": "project_1",
    "run_id": "run_1",
    "task_id": "CALL_1"
  },
  "callback_url": "https://hyperflow.example.com/api/events"
}
```

Communications shallow-merges arbitrary `overrides`, but HyperFlow exposes only `systemMessage`, `greetingText`, `aiSpeaksFirst`, and `liveTranscript` in this integration.

### Deliver Human Asks

SMS and voice asks use the same `/v1/messages` and `/v1/calls` endpoints with a first-class purpose:

```json
{
  "to": "+61400000000",
  "from": "+61411111111",
  "body": "Approve the draft?",
  "purpose": {
    "type": "human_ask",
    "ask_id": "ask_123",
    "token": "token_123"
  },
  "correlation": {
    "tenant_id": "org_1",
    "project_id": "project_1",
    "task_id": "REPORT_1",
    "run_id": "run_1",
    "person_id": "person_1"
  },
  "callback_url": "https://hyperflow.example.com/api/events"
}
```

An assignee may itself be a valid E.164 number/email address. Otherwise HyperFlow resolves it by exact setting key, then by a unique case-insensitive team-member name match. Missing, invalid, or ambiguous identities fail closed. For SMS/voice asks, sender precedence is Project Data `communications_from_number`, tenant Settings, then `COMMUNICATIONS_FROM_NUMBER`. Email asks do not use Communications Service; HyperFlow sends them through Resend with the tokenized form URL and optional `ask+{token}@{ASK_REPLY_DOMAIN}` Reply-To.

### Read communication: `GET {COMMUNICATIONS_API_URL}/v1/communications/{id}`

The current Communications Service returns the canonical object directly. HyperFlow temporarily also accepts a legacy `communication` wrapper and `id` field:

```json
{
  "communication": {
    "communication_id": "comm_123",
    "status": "queued",
    "channel": "sms",
    "output": {}
  }
}
```

Supported status values are `accepted`, `queued`, `ready`, `running`, `in_progress`, `waiting`, `completed`, and `failed`. When the service omits a status from a canonical `201` response, HyperFlow normalizes it to `accepted`. Every successful response must include a non-empty `communication_id` (or temporary legacy `id`).

## Environment variables

### Settings versus backend secrets

Settings → Communications stores only `settings.communications.fromNumber` under the selected Firebase organization. That value is included in normal HyperFlow cloud data and backups and must not contain credentials. Team-member phone numbers and email addresses used for Ask routing are likewise ordinary tenant data under `settings.teamMemberDetails`.

`COMMUNICATIONS_API_KEY`, `COMMUNICATIONS_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT`, and provider API keys are backend secrets. HyperFlow reads them only from `process.env`; they must not be entered into Settings, stored in Project Data, or exposed through `VITE_*` variables.

| Variable | Used for |
|---|---|
| `GEMINI_API_KEY` | Gemini helper routes and report tasks. |
| `RESEND_API_KEY` | Email helper and email tasks. |
| `RESEND_FROM_EMAIL` | Optional Human Ask email sender; defaults to `automation@projectflow.online`. It does not change the separate `send_email` action sender. |
| `COMMUNICATIONS_API_URL` | Base URL for the Communications Service `/v1` API. |
| `COMMUNICATIONS_API_KEY` | Backend-only outbound `X-API-Key` credential. |
| `COMMUNICATIONS_WEBHOOK_SECRET` | Backend-only HMAC secret for inbound `/api/events`; must match Communications Service. |
| `COMMUNICATIONS_FROM_NUMBER` | Optional global E.164 sender fallback; tenant Settings is preferred. |
| `ASK_REPLY_DOMAIN` | Email ask Reply-To addresses. |
| `PUBLIC_BASE_URL` | Public form URLs and Communications callbacks. SMS/voice delivery requires an absolute HTTPS value. |
| `WEBHOOK_SECRET` | Authentication for `/api/flow/advance`. |
| `FIREBASE_SERVICE_ACCOUNT` | Privileged server-side Realtime Database access; JSON or base64. |
| `FIREBASE_DATABASE_URL` | Server-side database URL. Must match the browser database. |

Browser Firebase overrides are documented in [`.env.example`](../.env.example).
