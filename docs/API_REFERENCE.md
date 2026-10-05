
### Human Ask escalation sequences

`holdConfig.human.escalation.mode` accepts `morning` (default when omitted) or `incident`. Morning keeps the existing primary call, timed primary retry, fallback call, then SMS to both contacts. Incident calls primary, waits for verified no-answer, sends primary's callback SMS, then calls fallback without a timed primary retry. Pending/unknown call outcomes cannot advance either sequence. A policy hold retains the same step; it cannot skip the primary SMS to reach fallback.

Both sequences retain the owning Ask and its validated answer requirements. A completed call alone does not answer it. After an unanswered sequence, the next cycle uses the configured weekday/time; contact hours, budgets, grants and capability checks still apply. Incident does not add a fallback SMS. `retryMinutes` remains part of the configuration but applies only to morning mode. The node editor exposes the same selector. No change to a mode grants contact authority.

### Sheet upsert planning snapshots and retries

The `upsert_google_sheet` task accepts optional `expected_row`: the complete row returned by the planning read, or `null` when the key was absent. It compares that snapshot with the current matching row before writing. Changed/deleted rows, a newly present key, or duplicate matching keys hold the action without a provider write. Trailing empty cells are normalized. Omission retains unconditional upsert behavior; workflows requiring stale-data protection must bind the snapshot explicitly, without asking a model to invent it.

Alternatively bind `expected_rows` directly to `{{<read_result>_output.google_sheet_values}}` and require that read result from the current occurrence. The server selects the original row using `key_column`/`key_value`, treating no match as expected absence. It rejects duplicate snapshot keys, malformed matrices and simultaneous `expected_row`/`expected_rows`. Empty arrays are valid snapshots. This supports collections without model-generated baseline rows; use the same named resource for the read and write.

This is a read-before-write guard, not atomic Google Sheets compare-and-swap. It does not protect a change between the final read and provider write or enforce inspection capacity across rows. Those acceptance requirements remain unverified.

Sheet append/upsert receipts are never automatically reclaimed after failure or lease expiry: the provider may already have accepted the write. Same-key retries return a completed receipt or the unresolved error without dispatching again. Changing a snapshot or payload under the same key is rejected. Inspect the provider and saved receipt before any operator recovery; choosing a new key alone is not reconciliation. There is not yet a supported automatic reconciliation path for an ambiguous Sheet write.

### Existing email draft linkage recovery

Authenticated app members can `POST /api/triage?scope=draft` with `{ "id": "<triage item id>" }` to recover missing linkage from that enquiry's saved agent draft receipt. Callers cannot supply a mailbox, receipt or provider draft ID. Recovery verifies the tenant, original communication, receiving connection, successful receipt and live editable draft before atomically saving linkage and an audit entry. Conflicting linkage returns 409. It does not change review disposition, reroute the enquiry, replay the agent, create a draft, alter its body or send email. Repeated recovery preserves the same linkage. `GET /api/triage?scope=draft&id=...` remains a read-only live preview. Deploy the Communications Service receipt-read endpoint before using recovery.

### Communications contacts

`GET /api/communications/contacts` lists contacts in the authenticated organisation. Requires a member session or a HyperFlow API key with `communications:read`.

`POST /api/communications/contacts` accepts `{"name":"Carol","phone_number":"+61414022817"}`. Requires owner/admin membership and, for machine credentials, `communications:write`. The organisation comes from authentication; caller-supplied tenant IDs and extra fields are rejected. Returns `{person:{id,name,phone},created:true}` with HTTP 201, or HTTP 200 and `created:false` for an existing matching name/phone. Conflicting matches return 409. The current upstream list is limited to 200 contacts; duplicate checking is best-effort, not an atomic uniqueness guarantee. Do not automatically retry an ambiguous creation failure: check the directory first.

Contact creation neither grants project access nor sends communications. Settings exposes the same operation under **Add Communications contact**.

For agent API access, issue a scoped, expiring HyperFlow API credential and supply it through a local environment variable or secret store. Use `Authorization: Bearer <HyperFlow key>`. Do not copy a Communications Service legacy key across tenants or commit credentials. HyperFlow keeps its upstream integration key server-side.

### Manual action recovery

`POST /api/tasks/execute` returns HTTP 503 with `recoverable: true` when the durable action must continue or reconcile. Clients must retain the original `correlation.runId` and treat this as a pending hold, rather than a terminal business failure or a new action. Frozen dispatch inputs remain authoritative. A triage batch checkpoint is immediately resumable; uncertain provider operations retain their existing lease/reconciliation requirements. Downstream actions remain blocked until the complete result succeeds.

### Canonical voice outcomes and retry holds

HyperFlow normalizes a Communications Service GET result using explicit top-level `status`, then `outcome.business_status`, then `accepted`. Canonical `failed` with `outcome.reason: no_answer` can advance the owning Human Ask's configured retry sequence. `pending` or unknown outcomes remain held; a provider call being completed does not establish a meaningful human answer. Retry policy, contact windows, budgets and the original frozen Ask remain authoritative.
# AI workflow setup

