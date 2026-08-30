# HyperFlow Omnichannel Agent Service

Status: implementation specification  
Date: 2026-08-30  
Scope: HyperFlow 5 and Communications Service

## 1. Decision and current readiness

The source implementation now covers the two scheduled services and the safe email/SMS agent path, but production readiness still requires deployment configuration and live acceptance evidence.

Implemented in the repositories:

- tenant-scoped projects, typed `communications_triage` and `flow_start` schedules, occurrence idempotency, leases, misfire policy, sparse agent/retry indexes, and coaching retry windows;
- Communications-owned Gmail OAuth, encrypted mailbox credentials, watch/history reconciliation, canonical ingestion, and provider-native draft creation with no connected-mailbox send route;
- HyperFlow-owned encrypted Google Workspace OAuth, tenant/project resource grants, bounded Doc/Sheet reads, and idempotent Sheet append receipts;
- Daily Email Triage and Daily Coaching project templates, typed coaching extraction, conditional review, failed-call exclusion, and one-row tracker updates;
- persist-first omnichannel routing for eligible inbound email, SMS, and completed voice events, with allowed-project selection, clarification, bounded read-only answers, safe Gmail drafts, and authenticated coaching proposals;
- live inbound voice context selection over a timestamped signed internal request, with trusted dialled-number tenant resolution, stable Communications person grants, scoped project context, mid-call project switching, and fail-closed context outages;
- tenant-scoped operations views for agent jobs, coaching outcomes, schedules and external writes, plus authenticated replay of failed/review-held agent jobs;
- a signed-out external Ask page that renders escaped artifacts and accepts only declared, scoped uploads;
- legacy and timestamped V2 Communications webhook signatures plus shared contract fixtures in both repositories.

Still required before claiming the complete service is production-ready:

- deploy both modified repositories, apply Communications migration `016`, and configure every environment variable and tenant capability described in the READMEs;
- provide a trusted timer that calls `/api/schedules/tick` at least every five minutes (the checked-in Vercel Hobby cron is daily only);
- expose `/api/events` and `/api/agent/voice-context` on a stable production HTTPS origin that an anonymous probe proves reaches HyperFlow; if that origin is intercepted by Deployment Protection, use the origin-scoped Vercel automation-bypass header supported by Communications, then run signed callback/context smoke tests;
- complete a live Gmail triage/draft/digest test and a live Google Doc → human coaching call → Google Sheet test with duplicate/failure drills;
- implement Outlook behind the mailbox adapter (it remains explicitly unavailable); and
- complete the live production acceptance and failure drills below, including inbound voice project selection, person isolation, operations replay, and Sheet upsert against controlled provider accounts.

Accordingly, this document is both the implemented contract and the remaining executable release plan. It is not evidence that the live deployments have passed end-to-end acceptance.

The command-level deployment, onboarding, smoke-test, acceptance, and recovery procedure is maintained in `OMNICHANNEL_OPERATIONS.md`.

## 2. Product outcome

Each tenant can operate one or more named agent-backed projects in HyperFlow. A person can communicate with their tenant's agent by voice call, SMS/text or email. HyperFlow identifies the tenant, person, conversation and project before reading context or taking an action.

The first two project templates are:

1. **Daily Email Triage** — inspect a connected mailbox, classify new mail, maintain a prioritized triage inbox, and prepare safe responses.
2. **Daily Coaching** — call the user each day, review the configured coaching material, conduct a multi-turn conversation, and update a configured coaching tracker.

The same agent can discuss these projects and other HyperFlow projects throughout the day without merging their state or leaking data between tenants.

## 3. Non-negotiable operating rules

- Tenant identity is derived from a trusted service identity or connection, never from an untrusted webhook body.
- Every communication, schedule, run, thread, memory item and external write carries `tenant_id` and, once known, `project_id`.
- OAuth access and refresh tokens are stored only in an encrypted backend credential store. HyperFlow settings store opaque connection IDs, never tokens.
- Mailbox responses are draft-only by default. Sending requires an explicit user approval or an enabled tenant policy with a complete audit record.
- Email bodies, attachments, documents and transcripts are untrusted content. They cannot directly select tools, change policy or authorize external actions.
- A Google Sheet write is restricted to an allowlisted spreadsheet and configured range/table.
- All outbound communication and external writes use stable idempotency keys.
- Voicemail, wrong number, no answer, provider failure and non-meaningful calls fail the coaching occurrence. They do not update the coaching Sheet or become memory.
- Ambiguous project routing results in a clarification question; the agent must not guess.

