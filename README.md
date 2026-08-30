# HyperFlow

HyperFlow is a visual workflow engine for projects that combine human milestones, automated actions, decisions, loops, and review gates. Server-side execution and durable schedules let flows continue without an open browser, while signed event handling reconnects email, SMS, and voice results to the exact tenant, action run, and Human Ask that started them.

## Capabilities

| Capability | Current behavior |
|---|---|
| Milestones | Human-managed work with subtasks and dependencies. |
| Decisions and loops | Branch from Project Data and repeat sections until an exit condition or iteration limit is reached. |
| Email | Connect Gmail for cursor-safe sync and provider-native drafts, or send through a separately provisioned Communications service identity. Connected Gmail never exposes a send operation. Outlook is not implemented. |
| SMS and voice | Dispatch through the provider-neutral Communications Service, wait for signed terminal outcomes, and triage eligible inbound replies. |
| Webhooks | Call public HTTPS/443 endpoints with DNS, redirect, timeout, and response-size protections. |
| Reports | Generate, evaluate, and revise reports with Gemini. |
| Human Asks | Pause a run for approval, rejection, revision, information, or an upload; collect responses by web form, email, SMS, or voice. |
| Communications triage | Classify connected-mailbox email, prepare safe Gmail drafts, publish an idempotent daily digest, and review inbound email/SMS/voice or proposed coaching actions in one tenant-scoped inbox. |
| Daily Coaching | Read an allowlisted Google Doc and Sheet, place a correlated coaching call, exclude failed/voicemail outcomes, extract a typed result, and append one idempotent tracker row. |
| Omnichannel project agent | Route trusted inbound email, SMS, and completed voice conversations to an allowed project; answer bounded read-only questions, ask for project clarification, or hold typed mutations for authenticated approval. |
| Durable schedules | Run tenant-local `communications_triage` or `flow_start` occurrences with leases, occurrence idempotency, retry windows, and misfire policy. |
| Google Workspace | Store encrypted tenant OAuth credentials server-side and constrain Doc/Sheet actions to project-specific resource grants. |

Action templates can use `{{variable}}` placeholders from Project Data. Successful synchronous output is merged back into Project Data for later decisions and loops.

## Local development

Requirements: Node.js and npm.

```powershell
npm.cmd install
$env:FIREBASE_SERVICE_ACCOUNT = '<service-account JSON or base64>'
$env:FIREBASE_DATABASE_URL = 'https://<project>-default-rtdb.<region>.firebasedatabase.app'
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000).

The Express development server reads process environment variables; it does not automatically load a copied `.env.example` file. Configure only the integrations you use, and see [`.env.example`](./.env.example) for the complete variable list.

## Backend configuration

| Integration | Required backend variables |
|---|---|
| Firebase server access | `FIREBASE_SERVICE_ACCOUNT`; `FIREBASE_DATABASE_URL` when overriding the default database. |
| Ask file uploads | `FIREBASE_STORAGE_BUCKET` in addition to Firebase server access. |
| Gemini | `GEMINI_API_KEY` for generation, reports, and optional ambiguous-response interpretation. |
| Communications Service | `COMMUNICATIONS_API_URL`, `COMMUNICATIONS_API_KEY`, `COMMUNICATIONS_WEBHOOK_SECRET`, `PUBLIC_BASE_URL`; set `COMMUNICATIONS_REQUIRE_SIGNATURE_V2=true` explicitly in production; optional `COMMUNICATIONS_FROM_NUMBER`, `COMMUNICATIONS_EMAIL_IDENTITY`, `COMMUNICATIONS_CONNECTION_ID`, and `COMMUNICATIONS_INTENT_MODEL`. |
| Google Workspace | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_STATE_SECRET`, `INTEGRATION_ENCRYPTION_KEY`; optional `GOOGLE_OAUTH_REDIRECT_URI` (defaults from `PUBLIC_BASE_URL`). |
| Durable schedule timer | `CRON_SECRET` for Vercel Cron; optional `SCHEDULER_SECRET` for another timer caller. |
| Server-triggered flow advancement | `WEBHOOK_SECRET`. |
| Webhook action allowlist | Optional comma-separated `WEBHOOK_ALLOWED_HOSTS`. |

