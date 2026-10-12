# Operational history

The operational log is internal system infrastructure, not a workflow primitive. New server activity is recorded automatically once this release and its database rules/migration are deployed. Existing run, dispatch, communication and mailbox records remain authoritative. Historical records are not silently relabelled as newly observed events.

## Stored events

| Owner | Coverage |
| --- | --- |
| HyperFlow | Run saves, changed node attempts, bound Ask state/response count, action dispatch transitions, project revision conflicts and saves, contact-policy decisions, callback processing, routing outcomes, schedule completion, reception mutations, setup-session revisions, setup model latency/token usage, authenticated API dispatcher outcomes |
| Communications | Transactional metadata journal for communication, call, message, recording, outbound-event, outbound-operation, job, draft, draft-receipt, mailbox-audit and thread tables present in the schema; authenticated v1 API outcomes |

Events contain schema version, service, tenant, timestamps, event type/status, available project/run/node/Ask/operation/communication identifiers, revisions and bounded diagnostic metadata. A run can supply `projectData.test_campaign_id` for campaign correlation. Deployment SHA is captured by HyperFlow when its deployment environment supplies it. Communications API events capture the deployment identifier; database triggers cannot infer an application build and do not fabricate one.

No message bodies, transcripts, recordings, model prompts/responses, arbitrary error messages, request headers, credential-bearing URLs or form tokens are copied into this journal. Follow source IDs to the existing protected record for content. Numeric revisions, provider error codes and status reasons can be retained without duplicating content. Existing logs/records have their own retention and are not sanitized retroactively by this change.

This is operational event history, not a packet recorder. It does not capture every model token, browser keystroke, or historic intermediate state. Legacy browser-direct workspace edits retain their existing workspace activity trail; the new server journal does not claim an independent verified event for each such edit. Model token accounting currently covers the setup assistant; missing usage on other adapters is unknown, not zero.

## Query and export

`GET /api/operational-log?orgId=<org>` requires a human tenant owner/admin session. Normal members and browser database clients cannot read the journal directly. Use `service=communications` to read the Communications timeline through the same server-authenticated endpoint; its configured service credential must already have tenant administrator/`tenant:manage` authority. A missing grant is reported as unavailable; this feature never expands credentials automatically. Direct Communications access is `GET /v1/operational-log` with its existing tenant-scoped authentication plus admin/tenant:manage.

Supported shared filters: `projectId`, `runId`, `operationId`, `communicationId`, `type`, `from`, `to`; time values are UTC epoch milliseconds. HyperFlow additionally supports `campaignId` and `severity`. Use matching correlation IDs to compare timelines across services; cursor values belong to their source service and must never be interchanged.

HyperFlow scans at most 200 records per page, filters them, and returns `{items, scanned, next}`. Follow `next` using `before`, **even when items is empty**. Communications filters in SQL and returns at most 200 matches with `next`. `format=ndjson` exports a page and supplies `X-Next-Cursor`; iterate until absent, preserving event IDs. This supports offline analysis without storing credentials in export URLs. Exported files still require tenant-appropriate access controls.

Example, using an already-authenticated API client session (do not put a bearer token in a URL):

```text
GET /api/operational-log?orgId=<org>&runId=<run>
GET /api/operational-log?orgId=<org>&service=communications&communicationId=<communication>
GET /api/operational-log?orgId=<org>&type=project.revision_conflict
GET /api/operational-log?orgId=<org>&format=ndjson&before=<prior-next>
GET /api/operational-log?orgId=<org>&operation=health
```

The 2010/2011 conflict now has a dedicated `project.revision_conflict` event with expected/stored revisions. Later run/node events and provider receipts show recovery; a rejected stale write is not a failed provider action.

## Retention and archival

Default hot-history window is **90 days**, with no automatic deletion. Configure 7–3650 days through a human-admin `POST /api/operational-log` with `{operation:"configure", expectedRevision:0, hotRetentionDays:90}`. Read the current revision through health first. Stale policy writes return 409. Configuration does not erase existing data.

HyperFlow `POST` `{operation:"archive"}` atomically moves at most 200 eligible events into an internal retained archive. Repeat while `morePossible` is true. Query it with `archive=true`; IDs are preserved. No automatic archival job is enabled by this change. Communications uses the same age-based hot/archive distinction over its append-only indexed table: configure its policy through its own authenticated `POST /v1/operational-log`. Archive is internal retained storage, not a backup or external cold-storage service. NDJSON export provides the handoff for separately managed backups. There is no log purge API. Both services include log stores in existing tenant lifecycle export/erasure; Communications permits deletion only during the existing reviewed suspended-tenant erasure transaction. Ordinary journal writes cannot alter prior events.

## Failure semantics and health

HyperFlow awaits event writes, but diagnostic failure must not change a successful external effect into a retry. Failure increments process health, emits a content-free console diagnostic and attempts to persist a sticky `gapDetected` health marker. A failed write between source persistence and journal persistence can leave a gap; source receipts remain the recovery evidence. This journal is not an atomic financial audit ledger. Do not claim complete historical capture while health reports a gap. There is deliberately no automatic clearing of a gap after one successful write.

Communications state metadata is inserted by database triggers in the same transaction as its source change; a failed insert rolls back that database transaction. Existing idempotency/reconciliation still owns any already-dispatched provider effect. API diagnostic failures are caught and shown in process health, not retried as provider work. `/health.operationalLog` is a cached persistence-readability probe with timestamp/staleness and any process-observed gap; it is not proof of every prior write. The authenticated log endpoint can refresh that probe. Database constraints and privileges prevent changing/deleting journal rows through ordinary service operations.

## Deployment and verification

1. Deploy Communications migration `042_operational_events.sql` through its existing migration runner, then the service code. It was generated with the Supabase CLI and placed in the service's established numbered migration directory.
2. Deploy HyperFlow database rules and code together. The journal is server-only; lifecycle-enforced runtime access follows existing tenant lifecycle restrictions.
3. Verify readiness, execute one controlled run and correlate source receipts with both timelines. Check a deliberate isolated revision conflict and a denied log-read attempt.
4. Query/export a bounded page, review health, and only then count the new logging acceptance case as passed. No production migration, test communication or public activation is implied by local tests.

Regression checks cover redaction, filtered pagination, cursor validation, source transition persistence, append-only enforcement, browser-role denial, tenant isolation, administrator access, policy revisions and archive queries. Run `npm run lint`, the operational-log tests and API-contract checks in HyperFlow; run `node --test test/operationalLog.test.js` and the isolated suite in Communications.

Local verification (12 October 2026): HyperFlow's 1,015 tests, typecheck, generated API contract check and production build passed. All 42 Firebase emulator rules checks passed, including denial of direct browser access to the journal. Communications' 506 isolated tests passed; focused PostgreSQL lifecycle tests also verified journal export, reviewed tenant erasure and rejection of late writes. These are local results, not deployment or live-provider acceptance.
