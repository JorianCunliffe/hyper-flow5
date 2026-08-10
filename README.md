# HyperFlow (ProjectFlow)

Project management on a visual flow canvas: projects are a graph of nodes (linked via dependencies), combining human milestones with automated actions, decisions, and loops.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and fill in the keys you need:
   - `GEMINI_API_KEY` — AI project generation, brainstorming, report nodes
   - `RESEND_API_KEY` — email nodes / task emails
   - `BLAND_API_KEY` — AI phone call nodes
   - `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` — SMS nodes (leave blank for stub mode, which logs instead of sending)
3. Run the app: `npm run dev` (http://localhost:3000)

## Node Types

Every node on the project map has a type (hover a node → gear button → Node Configuration). The default is **Milestone**; the others make the flow executable:

| Type | What it does |
|---|---|
| **Milestone** | Standard milestone with subtasks. Complete when all subtasks are complete. |
| **Decision** | Branches the flow. Each outgoing link is a branch with a label and conditions checked against Project Data (e.g. `[{"variable": "proposal_interest", "equals": true}]`). First matching branch wins; a branch with no conditions is the default. Unselected branches are skipped. |
| **Loop** | Repeats a section. Pick a "loop back to" node, exit conditions, and max iterations. When reached without the exit conditions met, everything between the start node and the loop resets and runs again. |
| **Email** | Sends an email via Resend. Template: `{"to", "subject", "body"}`. |
| **SMS** | Sends an SMS via Twilio (or stub mode without credentials). Template: `{"to", "body"}`. |
| **Phone Call** | Places an AI voice call via Bland AI. Template: `{"to", "prompt"}`. |
| **Webhook** | Calls an external HTTP endpoint. Template: `{"url", "method", "headers", "payload"}`. |
| **Report** | Generates a report with Gemini (draft → evaluate → revise). Template: `{"prompt", "sop", "template", "eval_criteria"}`. |

Action templates support `{{variable}}` substitution from Project Data. On success, an action's output is merged back into Project Data, so downstream decisions and loops can branch on it (e.g. `sms_sent`, `webhook_status`).

### Running the flow

- **Run Now** — hover an action node and press the green play button (or use the config modal).
- **Advance Flow** (toolbar) — evaluates ready decision nodes, iterates/exits ready loop nodes, and runs any ready action nodes marked **auto-execute**. A node is ready when all its dependencies are resolved and at least one completed (skipped branches don't block joins).

## Architecture: engine, orchestrator, executors

Three layers, deliberately separated so a flow advances identically whether a person clicked a button or a webhook arrived:

| Layer | File | Responsibility |
|---|---|---|
| **Engine** | `lib/flowEngine.ts` | Pure. Decides *what* should happen next — which branch wins, which loops iterate, which actions are ready. No I/O. |
| **Orchestrator** | `lib/flowOrchestrator.ts` | Performs the effects and folds results back into the project. Takes an injected executor, so it runs in either environment. |
| **Executor** | browser / `lib/serverFlow.ts` | Actually runs an action. The browser POSTs to `/api/tasks/execute`; the server calls `executeTask()` in-process. |

`npm test` covers the engine and orchestrator (no network, no Firebase).

### Asynchronous actions and the pending state

Some actions finish long after they're dispatched — a phone call is placed, then a human talks for two minutes. Those record a **pending** `ActionRun`:

- a pending run does **not** complete the node, so downstream nodes stay blocked
- its output is **not** merged into Project Data until it resolves
- the flow will not re-dispatch it on a later advance

When the provider calls back, the pending run resolves, its output merges into Project Data, and the flow advances from the server — **no browser required**. This is what makes a human answering by phone (and, later, email or SMS) actually move the workflow.

### Server-side orchestration setup

Set `PUBLIC_BASE_URL`, `WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_DATABASE_URL` (see `.env.example`). Without them the app still works, but phone calls fall back to browser polling and webhooks are rejected with `server_store_not_configured`.

In local development `PUBLIC_BASE_URL` must be a tunnel (ngrok or similar) — providers cannot reach `localhost`.

| Endpoint | Purpose |
|---|---|
| `POST /api/tasks/execute` | Runs one action. Injects the callback URL and secret server-side; the browser never sees the secret. |
| `POST /api/inbound/voice/bland` | Bland call-completion webhook. Resolves the pending run and advances the flow. Auth via `?secret=`. |
| `POST /api/flow/advance` | Advances a project server-side. Auth via `x-webhook-secret` header. Body: `{orgId, projectId}`. |

Inbound events are de-duplicated by provider event id (`webhookEvents/{provider}/{id}`, claimed with a transaction) because every provider retries on non-2xx and on timeout — and replaying an advance can reset loop bodies.

**Known limitation:** the browser client still owns `projects/{orgId}` and rewrites it wholesale on save, and it ignores remote updates landing within 2s of its own write. Server writes are path-scoped to minimise the overlap, but a server write can still be lost if it lands while someone is actively editing the same project. Moving the client off whole-document `set()` is the durable fix.