Settings stores only non-secret tenant routing, resource grants, and policy: service identities, an opaque connected-mailbox ID, an opaque Google Workspace connection ID, allowed projects/actions, timezone, triage/send policy, schedules, and selected Doc/Sheet range. Leave the reply-to override empty to let Communications generate its opaque thread reply route. API keys, webhook secrets, scheduler secrets, OAuth client secrets/tokens, encryption keys, Firebase service-account data, and provider credentials remain backend environment variables. Never place them in app settings, Project Data, or `VITE_*` variables.

## Configure the two daily services

1. In **Settings > Agent & Connections**, select the stable primary Communications person, grant that person only the projects they may use, then save the default project, channel identities, and action permissions. Inbound people fail closed until a primary person or explicit grants are configured; once any person grants exist, unlisted people are denied.
2. Connect Gmail. Communications Service owns the encrypted mailbox credential; HyperFlow saves only the returned mailbox reference. Gmail replies and agent responses are drafts by default and cannot be sent through the connected-mailbox API.
3. Create a **Daily Email Triage** project, select **Email triage reconciliation**, choose the local time/timezone and digest channel, then create the schedule. Web digests appear at the top of Communications triage. Connected Gmail email digests become drafts; automatic SMS or transactional email requires `automatic` send policy plus `send_reply` permission.
4. Connect Google Workspace, create a **Daily Coaching** project, allowlist its source Doc and tracker Sheet/range, set `contact_phone`, then create a `flow_start` schedule with the required local time/timezone.
5. Call `POST /api/schedules/tick` at least every five minutes. The checked-in Hobby cron is only a daily fallback and cannot reliably honor arbitrary local times, agent inbox work, or 30-minute call retries.

Inbound messages are persisted before routing. Trusted correlation wins, then an explicit project name, active thread, configured default, or the sole visible project; ambiguity produces a clarification. Read-only replies can be delivered automatically only under channel policy and a durable per-thread limit of one every 15 seconds and six per hour. Coaching commitments, next actions, and requested calls appear as typed proposals in Communications triage and execute only after an authenticated reviewer clicks **Approve action**. Sheet updates use an idempotent action receipt; requested calls use a stable one-off schedule occurrence.

Inbound voice now uses the same router before project context is exposed. Communications derives the tenant from the dialled number, resolves the stable person, and makes a timestamped HMAC request to `/api/agent/voice-context`. HyperFlow returns either one authorized project's bounded facts or a project clarification. The call can use `select_hyperflow_project` to select or switch projects; unscoped communication history and unrelated tools are withheld. If tenant/person resolution or the signed context request fails, the call receives a safe unavailable response rather than a default project prompt.

For ordinary SMS and call actions, the sending number is selected from the action template, Project Data `communications_from_number`, tenant Settings, then `COMMUNICATIONS_FROM_NUMBER`. Ask delivery uses the tenant email identity/connection or sending number, with the documented environment fallbacks when applicable.

The two deployments must agree on these values:

| HyperFlow | Communications Service | Requirement |
|---|---|---|
| `COMMUNICATIONS_API_URL` | Public service origin | For the current deployment, `https://communications-service.replit.app` with no `/v1` suffix. |
| `COMMUNICATIONS_API_KEY` | `API_KEY`, or a tenant-scoped API credential | The value used by HyperFlow's backend must authenticate the same tenant sent in `X-Tenant-Id`. |
| `COMMUNICATIONS_WEBHOOK_SECRET` | `COMMUNICATIONS_WEBHOOK_SECRET` | Identical HMAC secret in both deployments. |
| `{PUBLIC_BASE_URL}/api/events` | `HYPERFLOW_EVENT_URL` | Exact fallback event URL; `/api/communications/events` is not a HyperFlow route. Per-request `callback_url` takes precedence. |
| `{PUBLIC_BASE_URL}/api/agent/voice-context` | `HYPERFLOW_AGENT_CONTEXT_URL` | Signed live inbound-voice project context endpoint. Communications may derive it from `HYPERFLOW_EVENT_URL`, but explicit configuration is clearer. |

`PUBLIC_BASE_URL` must be the externally reachable HTTPS production origin, not localhost, a generated preview/deployment URL, or the Communications Service URL. `/api/agent/voice-context` is rewritten to the same event function as `/api/events`. First probe both routes anonymously: an application JSON `401` proves the request reached HyperFlow, whereas a login redirect or Vercel protection page means the origin is blocked. Only for a blocked origin, copy the generated Vercel automation-bypass secret into Communications as backend-only `HYPERFLOW_VERCEL_AUTOMATION_BYPASS_SECRET`; it sends the recommended header only to the exact configured HyperFlow origin.