## 4. System responsibilities

| Concern | HyperFlow | Communications Service |
| --- | --- | --- |
| Tenant projects and flows | Owns | References IDs only |
| Schedules and run state | Owns | Does not decide workflow timing |
| Agent decisions and project routing | Owns | Supplies trusted identities and thread hints |
| SMS, voice and email transport | Requests delivery | Owns providers and delivery state |
| Mailbox provider connection | Stores opaque connection selection | Owns Gmail/Outlook OAuth and synchronization |
| Communication threads/transcripts | References canonical IDs | Owns canonical record and enrichment |
| Human Ask lifecycle | Owns resolution | Delivers and emits candidate responses |
| Google Docs/Sheets actions | Owns action and policy | No responsibility |
| Google OAuth credentials | Stores opaque connection selection | No responsibility; credentials live in a protected HyperFlow integration backend |
| Project memory | Owns workflow/project projection | Owns communication facts and provenance |
| Audit | Owns workflow decisions and external action receipts | Owns provider operations and raw events |

## 5. Core domain additions

Names may be adapted to existing conventions, but the following records and invariants are required.

### 5.1 Tenant agent profile

One profile per tenant agent:

- `tenantId`, `agentId`, display name and timezone;
- permitted service identities: phone number, SMS number and email identity;
- primary user/person identity;
- default project, allowed projects and clarification policy;
- automatic-action policy, including draft, send, call and Google Sheet write permissions.

### 5.2 Provider and workspace connections

`MailboxConnectionRef` links a tenant to a Communications Service provider connection and selected mailbox. It records provider, mailbox address, scopes, connection state and last successful sync, but no credentials.

`WorkspaceConnectionRef` links a tenant to a protected Google Workspace connection. It records the connection ID, account identity, scopes and state, but no credentials.

### 5.3 Generic schedule

Extend the existing schedule into a discriminated activity:

- `communications_triage` for mailbox reconciliation;
- `flow_start` for a project flow occurrence;
- future activity types without weakening type validation.

Each schedule has `tenantId`, timezone, recurrence, next run time, enabled state, lease, last occurrence, misfire policy and an activity-specific payload. A `flow_start` payload includes `projectId`, `flowId`, optional input and occurrence key.

The scheduler must be ticked at least every five minutes for multi-tenant local-time execution. The current once-daily deployment timer is not sufficient. The timer may initially be a Vercel plan that supports the required frequency or a trusted external scheduler calling the signed tick endpoint; schedule claiming and idempotency remain inside HyperFlow.

### 5.4 Conversation context

A tenant-scoped context binds:

- Communications `threadId` and provider-native thread identifiers;
- `personId` and channel identities;
- active `projectId` and topic;
- open Ask or waiting flow node, if any;
- last interaction and project-selection confidence;
- expiry and clarification state.

This is a routing aid, not the source of truth for a run or Ask.

### 5.5 Coaching session

One record per scheduled or user-started coaching occurrence:

- schedule occurrence, tenant, project, run and communication IDs;
- Google Doc ID and source revision/time read;
- Sheet ID, table/range and source revision/time read;
- call disposition and authoritative transcript reference;
- structured summary, progress, blockers, commitments and next actions;
- extraction confidence and review state;
- Sheet write status, idempotency key and provider receipt.

## 6. Scenario A — Daily Email Triage

### 6.1 Tenant setup

The user:

1. Connects Gmail or Outlook through an OAuth flow backed by Communications Service.
2. Selects the mailbox and grants the minimum supported scopes.
3. Creates or selects a HyperFlow Email Triage project.
4. Configures timezone, daily digest time, priority rules, excluded senders/categories and digest channel.
5. Selects draft-only or an explicitly approved send policy. Draft-only is the default.

Gmail is the first implementation target because the coaching scenario already requires Google onboarding, although mailbox and Workspace credentials/scopes remain separate connections. Outlook follows behind the same mailbox adapter contract. Resend remains supported for service-owned transactional addresses but is not presented as a connected personal mailbox.

### 6.2 Ingestion and reconciliation

Provider push/webhook notifications trigger incremental ingestion when available. The daily schedule performs authoritative cursor-based reconciliation so missed notifications do not lose mail.

For each new message, Communications Service:

1. derives tenant and mailbox from the trusted connection;
2. fetches the canonical message and conversation/thread metadata;
3. normalizes sender, recipients, dates, subject, body and attachment metadata;
4. stores the communication idempotently;
5. marks automated mail, bounces, spam and mailing-list traffic as ineligible for agent response and memory where appropriate;
6. emits the signed canonical inbound communication event.

