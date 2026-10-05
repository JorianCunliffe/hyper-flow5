# Project reception behind shared phone numbers

This release adds opt-in inbound reception. `PROJECT_RECEPTION_ENABLED` defaults to false. Unconfigured lines retain explicitly identified legacy routing; configuring a disabled line makes it unavailable for reception when the flag is enabled. No migration publishes a project or grants a caller project access.

## Ownership and configuration

Communications owns authenticated dialled-line identity, contacts, provider calls and transcripts. HyperFlow owns the line directory, public project policies, enquiries, scoped call sessions, verification and workflow authority. Administrators use **Communications → Receptionists** or **Project settings → Inbound reception**. Manual workflow editors remain available.

`GET /api/reception` returns configuration, current revision, enquiries and booking operation status. It requires a human owner/admin. `POST` supports:

| Operation | Contract |
|---|---|
| `preview` | Read-only routing of `config`, `identity`, optional caller wording and an existing `personId`. Public preview omits person identity. |
| `prepare` | Validate proposed configuration against current `expectedRevision`; return exact `reviewHash`, effects and readiness checks. |
| `apply` | Exact reviewed configuration, revision and stable `requestId`; save with all lines disabled. Duplicate requests return their original applied revision without overwriting later changes. |
| `review_activation` / `activate` | Separate review and exact-hash approval for enabled line bindings and their real effects. Activation requires the feature flag and readiness checks. |
| `confirm_availability` | Administrator attests staff-confirmed `windows` for a configured booking project. Requires current revision and `confirmed:true`; expires after 24 hours. |
| `review_enquiry` | Update status using `id` and `expectedUpdatedAt`; callback remains a request, not a promised obligation. |
| `reconcile_booking` | Read the protected diary and compare against the saved before/after rows. Never replays the write. |
| `reconcile_ask` | Inspect an uncertain escalation's owning dispatch receipt before releasing its guard. Never places another call. |

Line fields: `id`, `identity` (E.164), `enabled`, `name`, `greeting`, `timezone`, `projectIds`, `inboxOwner`, optional `hours:{days:[0..6],start,end}`. Hours are same-day local intervals. Project fields: `projectId`, `enabled`, `label`, `aliases`, `visibility:public|recognized`, `knowledge` (administrator-published text), `historySourceProjectIds`, `intakeOwner`, `actions:availability|booking|resume_ask`, optional `availabilityConnection` and `booking`.

Booking configuration selects an existing named spreadsheet resource and staff person, permitted properties, duration/travel minutes and distinct zero-based column indexes for `date,time,property,attendees,groupSize,status`. Configure the resource range to exclude column headings. ISO dates and HH:mm times are required. Unknown diary dates and truncated reads hold booking for review. The Sharehouse defaults are 15 minutes plus five minutes travel, Australia/Brisbane, Martyn Street at 16:00 and other properties around 15:30. Preferences never override confirmed staff availability or conflicts. Matching property/start time is a compatible shared slot without an attendee cap.

## Routing, history and sessions

Both project policy and number binding must be enabled. Candidate services are restricted to that number. Explicit public service wording wins; otherwise a current call segment or one relevant association can select a service. Multiple plausible services require clarification. Unknown wording never silently falls back to a tenant default. Public help and unassigned intake work without project membership. Private/unavailable service names are not offered to unassociated callers.

An acknowledged enquiry creates an enquiry association with the source call, not a project permission grant. Selected enquiries go to the project's intake owner; unresolved routing goes to the line inbox. Incomplete calls create review items. Repeated call-completion processing does not duplicate a saved enquiry or start a morning occurrence.

History is caller-only, from explicitly approved source projects, through the existing non-private, memory-eligible evidence checks. Reception does not import unassigned legacy thread history. Caller-provided email addresses never link identities. Communications suppresses legacy `combined_history` substitution on inbound prompts. The receptionist identity replaces contact persona instructions.

On service switches, prior model messages and tool results are deleted and the trusted service context is replaced. HyperFlow persists separate segment identities. The mixed full-call transcript is ineligible for routine memory. Communications submits bounded, service-tagged routine transcript segments through a signed internal ingestion command; verification/staff segments are excluded. If persistence or history lookup fails, continuity is unavailable rather than invented. Saved enquiries remain an independent source of continuity.

## Signed voice contract

`/api/agent/voice-context` retains exact-body HMAC V2 authentication and adds `reception:{sessionId,lineId,serviceIdentity,name,threadId,selectedEnquiryId,policyVersion,segmentId,mode,resetContext,verification,actions,open}`. These values are derived by HyperFlow, not accepted from the model. `/api/agent/reception` uses the same signature and 64 KiB body limit. Required fields are `tenant_id,person_id,thread_id,communication_id,service_identity,operation,operation_id,arguments`.

Fixed voice tools support `record_enquiry`, `select_enquiry`, `verify`, `pending_asks`, `select_ask`, `availability`, `prepare_action`, `confirm_action`, `reconcile_action`. `record_segments` is service-only and is never advertised as a model tool. No tool accepts credentials, arbitrary HTTP targets, project permission overrides or executable code. Stable operation IDs come from the provider's tool call identity. Completed operations replay their saved result; uncertain operations require reconciliation.

Verification sends a six-digit, five-minute challenge only to the existing registered phone, subject to SMS capability and contact limits. HyperFlow stores only its hash; allow five attempts and a ten-minute verified session. Verification tool arguments are redacted in Communications logs, and its persisted SMS body is replaced with a redacted notice. If delivery is unavailable, take a message.