## Flow execution

- **Run Now** executes one action directly.
- **Advance Flow** evaluates ready work, decisions, and loops; runs auto-execute actions; and raises required Asks.
- Email actions finish in HyperFlow when Communications accepts the outbound email. Provider delivery, failure, and a later reply are separate durable events. Webhook and report actions also finish synchronously.
- SMS and voice actions normally return `202`, remain waiting, and release downstream work only after a signed terminal event reaches `POST /api/events`.
- `sms.delivered` confirms carrier delivery and completes the SMS action; it does not mean the recipient replied. A later inbound SMS is a separate `communication.received` event.

For voice, Twilio's provider status `completed` is not success. Communications sends `call.completed` only after verifying a meaningful response from the intended human. Voicemail, wrong number, no answer, busy, fax, automated systems, provider failure, and non-meaningful responses arrive as `call.failed`. HyperFlow records the disposition and memory-eligibility flag on the action run, displays a specific failure label, keeps downstream work blocked, and never merges failed-call output into Project Data. Pending actions display as **Waiting**, not failed.

Every outbound SMS or call carries:

- `X-API-Key` authentication;
- a deterministic `Idempotency-Key` derived from the tenant, project, run, task, channel, and Ask identity;
- `tenant_id`, `external_project_id`, `run_id`, and `task_id` correlation;
- an HTTPS callback URL derived from `PUBLIC_BASE_URL`.

## Human Asks

HyperFlow maintains one canonical Ask and creates recipient/channel-specific delivery IDs and tokens. All accepted responses pass through the same `respondToAsk` service, which validates the response, records it, applies the result, advances the flow, delivers any newly raised Asks, and saves the project.

Email, SMS, and voice Asks are delivered through Communications with a `human_ask` purpose and tenant correlation. Failed voice calls, voicemail, wrong numbers, bounces, spam, and automatic email replies never count as human responses or enter workflow memory.

The event type determines what HyperFlow may do:

- `communication.received` is the canonical event for an ordinary inbound email or SMS. HyperFlow records tenant-scoped triage evidence; it does not resolve an Ask, complete a waiting action, or merge reply text into Project Data. `sms.received` remains accepted as a legacy alias.
- `ask.response.received` is emitted only for a response correlated to a `human_ask`. It enters `respondToAsk`, which may resolve the Ask immediately or hold an uncertain interpretation for review.
- Eligible communication text is enriched into Communications Service memory asynchronously. HyperFlow's triage `memoryEligible` flag describes eligibility; it is not itself proof that the service-side enrichment job completed.

The public form URL is:

```text
GET|POST /forms/ask/{token}?org={orgId}&project={projectId}
```

Vercel rewrites this path to `/api/asks/{token}`. Browser navigation receives a rendered, escaped artifact and response form; JSON clients receive a sanitized Ask representation. Declared file fields accept at most three allowlisted files of 2 MB each. Upload bytes are written through Firebase Admin to an Ask-scoped private path, and caller-supplied attachment URLs or actor identities are ignored. The token authorizes only that Ask and is not a user session credential.

Review policies support the first valid response (`any`), approval from every assigned reviewer (`all`), or a configured approval count (`quorum`). For `all` and `quorum`, only verified assigned identities count, and an assigned rejection or revision request vetoes approval.

Email, SMS, and voice response events are evidence, not automatic resolution. `respondToAsk` is the sole response entry point. Deterministic interpretation runs first; uncertain prose is held for review in Communications triage, and accepting that review replaces the provisional interpretation rather than adding a duplicate response. HyperFlow durably acknowledges accepted answers through `POST /v1/asks/{deliveryAskId}/resolve`.

