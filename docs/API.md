# HyperFlow API

This document describes the HTTP surface currently implemented by the Vercel functions under `api/` and mirrored by the local Express server where applicable.

## Conventions

- Request and response bodies use JSON unless stated otherwise.
- Timestamps in event envelopes are ISO 8601 strings or Unix millisecond values.
- Project APIs use camelCase (`orgId`, `projectId`).
- The Communications API boundary uses snake_case (`tenant_id`, `project_id`, `ask_id`).
- Errors generally use `{ "error": "message" }`. Task execution errors can also include `status` and `logs`.

## Authentication summary

| Endpoint | Authentication |
|---|---|
| `POST /api/events` | `Authorization: Bearer $COMMUNICATIONS_API_KEY` |
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
| `send_sms` | `{ "to", "body" }` | Requires `projectId`, `nodeId`, and `runId` correlation. |
| `outgoing_call` | `{ "to", "instruction" }` | Also accepts `prompt` or `body` for the instruction. Requires correlation. |
| `webhook` | `{ "url", "method", "headers", "payload" }` | `method` defaults to `POST`; timeout is 15 seconds. |
| `write_report` | `{ "prompt", "sop", "template", "eval_criteria" }` | Uses Gemini; revision context is applied when supplied. |

`send_sms` and `outgoing_call` also fall back to `projectData.contact_phone` or `projectData.phone_number` when the template omits `to`.

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

A Communications API action accepted for asynchronous processing returns `202`:

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
    "communication_status": "queued"
  },
  "logs": ["Communication comm_123 accepted with status queued"]
}
```

Status codes:

| Status | Meaning |
|---|---|
| `200` | Action completed synchronously. |
| `202` | Communication accepted and the action is waiting for an event. |
| `400` | Unknown task type or invalid request understood by the task handler. |
| `500` | Execution or configuration failure. |
| `502` | Communications API explicitly reported a failed communication. |

## Receive external events

### `POST /api/events`

Headers:

```http
Authorization: Bearer <COMMUNICATIONS_API_KEY>
Content-Type: application/json
```

HyperFlow persists the complete event before applying it. `event_id` is the idempotency key.

### Ask response event

An `ask.response.received` event carrying an explicit `ask_id` is routed to the canonical ask response service. It does not enter the task-run resolver.

```json
{
  "event_id": "evt_ask_123",
  "source": "communications",
  "type": "ask.response.received",
  "occurred_at": "2026-08-11T02:30:00.000Z",
  "ask_id": "ask_123",
  "channel": "voice",
  "communication_id": "comm_123",
  "transcript_id": "transcript_123",
  "correlation": {
    "tenant_id": "org_1",
    "project_id": "project_1",
    "person_id": "person_1"
  },
  "response": {
    "text": "Approved",
    "structured": {
      "decision": "approved"
    }
  }
}
```

Allowed channels are `web`, `email`, `sms`, and `voice`. Structured approval decisions are `approved`, `rejected`, or `revise`. A `revise` decision must include explanatory text.

For question asks, `response.structured` contains values keyed by the ask field names:

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

Terminal event types end in `.completed` or `.failed`. They resolve a waiting action using explicit project, task, and optional run or communication correlation.

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
    "summary": "The customer confirmed Thursday at 10:30.",
    "transcript": "..."
  }
}
```

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
| `400` | Invalid envelope, such as a missing `event_id`, `source`, or `type`. |
| `403` | Bearer token is missing or incorrect. |
| `405` | Method is not `POST`. |
| `409` | Correlation did not match a waiting run; the sender may retry. |
| `500` | Unexpected handler failure. |
| `503` | API key or server-side Firebase persistence is not configured. |

Unsupported sources and non-terminal task events return `200` with `ignored: true`.

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

Advancement evaluates decisions and loops, executes ready auto-run actions, raises review asks, sends configured non-web ask deliveries, and persists the resulting project.

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

This helper sends from `automation@projectflow.online`. The `send_email` task action uses its own configured sender in `lib/executeTask.ts`.

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
Authorization: Bearer <COMMUNICATIONS_API_KEY>
Accept: application/json
Content-Type: application/json
```

The client timeout is 15 seconds.

### Send SMS: `POST {COMMUNICATIONS_API_URL}/v1/messages`

```json
{
  "channel": "sms",
  "to": "+61400000000",
  "content": "Can you attend tomorrow?",
  "correlation": {
    "tenant_id": "org_1",
    "project_id": "project_1",
    "run_id": "run_1",
    "task_id": "SMS_1"
  }
}
```

### Start call: `POST {COMMUNICATIONS_API_URL}/v1/calls`

```json
{
  "channel": "voice",
  "to": "+61400000000",
  "instruction": "Confirm whether Thursday at 10:30 works.",
  "correlation": {
    "tenant_id": "org_1",
    "project_id": "project_1",
    "run_id": "run_1",
    "task_id": "CALL_1"
  }
}
```

### Deliver ask: `POST {COMMUNICATIONS_API_URL}/v1/asks`

```json
{
  "ask_id": "ask_123",
  "ask_token": "token_123",
  "channel": "email",
  "person_id": "person_1",
  "question": "Approve the draft?",
  "response_type": "approval",
  "response_schema": {
    "fields": []
  },
  "reply_to": "ask+token_123@replies.example.com",
  "form_url": "https://hyperflow.example.com/forms/ask/token_123?org=org_1&project=project_1",
  "correlation": {
    "tenant_id": "org_1",
    "project_id": "project_1",
    "task_id": "REPORT_1",
    "run_id": "run_1"
  }
}
```

For SMS and voice asks, the same `ask_id` must be retained as message metadata or voice context. Email delivery should preserve the supplied Reply-To address.

### Read communication: `GET {COMMUNICATIONS_API_URL}/v1/communications/{id}`

All Communications API endpoints may return either the communication object directly or under a `communication` key:

```json
{
  "communication": {
    "id": "comm_123",
    "status": "queued",
    "channel": "sms",
    "output": {}
  }
}
```

Supported status values are `accepted`, `queued`, `ready`, `running`, `in_progress`, `waiting`, `completed`, and `failed`. Every successful response must include a non-empty string `id`.

## Environment variables

| Variable | Used for |
|---|---|
| `GEMINI_API_KEY` | Gemini helper routes and report tasks. |
| `RESEND_API_KEY` | Email helper and email tasks. |
| `COMMUNICATIONS_API_URL` | Base URL for provider-neutral communications. |
| `COMMUNICATIONS_API_KEY` | Outbound bearer token and inbound `/api/events` bearer token. |
| `ASK_REPLY_DOMAIN` | Email ask Reply-To addresses. |
| `PUBLIC_BASE_URL` | Public form URLs and external orchestration context. |
| `WEBHOOK_SECRET` | Authentication for `/api/flow/advance`. |
| `FIREBASE_SERVICE_ACCOUNT` | Privileged server-side Realtime Database access; JSON or base64. |
| `FIREBASE_DATABASE_URL` | Server-side database URL. Must match the browser database. |

Browser Firebase overrides are documented in [`.env.example`](../.env.example).
