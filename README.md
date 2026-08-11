# HyperFlow

HyperFlow is a visual project workflow engine for combining human milestones with automated actions, decisions, loops, and human review gates.

Flows can keep moving without an open browser. Long-running communications enter a durable waiting state, inbound events resolve the exact waiting run, and human responses from web forms, email, SMS, or voice all pass through one canonical ask-response service.

## What it supports

| Capability | Description |
|---|---|
| Milestones | Human-managed work with subtasks and dependencies. |
| Decisions | Select the first branch whose conditions match Project Data. |
| Loops | Repeat a section until exit conditions pass or the iteration limit is reached. |
| Email | Send email through Resend. |
| SMS | Send messages through the provider-neutral Communications API. |
| Phone calls | Start voice calls through the Communications API. |
| Webhooks | Call an external HTTP endpoint. |
| Reports | Generate, evaluate, and revise a report with Gemini. |
| Human asks | Pause work for approval, revision, rejection, missing information, or an upload. |

Action templates support `{{variable}}` substitution from Project Data. Successful action output is merged back into Project Data for downstream decisions and loops.

## Quick start

Requirements: Node.js and npm.

```powershell
npm.cmd install
Copy-Item .env.example .env.local
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000).

Only configure the services used by your workflow. At minimum:

- `GEMINI_API_KEY` for AI project generation and report actions.
- `RESEND_API_KEY` for email actions.
- `COMMUNICATIONS_API_URL` and `COMMUNICATIONS_API_KEY` for SMS, voice, external ask delivery, and inbound events.
- `FIREBASE_SERVICE_ACCOUNT` for server-side flow advancement, asks, and event processing.

See [`.env.example`](./.env.example) for the complete configuration reference.

## Running a flow

- Use **Run Now** on an action node to execute that action directly.
- Use **Advance Flow** to evaluate decisions and loops, run ready auto-execute actions, and raise required review asks.
- A node is ready when its dependencies are resolved and at least one dependency completed. Skipped branches do not block a join.

Communications actions may return `202 Accepted`. HyperFlow records the action as waiting and does not merge its output or unlock downstream nodes until a terminal event arrives at `POST /api/events`.

## Human asks

An ask is a durable, channel-independent request for a person to respond. It carries one `ask_id` and one capability-scoped `ask_token` across web, email, SMS, and voice.

The lifecycle is:

1. Work completes and the flow raises an ask.
2. The ask is delivered through each configured channel.
3. The response arrives through the tokenized form or a Communications API event.
4. [`respondToAsk`](./lib/asks/respondToAsk.ts) normalizes, validates, records, and applies the response.
5. The server advances the flow and delivers any newly raised asks.

Important review behavior:

- Approval belongs to one specific action run and cannot satisfy a later rerun.
- Requesting revision requires a comment; that comment becomes the next run's instruction.
- Ambiguous prose is retained for interpretation but does not release an approval gate.
- An overdue ask continues blocking by default. Automatic approval must be configured explicitly.
- Replaying an answered ask is inert.

The public tokenized ask endpoint is:

```text
GET|POST /forms/ask/{ask_token}?org={org_id}&project={project_id}
```

Vercel rewrites this to the JSON `/api/asks/{ask_token}` handler. A client or the Communications service can use that contract to render a response form. The token authorizes only that ask; it is not a user session credential.

## Architecture

| Layer | Main files | Responsibility |
|---|---|---|
| Flow engine | [`lib/flowEngine.ts`](./lib/flowEngine.ts) | Pure dependency, branch, loop, and readiness decisions. |
| Orchestrator | [`lib/flowOrchestrator.ts`](./lib/flowOrchestrator.ts) | Executes scheduled effects and folds results into project state. |
| Server execution | [`lib/serverExecutor.ts`](./lib/serverExecutor.ts), [`lib/serverFlow.ts`](./lib/serverFlow.ts) | Runs actions and advances persisted projects without a browser. |
| Ask services | [`lib/asks`](./lib/asks) | Creates, delivers, expires, and responds to asks. |
| Communications client | [`lib/communications`](./lib/communications) | Provider-neutral SMS, voice, ask delivery, and status API. |
| Event inbox | [`lib/externalEvents.ts`](./lib/externalEvents.ts), [`lib/serverStore.ts`](./lib/serverStore.ts) | Persist-first, idempotent inbound event processing. |

`external_events/{event_id}` is the durable inbox. Events move through `received`, `processing`, `processed`, or `processing_failed`. The event ID is claimed transactionally, so a processed replay is inert and a failed event remains retryable.

## API documentation

See [docs/API.md](./docs/API.md) for:

- endpoint authentication and status codes;
- complete request and response examples;
- task execution templates;
- the `ask.response.received` event contract;
- terminal communications event correlation;
- the outbound Communications API contract.

## Firebase setup

The browser defaults to the `hyper-flow-a459b` Realtime Database in `asia-southeast1`. Firebase web configuration is public application configuration; authorization is enforced by [`database.rules.json`](./database.rules.json).

Deploy the database rules before using a new environment. The server-side service account is privileged and must remain secret.

To point HyperFlow at another Firebase project, configure the browser variables together:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_APP_ID`

Also set server-side `FIREBASE_DATABASE_URL` to the same database. Browser and server URLs must match or responses can be written to a different project database without an obvious error.

Changing Firebase projects does not migrate existing data.

## Deployment notes

- Set `PUBLIC_BASE_URL` to the deployment's public origin.
- Configure the Communications API to send events to `POST {PUBLIC_BASE_URL}/api/events` with `Authorization: Bearer {COMMUNICATIONS_API_KEY}`.
- Set `ASK_REPLY_DOMAIN` if email asks should use `ask+{ask_token}@domain` Reply-To addresses.
- Deploy [`database.rules.json`](./database.rules.json).
- If Vercel Deployment Protection is enabled, webhook requests may be redirected to interactive login. Use an unprotected custom domain or an appropriate protection bypass.
- External providers cannot reach localhost; use a secure tunnel for local webhook testing.

## Verification

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

The test suite covers flow decisions and loops, waiting action resolution, ask normalization and review gates, provider-neutral communications payloads, event envelopes, Firebase shape handling, and serverless module specifiers.

## Known limitation

The browser still rewrites the complete `projects/{orgId}` collection while server writes are path-scoped. A server update can be overwritten if it lands during an overlapping browser save. Moving the browser persistence path away from whole-document writes is the durable fix.