`GET`, `POST` and `DELETE /api/setup-assistant/sessions` provide private resumable setup conversations, configuration proposals and separate human apply/live-test/activation commands. These endpoints require a Firebase human session and enabled administrator rollout. See [the setup assistant reference](SETUP_ASSISTANT.md) for commands, review hashes, limits, recovery and rollout. `POST /api/test-runs` also supports an unapplied proposal through `changes` and `planHash`; execution remains fixture-only with zero provider calls.

## Project reception

Administrators can configure number-to-project reception directories with separate save and activation reviews. See [reception configuration, voice and SMS contracts](PROJECT_RECEPTION.md). The `PROJECT_RECEPTION_ENABLED` flag defaults to false.

Outbound recovery: scheduled provider outages retry the same operation at 15-minute intervals for at most 60 minutes. Uncertain call setup receipts are read through tenant-scoped `GET /v1/calls/operations/:key`, without another call POST, every five minutes (an initially in-progress receipt backs off 15 minutes) for at most 30 minutes. Deadlines are persisted from the first failure and cannot slide with retries. A confirmed rejection escalates immediately. Legacy blocked occurrences are adopted using their recorded hold time.

Rejection or expiry marks the occurrence and workflow action `failed`, with `manualReviewRequired`, `providerOutcome` (`unknown`, `rejected`, or `not_dispatched`) and a stable `recoveryAskId`. One web-only Human Ask records operator review; no Twilio notification is required. The original provider receipt remains untouched. A note/answer does not authorize retry, clear the hold, create a new operation key or restart the workflow. Late provider evidence is retained for review. An interrupted escalation resumes the same Ask; unrelated schedules continue and expected provider holds do not cause HTTP 500.

`POST /api/schedules?action=resume` remains available to owner/admin users for an unexpired blocked occurrence, with exact current `id`, `scheduledFor`, and a non-empty receipt-review `reason`. It does not extend the recovery deadline, release a terminal manual-review failure, or clear/replace a provider operation. `run` will not create a fresh occurrence while the current occurrence is blocked or requires manual review. Independent manual/API calls use the same read-only receipt reconciliation adapter, but automatic deadlines/escalation in this release are driven by scheduled workflow occurrences; direct provider API clients must own their recovery deadline.
### Meeting notes and audio intake

The Meetings screen accepts pasted notes, TXT/JSON, and MP3/MP4/M4A/MPEG/MPGA/WAV/WebM audio up to 25 MB. Known participants come from `/api/contacts`; each reviewed topic must name an accessible project. Speaker labels are unverified until reviewed. The meeting date defaults to the current Brisbane date/time and remains editable for historical recordings. Saving evidence does not approve an obligation or execute a workflow.

1. Upload audio through the existing resumable `/api/files` commands with `visibility: "private"` and a stable file ID.
2. `POST /api/meetings` with `{ "operation": "audio_start", "fileId": "<id>" }` starts/reconciles the original transcription. It accepts only the authenticated user's completed private file, with its recorded immutable storage generation. It does not accept arbitrary media URLs, tenant IDs or project claims.
3. `GET /api/meetings?audio=1&fileId=<id>` returns `not_queued`, `pending`, `transcribing`, `done` or `failed`. A completed result contains safe transcript segments, not signed media links or raw provider errors. GET never dispatches transcription.
4. `GET /api/meetings?audio=1&after=<cursor>` pages ready private audio uploads owned by the user, including uploads interrupted before queue submission. Pages may be empty after ownership filtering; follow `next`.
5. Review/correct the transcript, identify speakers and split topics/projects. Save through the existing meeting import body (source/externalId/sourceVersion/title/occurredAt/attendees/topics). Audio reviews use `source: "hyperflow_audio_review"`, `externalId: <fileId>`. Source version and `expectedVersion` preserve existing correction/duplicate safeguards.

Audio needs `HYPERFLOW_MANAGED_FILES=true`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_ENFORCE_TENANT_LIFECYCLE=true`, and configured Communications transcription. Ordinary file downloads remain 60 seconds; the server freezes a separate private generation-bound 24-hour link for the transcription queue. That link is shared only with Communications, whose management administrators retain access. It is never placed in the reviewed meeting references. Raw staging rows are marked `intake_pending` and excluded from memory/enrichment/promise extraction even with a private-history grant. Delete recordings through managed files when no longer needed; staged provider transcripts are retained under Communications' tenant lifecycle policy.

Lost responses reuse the same file/source identity and reconcile `/api/recordings?source=hyperflow_audio_intake&externalId=...`; never create another recording to retry an uncertain request. Failed jobs are held for operator review, using the existing Communications requeue route only after provider/media reconciliation. Expired handoffs require operator reconciliation; this UI does not silently renew links or requeue failed work. Deploy the matching Communications source-lookup/privacy changes before enabling audio. Notes remain available without audio/storage readiness.

## Contact and business-hours policy

Use `GET /api/cockpit?operation=contact_policy`, then `contact_policy_preview` and human-approved `contact_policy_apply` POST operations. Revision/hash checks bind the exact proposal. Reception line and project hours use the existing reception review interface. See [contact policy API and task contracts](CONTACT_POLICY.md) for modes, evidence requirements, durable deferrals and rollout.
