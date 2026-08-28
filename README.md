# HyperFlow

HyperFlow is a visual workflow engine for projects that combine human milestones, automated actions, decisions, loops, and review gates. Server-side execution and durable schedules let flows continue without an open browser, while signed event handling reconnects email, SMS, and voice results to the exact tenant, action run, and Human Ask that started them.

## Capabilities

| Capability | Current behavior |
|---|---|
| Milestones | Human-managed work with subtasks and dependencies. |
| Decisions and loops | Branch from Project Data and repeat sections until an exit condition or iteration limit is reached. |
| Email | Send and receive through the tenant-scoped Communications Service; triage inbound mail and correlate later replies to workflows. |
| SMS and voice | Start work through the provider-neutral Communications Service and wait for signed terminal events. |
| Webhooks | Call public HTTPS/443 endpoints with DNS, redirect, timeout, and response-size protections. |
| Reports | Generate, evaluate, and revise reports with Gemini. |
| Human Asks | Pause a run for approval, rejection, revision, information, or an upload; collect responses by web form, email, SMS, or voice. |
| Communications triage | Review human inbound email, linked Ask responses, automatic-message exclusions, and delivery failures in one tenant-scoped inbox. |
| Durable schedules | Reconcile inbound communications from a committed cursor without relying on an open browser. |

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
| Gemini | `GEMINI_API_KEY` for generation, reports, and optional ambiguous-response interpretation. |
| Communications Service | `COMMUNICATIONS_API_URL`, `COMMUNICATIONS_API_KEY`, `COMMUNICATIONS_WEBHOOK_SECRET`, `PUBLIC_BASE_URL`; optional `COMMUNICATIONS_FROM_NUMBER` and `COMMUNICATIONS_INTENT_MODEL`. |
| Durable schedule timer | `CRON_SECRET` for Vercel Cron; optional `SCHEDULER_SECRET` for another timer caller. |
| Server-triggered flow advancement | `WEBHOOK_SECRET`. |
| Webhook action allowlist | Optional comma-separated `WEBHOOK_ALLOWED_HOSTS`. |

Settings > Communications stores non-secret tenant routing and policy: the E.164 sending number, Communications provider connection UUID, outbound email service-identity UUID, optional reply-to override, timezone, triage policy, send policy, and allowed automatic actions. Leave the reply-to override empty to let Communications generate its opaque thread reply route. API keys, webhook secrets, scheduler secrets, Firebase service-account data, and provider credentials remain backend environment variables. Never place them in app settings, Project Data, or `VITE_*` variables.

For ordinary SMS and call actions, the sending number is selected from the action template, Project Data `communications_from_number`, tenant Settings, then `COMMUNICATIONS_FROM_NUMBER`. Ask delivery uses the tenant email identity/connection or sending number, with the documented environment fallbacks when applicable.

## Flow execution

- **Run Now** executes one action directly.
- **Advance Flow** evaluates ready work, decisions, and loops; runs auto-execute actions; and raises required Asks.
- Email actions are accepted by Communications and finish the delivery action synchronously; inbound replies are separate durable events. Webhook and report actions also finish synchronously.
- SMS and voice actions normally return `202`, remain waiting, and release downstream work only after a signed terminal event reaches `POST /api/events`.

For voice, Twilio's provider status `completed` is not success. Communications sends `call.completed` only after verifying a meaningful response from the intended human. Voicemail, wrong number, no answer, busy, fax, automated systems, provider failure, and non-meaningful responses arrive as `call.failed`. HyperFlow records the disposition and memory-eligibility flag on the action run, displays a specific failure label, keeps downstream work blocked, and never merges failed-call output into Project Data. Pending actions display as **Waiting**, not failed.

Every outbound SMS or call carries:

- `X-API-Key` authentication;
- a deterministic `Idempotency-Key` derived from the tenant, project, run, task, channel, and Ask identity;
- `tenant_id`, `external_project_id`, `run_id`, and `task_id` correlation;
- an HTTPS callback URL derived from `PUBLIC_BASE_URL`.

## Human Asks

HyperFlow maintains one canonical Ask and creates recipient/channel-specific delivery IDs and tokens. All accepted responses pass through the same `respondToAsk` service, which validates the response, records it, applies the result, advances the flow, delivers any newly raised Asks, and saves the project.

Email, SMS, and voice Asks are delivered through Communications with a `human_ask` purpose and tenant correlation. Failed voice calls, voicemail, wrong numbers, bounces, spam, and automatic email replies never count as human responses or enter workflow memory.

The public form URL is:

```text
GET|POST /forms/ask/{token}?org={orgId}&project={projectId}
```

Vercel rewrites this path to `/api/asks/{token}`. Browser navigation receives a rendered form; JSON clients receive a sanitized Ask representation. The token authorizes only that Ask and is not a user session credential.

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
| Scheduler | [`lib/scheduler.ts`](./lib/scheduler.ts) | Leased schedule occurrences and cursor-safe inbound email reconciliation. |
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
3. Configure Communications to send durable events to `POST {PUBLIC_BASE_URL}/api/events` and use the same `COMMUNICATIONS_WEBHOOK_SECRET` in both services.
4. In Settings > Communications, select the tenant's email service identity and provider connection; set the phone number when SMS or voice is enabled.
5. Configure `CRON_SECRET` and ensure the Vercel hourly cron can call `GET /api/schedules/tick` (hourly cron requires a plan that supports hourly schedules).
6. Run and review the membership migration before deploying updated Firebase rules to a legacy database.
7. Deploy [`database.rules.json`](./database.rules.json); operational event, triage, schedule, cursor, delivery, and resolution trees are backend-only.

External services cannot call localhost. Use a secure public tunnel for local callback testing. If deployment protection redirects webhook requests to login, expose an unprotected webhook origin or configure the host's supported protection bypass.

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

See [docs/API.md](./docs/API.md) for endpoint authentication, request and response contracts, event handling, and the outbound Communications Service integration.
