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
| Phone calls | Start voice calls through the Communications API and wait for a verified human outcome. |
| Webhooks | Call an external HTTP endpoint. |
| Reports | Generate, evaluate, and revise a report with Gemini. |
| Human asks | Pause work for approval, revision, rejection, missing information, or an upload. |

Action templates support `{{variable}}` substitution from Project Data. Successful action output is merged back into Project Data for downstream decisions and loops.

## Quick start

Requirements: Node.js and npm.

```powershell
npm.cmd install
$env:FIREBASE_SERVICE_ACCOUNT = '<service-account JSON or base64>'
$env:FIREBASE_DATABASE_URL = 'https://<project>-default-rtdb.<region>.firebasedatabase.app'
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000).

Backend credentials must be available as process environment variables; copying `.env.example` does not load it into the local Express process. Configure only the services the workflow uses:

- `GEMINI_API_KEY` for AI project generation and report actions.
- `RESEND_API_KEY` for email actions.
- `COMMUNICATIONS_API_URL` and backend-only `COMMUNICATIONS_API_KEY` for outbound SMS and voice.
- `COMMUNICATIONS_WEBHOOK_SECRET` for signed inbound events.
- `FIREBASE_SERVICE_ACCOUNT` for server-side flow advancement, asks, and event processing.

See [`.env.example`](./.env.example) for the complete configuration reference.

Settings → Communications contains only the non-secret tenant sending number. Communications credentials, webhook secrets, Firebase service-account data, and provider keys remain backend environment variables because Settings is synchronized to Firebase and included in normal backups.

## Running a flow

- Use **Run Now** on an action node to execute that action directly.
- Use **Advance Flow** to evaluate decisions and loops, run ready auto-execute actions, and raise required review asks.
- A node is ready when its dependencies are resolved and at least one dependency completed. Skipped branches do not block a join.

The current Communications Service create endpoints return `201` canonical communication objects without a workflow status. HyperFlow normalizes those responses to `accepted`, returns `202` from `/api/tasks/execute`, and records the action as waiting. It does not merge communication output or unlock downstream nodes until a mapped terminal event arrives at `POST /api/events`.

For voice, Twilio's provider status `completed` is not success. Communications sends `call.completed` only after verifying a meaningful response from the intended human. Voicemail, wrong number, no answer, busy, fax, automated systems, provider failure, and non-meaningful responses arrive as `call.failed`. HyperFlow records the disposition and memory-eligibility flag on the action run, displays a specific failure label, keeps downstream work blocked, and never merges failed-call output into Project Data. Pending actions display as **Waiting**, not failed.

## Human asks

An ask is a durable, channel-independent request for a person to respond. It carries one `ask_id` and one capability-scoped `ask_token` across web, email, SMS, and voice.

The lifecycle is:

1. Work completes and the flow raises an ask.
2. Email asks are delivered through Resend; SMS and voice asks use Communications `/v1/messages` or `/v1/calls` with a `human_ask` purpose.
3. The response arrives through the tokenized form or an eligible Communications API event. A failed voice call does not count as a response.
4. [`respondToAsk`](./lib/asks/respondToAsk.ts) normalizes, validates, records, and applies the response.
5. HyperFlow applies an accepted response in memory, advances the flow, attempts newly raised Ask deliveries, and persists the resulting project state.
6. If the accepted response came from Communications, HyperFlow then calls `/v1/asks/{ask_id}/resolve` with that response's `communication_id`.

Important review behavior:

- Approval belongs to one specific action run and cannot satisfy a later rerun.
- Requesting revision requires a comment; that comment becomes the next run's instruction.
- Ambiguous prose is retained for interpretation but does not release an approval gate.
- An overdue ask continues blocking by default. Automatic approval must be configured explicitly.
- Replaying an answered ask does not record or apply a second response. For a Communications replay carrying the same locally recorded `communication_id`, HyperFlow can retry the remote Ask-resolution acknowledgement.

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
| Communications client | [`lib/communications`](./lib/communications) | Current Communications Service SMS, voice, Ask-resolution, and signed-event contracts. |
| Event inbox | [`lib/externalEvents.ts`](./lib/externalEvents.ts), [`lib/serverStore.ts`](./lib/serverStore.ts) | Persist-first, idempotent inbound event processing with fail-closed call outcomes. |
| Run outcome UI | [`lib/actionRunPresentation.ts`](./lib/actionRunPresentation.ts) | Human-readable waiting/success/failure labels and durable voice outcome fields. |

`external_events/{event_id}` is the durable inbox. Events move through `received`, `processing`, `processed`, or `processing_failed`. The event ID is claimed transactionally, so a processed replay is inert and a failed event can be claimed again when Communications retries the same event ID.

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
- In Settings → Communications, set the tenant's E.164 sending number. This value is not a secret; API keys are never stored in app settings.
- Set `COMMUNICATIONS_API_KEY` to the Communications Service `API_KEY`; HyperFlow sends it as `X-API-Key`.
- Set the same HMAC secret as `COMMUNICATIONS_WEBHOOK_SECRET` in both deployments, and configure Communications to send events to `POST {PUBLIC_BASE_URL}/api/events`. HyperFlow verifies `X-Communications-Signature` over the raw body.
- Set `ASK_REPLY_DOMAIN` if email asks should use `ask+{ask_token}@domain` Reply-To addresses.
- Deploy [`database.rules.json`](./database.rules.json).
- If Vercel Deployment Protection is enabled, webhook requests may be redirected to interactive login. Use an unprotected custom domain or an appropriate protection bypass.
- External providers cannot reach localhost; use a secure tunnel for local webhook testing.

For ordinary SMS and call action nodes, sender selection is: template `from`, Project Data `communications_from_number`, tenant Settings, then `COMMUNICATIONS_FROM_NUMBER`. For SMS/voice asks it is: Project Data, tenant Settings, then the environment fallback. Recipient identities may be supplied directly as an E.164 number/email address or resolved by an exact team-member setting; missing, invalid, or ambiguous identities fail closed.

## Verification

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

The test suite covers flow decisions and loops, waiting action resolution, voicemail/wrong-number failure presentation, failed-output isolation, ask normalization and review gates, current Communications Service fixtures and HMAC behavior, event envelopes, Firebase shape handling, and serverless module specifiers.

## Known limitation

The browser still rewrites the complete `projects/{orgId}` collection while server writes are path-scoped. A server update can be overwritten if it lands during an overlapping browser save. Moving the browser persistence path away from whole-document writes is the durable fix.

Communications currently returns a generic `409` when an Ask is already resolved and does not return the existing resolving `communication_id`. HyperFlow therefore treats a `409` as an idempotent acknowledgement only after its own canonical Ask response is already recorded against the event's communication ID; it cannot independently prove that Communications resolved the Ask with the same communication. Operators should investigate cross-system disagreement rather than assuming every `409` proves an exact match.