HyperFlow then:

1. upserts the triage item idempotently;
2. links it to an existing Ask, person and project when evidence is sufficient;
3. classifies priority, intent, requested action, deadline and risk;
4. records a concise evidence-backed summary and recommendation;
5. creates a reply draft only when requested by policy;
6. produces a daily digest through the configured channel.

### 6.3 Interactive use

By voice, SMS or email, the user can ask:

- what needs attention;
- what changed since the last digest;
- what is waiting on the user or another person;
- for the history and current state of a named conversation;
- to draft a reply;
- to approve sending a specific draft, if send capability has been enabled.

The response must link every recommendation to the canonical mailbox communication/thread. Asking for a draft is not approval to send it.

## 7. Scenario B — Daily Coaching Project

### 7.1 Tenant setup

The user:

1. Creates a project from the Daily Coaching template.
2. Connects Google Workspace through the protected HyperFlow integration flow.
3. Selects one readable Google Doc as coaching source material.
4. Selects one Google Sheet and an allowlisted table/range as the coaching tracker.
5. Maps required columns, including session date, progress, blockers, commitments and next actions.
6. Selects the daily call time, timezone, phone identity, retry window and missed-call policy.
7. Reviews the agent prompt, permitted projects and Sheet-write policy.

The Doc is read-only for this workflow. The Sheet is writable only inside the selected table/range.

### 7.2 Scheduled coaching occurrence

For every due occurrence HyperFlow:

1. atomically claims `coaching:{tenantId}:{projectId}:{occurrence}`;
2. starts a project run and records the schedule occurrence;
3. reads the configured Google Doc and captures its revision/time;
4. reads the configured Sheet context needed for the session;
5. retrieves recent coaching communications, commitments and unresolved actions;
6. creates a bounded coaching brief and question plan;
7. requests an outbound conversational call through Communications Service with project, run, task and thread correlation;
8. waits for the authoritative terminal call event;
9. on `human_completed`, fetches or uses the canonical transcript and extracts a typed coaching result;
10. sends low-confidence or policy-sensitive results to Human Ask review;
11. otherwise appends or upserts exactly one Sheet row using the occurrence idempotency key;
12. records the write receipt, session summary, commitments and next actions in the project;
13. completes the run and exposes the result in the project timeline.

On voicemail, wrong number, no answer, busy, automated system, provider failure or no meaningful response, HyperFlow marks the occurrence unsuccessful, performs no Sheet write, and follows the configured retry or Human Ask policy.

### 7.3 Conversation during the day

The user can call, SMS or email the agent to:

- discuss progress or blockers in the coaching project;
- ask what was agreed in the last session;
- add or change a coaching commitment;
- request another coaching call;
- discuss another named HyperFlow project;
- ask about the Email Triage project.

Read-only questions can be answered automatically. A request that changes the coaching tracker produces a structured proposed update and is applied only under the tenant's write policy. A project switch is explicit and persists only for that semantic conversation until it expires or is changed.

## 8. Omnichannel project routing

Every generic `communication.received` event is persisted first and then queued for agent processing. It must not be handled only as a passive triage record.

Routing uses this order:

1. Resolve tenant and person from the trusted provider connection and service identity.
2. Continue a matching open Ask or provider reply thread.
3. Honour an explicit project reference in the user's message.
4. Continue the active project on the same semantic thread when it is still valid.
5. Match a single high-confidence project using participants, recent context and project facts.
6. If no unique match exists, ask a short clarification question listing only projects visible to that tenant/person.

The Communications Service transports the clarification and preserves the thread. HyperFlow makes and audits the routing decision.

Inbound voice transport already exists, but it must be connected to this router. An inbound call with no unambiguous active context receives a tenant-safe project selection prompt before project tools or memory are exposed.

## 9. External Human Ask last mile

The existing external HTML Ask page is retained and completed:

- render the actual work product using the same safe artifact model as the in-app Review Panel;
- support approve, revise, reject and question responses as permitted by Ask type;
- accept a scoped upload when the Ask declares an upload field;
- authorize upload creation using the Ask capability without exposing general Firebase Storage access;
- show a terminal confirmation and reject reused or expired capabilities safely.

This supports triage draft approval and low-confidence coaching review outside the HyperFlow application.

## 10. API and event contract changes

Exact route names can follow repository conventions, but implementation must expose these capabilities.

### 10.1 Communications Service

