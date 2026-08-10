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

## Human review: asks and answers

Any node can carry a **review policy** (node config → Human Review). When required, the node's work is held for a person: the node does not complete, and everything downstream stays blocked, until someone signs it off.

The unit of handover is an **ask**. One object serves approve-this-work, answer-this-question and send-me-a-file, across every channel — so an answer given in the app and an answer texted in at midnight take exactly the same path into project state.

### The review loop

1. The agent finishes its work. The flow raises an ask and stops.
2. The reviewer sees the **actual work product** — reports rendered as markdown, call outcomes as readable text with the recording, anything else as formatted JSON — alongside the agent's own critique of its draft.
3. They **approve**, **request changes**, or **reject**.
4. Requesting changes requires a comment, because *that comment becomes the instruction for the redo*. The node is re-armed, the flow runs it again, and the agent is given the reviewer's words plus the draft they rejected. For report nodes the feedback is stated as binding and takes priority over the model's own self-evaluation.
5. The new draft raises a **fresh** ask showing the previous draft side by side. Sign-off never carries over between attempts.

Reviewers can attach an image, document, video or audio file to any answer.

### Rules the gate enforces

- **An approval belongs to one specific run.** If a node re-runs — a loop iteration, or a redo — earlier sign-off cannot satisfy the new work.
- **A loop iteration cancels prior sign-off** rather than reusing it. The audit trail survives; the approval does not.
- **Ambiguity never releases the gate.** A reply of exactly "no" is a rejection, but *"no problem, looks great"* is not a decision — it is recorded, flagged as needing interpretation, and the ask stays open. Matching command words anywhere inside a sentence is how these systems approve things nobody approved.
- **Silence is not consent.** An overdue ask keeps blocking by default. `auto_approve` exists but has to be chosen explicitly, per node.
- **A skipped branch raises no asks.** Nobody is asked to review work on a path the flow never took.
- **Answers are applied once.** Re-submitting an answered ask is inert, so a double-click or a provider retry cannot overwrite later edits.

### Questions, derived automatically

`evaluateTaskReadiness` already computes exactly which variables a node is missing. `createQuestionAsk` turns that into a question ask whose answer schema is *derived* rather than hand-authored — the node asks for precisely the facts it is blocked on, and the answers write straight back into Project Data.

### Answering from outside the app

`GET`/`POST /api/asks/[token]?org=…&project=…` reads or answers a single ask. The token is a capability scoped to that one ask — it never authenticates a session and never exposes the surrounding project. Answering runs the same `respondToAsk` path the inbound channels use, then advances the flow server-side.

## The Firebase project

The app connects to **`hyper-flow-a459b`** (Realtime Database, `asia-southeast1`)
out of the box — the web config is built in, so the browser side needs no setup.

A Firebase web config is not a secret: it ships to every visitor inside the
bundle however it is supplied, and security comes from `database.rules.json`, not
from hiding it. The **service-account key is a real secret** — it bypasses those
rules entirely — and lives only in `FIREBASE_SERVICE_ACCOUNT`, server-side.

**Deploy `database.rules.json` to the project**, or every read and write is
denied and the app will look broken.

### Pointing at a different project

Set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID` and
`VITE_FIREBASE_DATABASE_URL` together (plus `VITE_FIREBASE_APP_ID` for auth) —
a partial override is ignored rather than merged, so a half-set environment
cannot produce a config straddling two projects. `authDomain` and `storageBucket`
are derived from the project id unless given. Pasting a config into Cloud Setup
overrides everything at runtime.

If you override the browser's database, **also set `FIREBASE_DATABASE_URL`** to
the same value. The two are configured separately, and if they diverge a review
answered in the app and one answered by webhook write to different databases with
no error to tell you.

Switching projects does **not** migrate data — a different Firebase project is a
different, empty database.

### Server-side orchestration setup

Set `PUBLIC_BASE_URL`, `WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_DATABASE_URL` (see `.env.example`). Without them the app still works, but phone calls fall back to browser polling and webhooks are rejected with `server_store_not_configured`.

In local development `PUBLIC_BASE_URL` must be a tunnel (ngrok or similar) — providers cannot reach `localhost`.

**If the project has Vercel Deployment Protection enabled**, inbound webhooks will
be intercepted by an SSO redirect and never reach the handler — a provider's POST
cannot satisfy an interactive login. Either serve the app from a custom domain
(protection exempts those), or turn on **Protection Bypass for Automation** in
project settings. With bypass enabled, Vercel injects
`VERCEL_AUTOMATION_BYPASS_SECRET` at runtime and callback URLs automatically
carry it as a query parameter — the supported route for third-party webhooks that
cannot set custom headers. Nothing to configure beyond generating the secret.

| Endpoint | Purpose |
|---|---|
| `POST /api/tasks/execute` | Runs one action. Injects the callback URL and secret server-side; the browser never sees the secret. |
| `POST /api/inbound/voice/bland` | Bland call-completion webhook. Resolves the pending run and advances the flow. Auth via `?secret=`. |
| `POST /api/flow/advance` | Advances a project server-side. Auth via `x-webhook-secret` header. Body: `{orgId, projectId}`. |
| `GET`/`POST /api/asks/[token]` | Reads or answers one ask. Auth via the ask's own token. |

Inbound events are de-duplicated by provider event id (`webhookEvents/{provider}/{id}`, claimed with a transaction) because every provider retries on non-2xx and on timeout — and replaying an advance can reset loop bodies.

**Known limitation:** the browser client still owns `projects/{orgId}` and rewrites it wholesale on save, and it ignores remote updates landing within 2s of its own write. Server writes are path-scoped to minimise the overlap, but a server write can still be lost if it lands while someone is actively editing the same project. Moving the client off whole-document `set()` is the durable fix.
