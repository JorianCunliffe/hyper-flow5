
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