- Start and complete Gmail/Outlook mailbox OAuth.
- List tenant-owned mailbox connections and connection health.
- Trigger/reconcile an incremental mailbox sync.
- Create and retrieve provider-native drafts.
- Preserve canonical provider thread and reply identifiers.
- Normalize inbound SMS, email and voice to the existing Communication contract.
- Include trusted service identity and sufficient correlation in inbound events; never accept a caller-supplied tenant override.
- Continue emitting `communication.received`, `ask.response.received`, `call.completed` and `call.failed` under their existing semantics.

### 10.2 HyperFlow

- Extend schedule APIs for typed `flow_start` activities and occurrence inspection.
- Add Google Workspace connect, callback, health and resource-selection APIs.
- Add protected Doc read and Sheet read/append/upsert actions.
- Add an internal agent inbox queue/worker fed by canonical inbound events.
- Add project selection and conversation-context APIs.
- Add coaching session and external-action receipt persistence.
- Keep `respondToAsk` as the only Ask resolution path.

No new event is required merely to rename existing Communications events. Coaching completion and workspace writes are HyperFlow domain events and should be recorded in the project timeline/outbox without weakening the canonical Communication contract.

## 11. Security and multi-tenancy acceptance rules

- Provider webhooks verify the provider signature over the exact raw body.
- Communications-to-HyperFlow events verify HMAC, timestamp and replay/idempotency constraints.
- Connection lookup derives tenant from an opaque trusted connection ID.
- Every backend read and write applies the authenticated tenant boundary before project/person filtering.
- OAuth state is short-lived, signed and bound to tenant, initiating user and redirect target.
- Minimum mailbox scopes needed for read and draft operations are requested. Outlook's separate send permission remains ungranted until send is intentionally enabled. Gmail's compose scope can also authorize sending, so draft-only behavior is enforced by server-side tenant policy and by withholding send operations from the agent rather than by OAuth scope alone.
- Google Docs is read-only. Google Sheets access is constrained in application policy to selected file and table/range even if the provider scope is broader.
- Logs redact message bodies, transcripts, OAuth codes, tokens and callback secrets.
- Each response, draft, send, call, Sheet change, route decision and override has an audit record.
- Imported email, Doc and transcript text is labelled as data in model prompts and cannot issue system instructions.

## 12. Implementation plan

### Phase 0 — Contract freeze and production prerequisites

1. Add shared fixtures for canonical inbound email, SMS, inbound/outbound voice, Ask response and terminal call events.
2. Document the project-routing decision record and typed coaching result schema.
3. Choose the production tick driver capable of calling HyperFlow at least every five minutes.
4. Add a deployment smoke test proving the production event URL reaches HyperFlow: unsigned requests must receive HyperFlow's `401`, and a valid signed fixture must be accepted idempotently.

Exit: both repositories pass the same contract fixtures and the production timer/callback path is decided and testable.

### Phase 1 — HyperFlow scheduling and connection foundation

1. Convert schedules to a typed activity union while preserving existing triage schedules.
2. Implement `flow_start`, occurrence keys, lease recovery, misfire behavior and run correlation.
3. Add tenant agent profiles and opaque mailbox/workspace connection references.
4. Add Settings UI for connection health and project-template configuration; never accept raw provider secrets in the browser.
5. Add emulator-backed tenant isolation and schedule concurrency tests.

Exit: a tenant-local daily schedule starts one project run exactly once, including after retry or concurrent ticks.

### Phase 2 — Connected mailbox and triage MVP

Communications Service:

1. Implement the mailbox adapter interface and encrypted OAuth credential references.
2. Implement Gmail OAuth, watch/history synchronization, canonical thread mapping and draft creation.
3. Add webhook renewal, cursor recovery, replay protection, connection health and audit.
4. Implement Outlook behind the same interface after Gmail acceptance tests pass.

HyperFlow:

1. Bind Email Triage projects to a mailbox connection.
2. Extend reconciliation to the selected mailbox and full canonical thread.
3. Add classification, evidence, priority, digest and draft-only policy.
4. Make inbound email an agent inbox job as well as a triage projection.

Exit: a real Gmail tenant completes the daily triage acceptance test without sending mail or creating duplicate items.

### Phase 3 — Google Workspace actions

1. Implement protected Google OAuth with Docs read and Sheets read/write capabilities.
2. Add tenant-owned resource selection and allowlist enforcement.
3. Implement bounded Doc extraction with revision metadata.
4. Implement typed Sheet read and idempotent append/upsert with action receipts.
5. Add expiry, revoked-connection and partial-write recovery tests.