For Carol's return call, verify, enumerate current addressed Asks in active runs, clarify if multiple, then select the exact Ask before collecting answers one at a time. Inbound participation and outbound escalation dispatch share a persisted guard. Ask proposals carry run ID and a hash of the current prompt, fields, question cycle and responses. The canonical Ask response mechanism rechecks that version before recording partial or complete answers. Expired/cancelled/superseded questions cannot advance the workflow. A call-completed event itself never resolves an Ask.

## Booking and recovery

Prepare reads the named diary and confirmed staff windows. Confirm requires the current, unexpired exact proposal hash after caller readback. Both reception and workflow spreadsheet appends enter the same persisted booking guard. It serializes protected booking writes, refreshes conflicts and staff availability, detects changed policy or diary state before dispatch, and verifies exact stored rows afterwards. Generic upsert into a protected diary is held for manual review.

Availability performs a new named GET and returns the fetch time plus a one-minute validity window. Missing/stale fetch metadata is rejected. A fetched response is not a room reservation or proof that upstream inventory is accurate; any provider-reported stale/unknown state must be disclosed.

Google Sheets does not provide a transactional compare-and-swap against external editors. A concurrent external edit can therefore produce an uncertain result; hold it for reconciliation and do not promise success. An uncertain provider response retains the guard without a time-based replay. Operator reconciliation verifies stored rows; it never sends a new provider request.

Email remains draft-only in the controlled Sharehouse workflow. The reception action set does not send email or booking SMS. Adding booking SMS requires a separate configured capability and an owning delivery receipt; it must not be inferred from booking success.

## AI setup and rollout

The setup assistant can read the selected project's reception policy and propose `extras.reception` only in workflow scope. Element sessions must explicitly expand first. Human Apply saves the reviewed reception policy paused using its revision/hash and stable request ID. Line bindings and reception activation use the separate administrator review; activating a workflow does not activate reception.

Deploy matching Communications and HyperFlow releases and Firebase rules first, with the feature disabled. Run fixtures, then configure a controlled Sharehouse binding using Jorian's configured identity and draft-only emails. Live inspection writes require separately approved TEST ONLY bookings. Run routing/privacy, missed-call return, partial Ask, concurrent booking, external diary edit and lost-response cases before publishing the public line. Local fixtures/builds and readiness metadata do not establish provider acceptance.

Runtime records live under backend-only `reception/{org}` and participate in tenant lifecycle removal. Redacted operational logs contain operation/status/policy version; call receipts and enquiry queues remain available for operator review.

See [verification record](PROJECT_RECEPTION_VERIFICATION.md) for local evidence and the remaining controlled-provider gate.

### Outbound provider holds

Calls and SMS preserve structured Communications readiness/reconciliation codes through durable dispatch. `OUTBOUND_NOT_READY` and a recent `IDEMPOTENCY_IN_PROGRESS` defer the same occurrence for fifteen minutes. `OUTBOUND_PROVIDER_REJECTED` and `IDEMPOTENCY_RECONCILIATION_REQUIRED` persist the schedule occurrence as `blocked`, keeping the original operation key and preventing automatic replay. Service status displays the hold and reason; unrelated schedules continue. These expected provider holds appear in tick results without making the entire scheduler HTTP 500. Unexpected infrastructure failures still fail the tick. A blocked run requires receipt reconciliation before continuation; creating a new run is not recovery.

## Inbound SMS

Each line has an explicit `smsEnabled` flag (default false). This setting uses the existing administrator prepare/apply/activation review; saving continues to pause reception. Voice activation alone never enables SMS. Tenant `sms.send` authority and contact limits still apply. Inbound SMS is processed from the authenticated Communications detail, using its tenant, person and receiving number, before the legacy project agent. Opted-in reception also accepts uncorrelated SMS when general triage is `correlated_only`.

The same directory limits public/recognized services, public knowledge, caller-only history, configured history sources and intake owners. Unknown contacts can make public enquiries without gaining staff permission. Unresolved enquiries go to the line inbox. Explicit private-service requests never expose private names or history. Conversations are partitioned by tenant/person/line; changing service discards the previous service's message context. One question is asked at a time. Existing bound Human Ask responses keep their dedicated validation/progression path, without an extra receptionist response. Public SMS cannot obtain staff verification or resolve an arbitrary Ask.

Permitted availability uses the existing fresh named-webhook lookup. Permitted inspection requests use the existing prepare/confirm/diary-write/readback path. The exact property, Brisbane date/time, attendee details and group size are texted for review; only a later exact `CONFIRM <code>` from the same sender/line can commit that proposal, within its ten-minute expiry and current policy. Unknown, unsupported, missing-availability or sensitive requests remain enquiries for staff. The model never supplies confirmation authority. Email is not sent by this handler.

Every message is persisted as an enquiry before acknowledging it. Replies are sent from the receiving number, with a frozen request and stable operation ID. Duplicate inbound events cannot resend; uncertain provider or persistence results are held for operator reconciliation rather than regenerated. Reply acceptance is separate from delivery. Per-conversation leases, contact limits, a 15-second cooldown and six-replies-per-hour limit bound automated responses. Provider control keywords do not receive AI replies. Operator SMS receipts appear in Receptionists and `/api/reception` as `smsOperations`.

`RECEPTION_SMS_MODEL` selects the server-side Gemini model; the versioned prompt is `SMS_RECEPTION_PROMPT` in `lib/reception/sms.ts`. Model failure falls back to acknowledged message-taking. Fixture coverage is provider-free; deployment, explicit activation and a controlled Jorian-only inbound SMS are separate rollout checks.