| Layer | Main files | Responsibility |
|---|---|---|
| Flow engine | [`lib/flowEngine.ts`](./lib/flowEngine.ts) | Pure dependency, branch, loop, and readiness decisions. |
| Orchestrator | [`lib/flowOrchestrator.ts`](./lib/flowOrchestrator.ts) | Executes scheduled effects and folds results into project state. |
| Server execution | [`lib/serverExecutor.ts`](./lib/serverExecutor.ts), [`lib/serverFlow.ts`](./lib/serverFlow.ts) | Runs actions and advances persisted projects without a browser. |
| Ask services | [`lib/asks`](./lib/asks) | Creates, delivers, expires, and responds to asks. |
| Communications client | [`lib/communications`](./lib/communications) | Tenant-scoped email, SMS, voice, thread, triage, Ask-resolution, and signed-event contracts. |
| Event inbox | [`lib/externalEvents.ts`](./lib/externalEvents.ts), [`lib/serverStore.ts`](./lib/serverStore.ts) | Persist-first, tenant-scoped event processing, delivery state, triage projection, and fail-closed outcomes. |
| Scheduler | [`lib/scheduler.ts`](./lib/scheduler.ts) | Leased typed occurrences, cursor-safe mailbox reconciliation, daily digests, sparse agent work, and coaching retry claims. |
| Agent router | [`lib/agentRouter.ts`](./lib/agentRouter.ts) | Tenant/person/project selection, bounded read-only answers, connected-mailbox drafts, and reviewed coaching proposals. |
| Google integration | [`lib/integrations`](./lib/integrations) | Encrypted OAuth credentials plus allowlisted Doc read and idempotent Sheet read/append/upsert operations. |
| Run outcome UI | [`lib/actionRunPresentation.ts`](./lib/actionRunPresentation.ts) | Human-readable waiting/success/failure labels and durable voice outcome fields. |

## Firebase authorization and migration

Browser access to tenant projects is authorized by `organizations/{orgId}/members/{uid}`. Browser clients cannot write user profiles, organizations, memberships, or invites; the backend creates those records after verifying Firebase ID tokens.

Before deploying the membership-based [`database.rules.json`](./database.rules.json) over a legacy database, audit and migrate existing assignments:

```powershell
npm.cmd run migrate:memberships
npm.cmd run migrate:memberships -- --apply
```

The first command is a dry run. Review it before using `--apply`, and apply the migration before deploying the new rules.

When changing Firebase projects, configure the browser variables as one set and point server-side `FIREBASE_DATABASE_URL` at the same Realtime Database. Changing configuration does not migrate existing data.

## Deployment checklist

1. Configure the backend variables required by the enabled integrations.
2. Set `PUBLIC_BASE_URL` to the public HTTPS origin.
3. Set Communications `HYPERFLOW_EVENT_URL` to exactly `{PUBLIC_BASE_URL}/api/events`, set `HYPERFLOW_AGENT_CONTEXT_URL` to `{PUBLIC_BASE_URL}/api/agent/voice-context`, and use the same `COMMUNICATIONS_WEBHOOK_SECRET` in both services. HyperFlow also sends the event URL per request as `callback_url`.
4. In Settings > Communications, select the tenant's email service identity and provider connection; set the phone number when SMS or voice is enabled.
5. Configure `CRON_SECRET` for the daily Vercel Hobby-compatible fallback. For production omnichannel operation, use a Vercel plan that supports a five-minute cron or call `POST /api/schedules/tick` every five minutes from an external timer with `SCHEDULER_SECRET`.
6. Run and review the membership migration before deploying updated Firebase rules to a legacy database.
7. Deploy [`database.rules.json`](./database.rules.json); operational event, triage/digest, sparse worker indexes, schedule, cursor, delivery, integration, coaching, and resolution trees are backend-only.

External services cannot call localhost. Use a secure public tunnel for local callback testing. If deployment protection redirects webhook requests to login, expose an unprotected webhook origin or configure the host's supported protection bypass.

For a full channel check, verify each boundary independently: the outbound create returns a canonical `comm_*` ID; the provider reaches a terminal status; Communications delivers the matching `evt_*` callback to HyperFlow; and any human reply creates a new inbound communication. An ordinary SMS/email reply should appear in triage when admitted by the tenant's triage policy and, when eligible, complete Communications memory enrichment. Only a reply carrying `human_ask` correlation should progress an Ask through `respondToAsk`.

## Verification

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=moderate
```

The test suite covers flow decisions and loops, waiting action resolution, voicemail/wrong-number failure presentation, failed-output isolation, Ask normalization and review gates, tenant-scoped email/SMS/voice contracts, conservative intent interpretation, triage projection, durable cursor semantics, HMAC behavior, Firebase shape handling, and serverless module specifiers.

Firebase rules tests additionally require Java:

```powershell
npm.cmd run test:rules
```

## API reference

See [docs/API.md](./docs/API.md) for endpoint authentication, request and response contracts, event handling, and the outbound Communications Service integration. Use [docs/OMNICHANNEL_OPERATIONS.md](./docs/OMNICHANNEL_OPERATIONS.md) for deployment order, tenant onboarding, callback smoke testing, scheduler setup, controlled live acceptance, and recovery drills.