Exit: a test project can read the selected Doc and append exactly one validated row to the selected Sheet; another tenant or file ID is rejected.

### Phase 4 — Daily Coaching flow

1. Add the Daily Coaching project template and typed configuration.
2. Implement context assembly from Doc, Sheet, project state and Communications memory.
3. Add the conversational coaching call purpose/prompt and stable correlation contract.
4. Implement terminal outcome handling and typed transcript extraction.
5. Apply confidence/policy gates and external Human Ask review.
6. Implement the idempotent Sheet update and project timeline summary.
7. Implement missed-call retry windows without treating provider completion as human success.

Exit: one scheduled real call reaches a human, conducts the session and produces one correct Sheet change; voicemail and duplicate callbacks produce none.

### Phase 5 — Omnichannel project agent

1. Implement the HyperFlow agent inbox queue and worker.
2. Implement deterministic Ask/thread/project routing and clarification.
3. Connect inbound SMS and email to project-aware responses.
4. Connect inbound voice to tenant-safe project selection and scoped project tools.
5. Support read-only questions, proposed mutations, explicit project switching and on-demand calls.
6. Add per-channel rate limits, loop prevention and user-visible escalation.

Exit: the same test user can continue one coaching conversation over SMS, email and voice, deliberately switch to Email Triage or another project, and cannot access another tenant's context.

### Phase 6 — External review and production hardening

1. Render artifacts and implement scoped uploads on the external Ask page.
2. Add operational views for mailbox sync, schedules, agent inbox jobs, call outcomes and Google writes.
3. Add dead-letter replay with tenant-safe operator controls.
4. Run failure drills for provider outage, expired OAuth, delayed callback, duplicate event, stale lease and ambiguous routing.
5. Update README, API reference, environment/configuration guide and tenant onboarding runbook from verified behavior.

Exit: the complete release checklist passes against production-like Gmail, Twilio, Google Workspace and HyperFlow tenants.

## 13. End-to-end acceptance plan

### 13.1 Email Triage

1. Connect tenant A Gmail and ingest a controlled mix of human mail, automated mail, spam and a threaded reply.
2. Verify one canonical communication and one triage item per provider message.
3. Run reconciliation twice and verify no duplicates.
4. Verify classification, evidence, deadline and project routing.
5. Request the triage summary over SMS and email; confirm both use the same tenant/project state.
6. Request a draft and verify it exists in the connected mailbox but is not sent.
7. Verify tenant B cannot query, list or draft against tenant A's mailbox.

### 13.2 Daily Coaching

1. Configure a Brisbane-time occurrence with a controlled Doc and Sheet.
2. Verify the schedule starts one project run and reads the expected source revisions.
3. Complete a real human call with a known progress update, blocker and commitment.
4. Verify the terminal event is `call.completed`, memory is eligible and exactly one Sheet row is written.
5. Replay the terminal event and scheduler occurrence; verify there is still one row.
6. Run voicemail, no-answer and wrong-number cases; verify failed status, no coaching memory and no Sheet write.
7. Provide an ambiguous statement; verify Human Ask review occurs before any Sheet write.

### 13.3 Omnichannel continuity

1. Ask about the latest coaching commitment by SMS.
2. Reply by email in the same semantic conversation.
3. Call the agent and continue the coaching topic.
4. Explicitly switch to the Email Triage project and request urgent items.
5. Mention two plausible projects without selecting one; verify a clarification question rather than guessed routing.
6. Verify all transcript, memory, run and action records remain tenant- and project-scoped.

### 13.4 External review and operations

1. Open an emailed Ask link while signed out and verify the artifact renders safely.
2. Submit revise/approve and a declared upload; verify one canonical `respondToAsk` transition.
3. Verify unsigned, invalid-signature, replayed and expired callback cases fail safely.
4. Verify connection revocation, scheduler misfire and dead-letter alerts are visible and recoverable.

## 14. Definition of done

The service is complete only when:

- both project templates can be created and configured without secret entry in the browser;
- schedules run in each tenant's timezone and create exactly one occurrence;
- Gmail is production-verified and Outlook either passes the same suite or is clearly marked unavailable;
- voice, SMS and email can continue a project conversation with deterministic routing;
- a completed human coaching call updates the configured Sheet once;
- failed calls never update the Sheet or coaching memory;
- email triage creates evidence-backed items and drafts but does not send by default;
- cross-tenant and cross-project isolation tests pass;
- external review renders the artifact and supports only declared response fields;
- README, API reference, operations guide and live configuration match verified behavior.
