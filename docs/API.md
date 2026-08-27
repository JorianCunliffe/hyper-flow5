# HyperFlow API reference

This reference describes the HTTP handlers under `api/`, their local Express equivalents, and the Communications Service requests emitted by the current HyperFlow client.

## Conventions

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
| `POST /api/events` | `X-Communications-Signature` HMAC using `COMMUNICATIONS_WEBHOOK_SECRET`. |
| `POST /api/send-email` | Firebase ID token and organization membership. |
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
| `POST` | `/api/send-email` | Send an HTML email with Resend. |
| `POST` | `/api/gemini/brainstormSubtasks` | Generate five subtask suggestions. |
| `POST` | `/api/gemini/generateProjectStructure` | Generate a milestone graph. |

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
| `send_email` | `{ "to", "subject", "body" }` | Sends plain text through Resend. |
| `send_sms` | `{ "to", "from?", "body" }` | Starts an SMS through Communications. |
| `outgoing_call` | `{ "to", "from?", "instruction" }` | Starts a call; `prompt` or `body` may supply the instruction. |
| `webhook` | `{ "url", "method?", "headers?", "payload?" }` | Calls a public HTTPS/443 endpoint. |
| `write_report` | `{ "prompt", "sop?", "template?", "eval_criteria?" }` | Generates, evaluates, and when required revises a report with Gemini. |

Friendly aliases such as `email`, `sms`, `call`, `voice`, `http`, and `report` are normalized to the canonical types.

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

Accepted Communications work: `202`

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

The action remains waiting until a mapped terminal event arrives. A Communications response explicitly marked `failed` returns `502`; validation, configuration, provider HTTP, timeout, and other execution failures currently return `500`. Unknown task types return `400`.

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
  "attachments": [],
  "actor": "Jorian"
}
```

`decision` may be `approved`, `rejected`, or `revise`; the accepted fields depend on the Ask kind. A revision requires a comment. `text` is limited to 20,000 characters.

When a valid Firebase token is supplied, HyperFlow derives a verified reviewer identity from the authenticated member. Without it, a delivery-specific capability token identifies the assigned recipient. A caller-supplied `actor` is only a label and cannot satisfy `all` or `quorum` policies unless the delivery token itself maps to an assigned reviewer.

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

## Receive Communications events

### `POST /api/events`

```http
Content-Type: application/json
X-Communications-Event-Id: evt_...
X-Communications-Signature: sha256=<HMAC-SHA256 of the exact raw JSON body>
```

HyperFlow verifies the signature with `COMMUNICATIONS_WEBHOOK_SECRET` before parsing JSON, then defaults the verified event source to `communications`. `event_id` in the body is the processing idempotency key; delivery is at least once.

Ask response example:

```json
{
  "event_id": "evt_ask_123",
  "communication_id": "comm_123",
  "type": "ask.response.received",
  "occurred_at": "2026-08-11T02:30:00.000Z",
  "purpose": {
    "type": "human_ask",
    "ask_id": "ask_delivery_123"
  },
  "correlation": {
    "tenant_id": "org_1",
    "external_project_id": "project_1",
    "person_id": "person_1"
  },
  "payload": {
    "ask_id": "ask_delivery_123",
    "channel": "voice",
    "transcript": "Approved"
  }
}
```

SMS response text is read from `payload.content`; voice response evidence is read from `payload.transcript`. HyperFlow maps the delivery Ask ID to its canonical Ask, validates and persists the response, advances the project, and then uses a durable outbox to call Communications `POST /v1/asks/{deliveryAskId}/resolve` with the accepted `communication_id`.

Task terminal event example:

```json
{
  "event_id": "evt_123",
  "communication_id": "comm_123",
  "type": "sms.delivered",
  "occurred_at": "2026-08-11T02:35:00.000Z",
  "correlation": {
    "tenant_id": "org_1",
    "external_project_id": "project_1",
    "run_id": "run_1",
    "task_id": "SMS_1"
  },
  "payload": {
    "status": "delivered"
  }
}
```

Terminal mapping:

| Event | Result |
|---|---|
| `sms.delivered` | Success. |
| `sms.failed` | Failure. |
| `call.completed` | Success. |
| `call.failed` | Failure. |
| `sms.sent` | Nonterminal, except defensive handling of `payload.status: delivered`, `failed`, or `undelivered`. |
| Other event types | Nonterminal and recorded as ignored. |

New events should use `correlation.external_project_id`. HyperFlow also accepts the transitional `correlation.project_id` alias and normalizes either value to its internal project ID.

Events are persisted before processing under `external_events/{event_id}`. Processing states are `received`, `processing`, `processed`, and `processing_failed`; expiring leases allow safe retry after interrupted work. A processed duplicate returns `200`. A concurrent or retryable event returns `409`, prompting Communications to retry. Invalid signatures return `401`, invalid envelopes return `400`, handler failures return `500`, and missing webhook secret or server persistence returns `503`.

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
  "html": "<p>The report is ready.</p>"
}
```

Success returns `200` with Resend's `data` object. A Resend response containing an error returns `400`; configuration or unexpected failures return `500`.

This endpoint, the `send_email` action, and Human Ask email delivery use `RESEND_FROM_EMAIL`, defaulting to `HyperFlow <automation@projectflow.online>`. Inbound email Ask replies are not implemented; Ask emails link to the tokenized form.

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
Accept: application/json
```

POST requests include `Content-Type: application/json`. SMS and call creation also include:

```http
Idempotency-Key: hyperflow:{tenant_id}:{external_project_id}:{run_id}:{task_id}:{channel}:{ask_id-or-action}
```

The client times out after 15 seconds. It reads the canonical `communication_id` and accepts a legacy `id` alias or `communication` response wrapper for adapter compatibility. A successful create response without `status` is normalized to `accepted`.

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
  "correlation": {
    "tenant_id": "org_1",
    "external_project_id": "project_1",
    "run_id": "run_1",
    "task_id": "CALL_1"
  },
  "callback_url": "https://hyperflow.example.com/api/events"
}
```

HyperFlow sends only the allow-listed voice overrides shown above.

### Deliver a Human Ask

There is no Communications `POST /v1/asks` delivery route. HyperFlow sends the Ask through `/v1/messages` or `/v1/calls` and adds:

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

HyperFlow resolves each assignee to one unambiguous email address or E.164 number before delivery. Email and web-form delivery remain HyperFlow responsibilities.

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

## Environment variables

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini helpers and report actions. |
| `RESEND_API_KEY` | Email helper, email actions, and Human Ask email delivery. |
| `RESEND_FROM_EMAIL` | Optional sender; defaults to `HyperFlow <automation@projectflow.online>`. |
| `COMMUNICATIONS_API_URL` | Communications Service base URL. |
| `COMMUNICATIONS_API_KEY` | Backend-only outbound `X-API-Key` credential. |
| `COMMUNICATIONS_WEBHOOK_SECRET` | Backend-only HMAC secret for `/api/events`; must match Communications. |
| `COMMUNICATIONS_FROM_NUMBER` | Optional global E.164 sender fallback. |
| `WEBHOOK_ALLOWED_HOSTS` | Optional comma-separated allowlist for webhook action hostnames. |
| `PUBLIC_BASE_URL` | Public HTTPS origin for form links and Communications callbacks. |
| `WEBHOOK_SECRET` | Shared secret for machine calls to `/api/flow/advance`. |
| `FIREBASE_SERVICE_ACCOUNT` | Privileged server-side Firebase credentials, as JSON or base64. |
| `FIREBASE_DATABASE_URL` | Server-side Realtime Database URL; must match the browser database. |

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
