# HyperFlow

HyperFlow is a visual workflow engine for projects that combine human milestones, automated actions, decisions, loops, and review gates. Server-side execution lets flows continue without an open browser, while durable event handling reconnects asynchronous SMS and voice results to the exact action run that started them.

## Capabilities

| Capability | Current behavior |
|---|---|
| Milestones | Human-managed work with subtasks and dependencies. |
| Decisions and loops | Branch from Project Data and repeat sections until an exit condition or iteration limit is reached. |
| Email | Send through Resend. |
| SMS and voice | Start work through the provider-neutral Communications Service and wait for signed terminal events. |
| Webhooks | Call public HTTPS/443 endpoints with DNS, redirect, timeout, and response-size protections. |
| Reports | Generate, evaluate, and revise reports with Gemini. |
| Human Asks | Pause a run for approval, rejection, revision, information, or an upload; collect responses by web form, SMS, or voice. |

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
| Gemini | `GEMINI_API_KEY`. |
| Resend | `RESEND_API_KEY`; optional `RESEND_FROM_EMAIL`. |
| Communications Service | `COMMUNICATIONS_API_URL`, `COMMUNICATIONS_API_KEY`, `COMMUNICATIONS_WEBHOOK_SECRET`, `PUBLIC_BASE_URL`; optional `COMMUNICATIONS_FROM_NUMBER`. |
| Server-triggered flow advancement | `WEBHOOK_SECRET`. |
| Webhook action allowlist | Optional comma-separated `WEBHOOK_ALLOWED_HOSTS`. |

Settings > Communications stores only the tenant's non-secret E.164 sending number. API keys, webhook secrets, Firebase service-account data, and provider credentials must remain backend environment variables. Never place them in app settings, Project Data, or `VITE_*` variables.

For ordinary SMS and call actions, the sending number is selected from the action template, Project Data `communications_from_number`, tenant Settings, then `COMMUNICATIONS_FROM_NUMBER`. SMS and voice Asks use Project Data, tenant Settings, then the environment fallback.

## Flow execution

- **Run Now** executes one action directly.
- **Advance Flow** evaluates ready work, decisions, and loops; runs auto-execute actions; and raises required Asks.
- Email, webhook, and report actions finish synchronously.
- SMS and voice actions normally return `202`, remain waiting, and release downstream work only after a signed terminal event reaches `POST /api/events`.

Every outbound SMS or call carries:

- `X-API-Key` authentication;
- a deterministic `Idempotency-Key` derived from the tenant, project, run, task, channel, and Ask identity;
- `tenant_id`, `external_project_id`, `run_id`, and `task_id` correlation;
- an HTTPS callback URL derived from `PUBLIC_BASE_URL`.

## Human Asks

HyperFlow maintains one canonical Ask and creates recipient/channel-specific delivery IDs and tokens. All accepted responses pass through the same `respondToAsk` service, which validates the response, records it, applies the result, advances the flow, delivers any newly raised Asks, and saves the project.

The public form URL is:

```text
GET|POST /forms/ask/{token}?org={orgId}&project={projectId}
```

Vercel rewrites this path to `/api/asks/{token}`. Browser navigation receives a rendered form; JSON clients receive a sanitized Ask representation. The token authorizes only that Ask and is not a user session credential.

Review policies support the first valid response (`any`), approval from every assigned reviewer (`all`), or a configured approval count (`quorum`). For `all` and `quorum`, only verified assigned identities count, and an assigned rejection or revision request vetoes approval.

SMS and voice response events are evidence, not automatic resolution. HyperFlow first records the canonical response, then durably acknowledges it through `POST /v1/asks/{deliveryAskId}/resolve`. Identical acknowledgements are safe to replay; a Communications `409` is treated as a real conflict.

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
4. Set the tenant sending number in Settings > Communications or provide `COMMUNICATIONS_FROM_NUMBER` as a fallback.
5. Run and review the membership migration before deploying updated Firebase rules to a legacy database.
6. Deploy [`database.rules.json`](./database.rules.json).

External services cannot call localhost. Use a secure public tunnel for local callback testing. If deployment protection redirects webhook requests to login, expose an unprotected webhook origin or configure the host's supported protection bypass.

## Verification

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev --audit-level=moderate
```

Firebase rules tests additionally require Java:

```powershell
npm.cmd run test:rules
```

## API reference

See [docs/API.md](./docs/API.md) for endpoint authentication, request and response contracts, event handling, and the outbound Communications Service integration.
