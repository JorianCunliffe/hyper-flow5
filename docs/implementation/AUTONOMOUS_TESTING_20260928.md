# Autonomous acceptance and regression work — 28 September 2026

## Scope and live evidence

User authorized autonomous testing and repair while unavailable. Existing live authority remains limited to the specified team identities; emails remain draft-only. The Morning Run schedule remains paused. Complete SH-01–SH-24 acceptance is still **NOT ACCEPTED**.

The deployed **Recover existing draft** action successfully linked the existing accommodation enquiry to its Outlook draft. The native preview loaded the current provider body and continued to load after a full browser reload. The draft is the existing project-clarification reply, not a completed accommodation answer. No agent replay, replacement draft, email send, call, SMS or Sheet write was triggered by this recovery. The routing/configuration blockers remain separate.

## Repairs

- CI's cross-service jobs were pinned to obsolete Communications revisions and referenced removed `mailboxDraftUpdate.js` / `mailboxDraftUpdate.test.js` files. Pin both jobs to deployed Communications revision `1a456f7b9b47e4c357dc7279303bf63c19a80ce6`, run the current mailbox service/creation tests, and check the current shared provider-identity validation.
- Human Wait finalisation previously copied only the last response's values into its payload. It now carries the combined accepted values and attachments, preserving earlier voice/SMS answers across continuation.
- Provisional responses awaiting interpretation previously contributed values to `collectValues`, allowing an unreviewed field to count toward completion or overwrite an accepted field. Shared collection now excludes provisional values and attachments.
- Live browser testing found that the Responses selector included excluded messages, failed attempts and review-only emails despite counting only prepared drafts and linked responses. Its filter now uses the same two categories as its count. Lint and production build passed after this UI correction.
- A seven-enquiry, two-batch Firebase integration test reproduced premature digest delivery after the first five messages. Delivery now waits until reconciliation finishes; the digest's new-message count covers all batches in the occurrence. The test simulates a worker restart, verifies all seven enquiries reach the planner output without reprocessing, and checks one complete digest draft.

## Added coverage

- Real Firebase emulator: cold-cache triage updates, four concurrent draft recovery attempts, exactly one recovery audit record, conflicting linkage rejection, missing-record preservation and denied direct browser writes.
- Human answers: provisional fields cannot complete the Ask, accepted values survive later unreviewed suggestions, combined voice/SMS responses reach the hold payload, unrelated/open Asks cannot release the hold, and provisional attachments remain excluded.
- Connected Sharehouse morning graph: five task operations, four distinct drafts, partial-answer hold, durable serializer round-trip, same-draft updates, four enquiry allocations, one shared inspection slot, two eligible SMS effects after business writes, and no repeated effects on replay. Planning and provider outcomes are synthetic; this does not prove real classification, provider delivery, calls, scheduling or the other recovery cases.

## Verification

Initial baseline: 806 HyperFlow tests and 409 Communications tests passed. Final post-repair verification: **810 HyperFlow tests, 20 cross-service/Firebase integration tests, 409 Communications tests, and 30 database-rule checks passed**, with zero skips in the test suites. Lint, API reference validation and production build passed. Both production dependency audits reported zero vulnerabilities. The expanded integration run initially found the stale mailbox contract; it passes after updating the deployed-revision pin and current contract assertions.

Java 21 was installed in a local test-runtime directory from the official Adoptium distribution, with archive checksum verification, to run the Firebase emulator. Production database configuration was not changed.

Follow-up production checks: Responses now displays exactly its four linked drafts after reload; CI for `9b239ef` passed and Vercel reports Ready. An existing Gmail draft preview successfully fetched native content (read-only); Gmail recovery itself is still unverified. Five unauthenticated probes (triage, operations, unsigned callback, Communications contacts and draft receipt) each returned JSON HTTP 401 as expected.

After the batch-digest repair, all **21 integration tests** and **24 focused scheduler/digest tests** passed, as did lint and production build. The pre-repair integration failed specifically because a draft was prepared during the incomplete batch.

## Occurrence checkpoint repair

The resumed-intake test was extended with 500 unrelated mailbox updates between batches. It reproduced silent loss of all seven planner input items because intake used the tenant's rolling 500-item inbox query. Occurrence-specific checkpoints now preserve the complete intake output independently of that query. Existing in-flight records are backfilled when still available; already-evicted historical records cannot be reconstructed by this migration. Checkpoints are included in tenant export/deletion scope, deny browser reads/writes, and follow tenant suspension rules.

After this repair, all 21 integration tests and 26 focused scheduler/digest/lifecycle tests passed, with lint and build. Production rules inspection also found five committed runtime roots absent from the deployed rules (review execution/work/owner bindings, captured work and agent test runs). The tested repository rules, including the new occurrence checkpoint root, were deployed to the production database before the code release.

## Live Morning Run configuration continuation

Code revision `fd91668` passed CI and reached production Ready. Through the supported node editor, the live Morning Run now has typed finalisation collections for enquiry upserts (key: email), inspection appends (key: slot id), and SMS notifications (key: person id). Fresh-result requirements prevent notifications before the enquiry/inspection outputs succeed. These steps remain manual, and no effects were executed during setup.

Inserted `08b — Update existing mailbox drafts with confirmed answers` between finalisation and the communication log. It consumes `cairns_finalisation_text_output.structured_output.drafts`, keys each item by the original `provider_draft_id`, and requires fresh initial draft and finalisation results. Reload verified that this node and its collection configuration persist. The existing human-review gate on finalisation remains in place.

Remaining configuration includes verified communication logging, the finalisation prompt's exact row contracts and attendance/contact eligibility checks, and confirming the team call identity. The controlled enquiry is still awaiting correct project routing. These configuration improvements are not live execution acceptance.

Follow-up: the communication log now consumes successful draft-update receipts, using their provider draft ID, revision and update timestamp. Its text explicitly records an unsent draft; this does not cover the separate required call/SMS failure audit. The finalisation prompt now specifies exact Sheet columns, attended exclusions, source person identities and pending human email delivery. Human review remains required.

Two additional code gaps surfaced during this setup: the mailbox action adapter discarded supplied revisions, and structured schemas rejected minimum/minItems constraints. The adapter now validates and forwards optional positive integer revisions; the published API contract includes revision. Schema validation now supports finite numeric minimums and array lower bounds, with regressions for invalid revisions, short/long rows and invalid schemas. This guards service revisions; human edits made directly in the provider still require separate conflict evidence. The live finalisation schema must be tightened after this deployment; its currently saved prompt alone is not row-length enforcement.

Revision `00e5b47` passed all 811 unit tests, lint/build/API validation and CI, then reached production Ready. The live finalisation schema is now saved with integer revision >= 1, exactly ten enquiry cells and exactly six inspection cells; re-opening the editor verified these constraints and the retained human-review gate. The team Ask briefing now includes prepared draft collection items as well as the plan. It retains Carol/Jorian identities and the ten-minute retry without dispatching a call.

A read-only audit of the persisted 13-node Morning Run graph verified no cycles or missing dependencies, valid report schemas, 15 required-result dependencies pointing to upstream producers, and no enabled automatic action nodes. Configured inspection hours are weekdays 13:30–16:30; slot length/capacity and contact-policy setup remain listed as unresolved. Setup notes also contain stale mailbox/Sheet/contact items already addressed elsewhere, so those notes alone are not authoritative proof of current grants. No live flow execution or acceptance pass is claimed.

## Remaining acceptance work

The live enquiry is not yet routed into Morning Run. Its existing clarification draft must be preserved when progressing. Finalisation collections and same-draft update wiring are saved, but still require live execution evidence. Real Gmail recovery, full team-answer/callback paths, provider failures, inbound incident handling and SH-01–SH-24 require further evidence. No synthetic fixture result or green deployment changes the overall acceptance result.

### Mailbox body replacement repair

Provider adapter regressions reproduced three failures: text-only Outlook updates retained and selected old HTML; Gmail text-only and HTML-only updates retained the stale opposite MIME alternative. Communications revision `5a49f2c` makes a supplied body replace the old alternatives while subject-only edits preserve the body. Eight new provider-adapter cases cover both providers, single/dual body representations and omitted-body updates; all 417 Communications isolated tests passed with zero skips. API documentation now states these semantics and explicitly distinguishes service revision checks from detection of direct provider edits, which remains unresolved. Revision `cac5596` also includes mailbox modules in the deployed build fingerprint (expected `e8124c0893d3`); the earlier fingerprint could not prove mailbox changes had reached production.

Deployment follow-up: Replit publication succeeded and production `/health` returned `status: ok`, build `e8124c0893d3`, matching the repaired source fingerprint. All 21 cross-service/Firebase integration tests passed against this Communications checkout. One health request during promotion returned HTTP 500; the next check returned healthy. This verifies the running code, not a provider mailbox update. Replit's publish checkpoints were preserved and pushed to main (`128ee24`).

### Provider edit detection

Communications `dba3886` compares Gmail's current message ID with the saved last-written message ID before replacement. `5f7c0c8` adds Outlook change-key comparison and migration 041, which stores the marker at creation/recovery and commits subsequent markers atomically with service revisions. Changed drafts return `DRAFT_PROVIDER_CHANGED`; missing baselines return `DRAFT_VERSION_UNAVAILABLE`. Normal previews do not adopt externally changed versions. A failed key remains failed on replay without another mutation.

All 422 Communications isolated tests and all 21 cross-service/Firebase integration tests passed. The added real-database Outlook scenario verifies two successive updates, external edit rejection, unchanged revision/baseline after rejection, legacy missing-version hold, and denied public-role execution of the finalization function. Two older test fixtures were updated for the new schema/migration count. Replit's development migration and a read-only column query succeeded; publication requires the additive production schema review.

Replit's production schema review showed only an additive nullable text column. After approving that reviewed change, publication completed and live `/health` returned `status: ok`, build `210b4be6ad4f`, matching Communications `5f7c0c8`. The startup command includes the repository migration runner. No provider mutation was used to verify this deployment.

These guards detect changes already present at the provider GET. They are not atomic provider compare-and-swap and do not establish SH-21's concurrent-edit guarantee. Live provider conflict tests and an explicit operator reconciliation workflow for old drafts remain outstanding; the existing Morning Run Outlook draft must not be silently re-baselined to bypass this hold.

Outlook follow-up `3046dc8`: PATCH now contains only explicitly supplied fields. It no longer copies omitted body/recipient fields from a stale GET. A simulated between-read-and-write edit to those unrelated fields survives a subject-only update; an explicitly empty CC array still clears CC. All 423 Communications tests passed. This narrows the overwrite surface; it does not prove concurrent updates to the same field are protected. The official Gmail draft-update reference does not establish an atomic version precondition, and the Graph message-update reference alone does not establish that guarantee for both providers.

### Contact-policy audit and regression

Read-only production inspection confirmed Brisbane contact hours 09:00–17:00, a tenant daily budget of 20 and a per-contact daily budget of 2. Carol has only the Morning Run project grant; Jorian also has its grant. The separate capability-policy record is absent. Legacy actions include `send`, which enables SMS as well as email authority; Communications settings retain `draft_only` email policy. Absence of a literal `sms` action does not mean SMS is disabled.

The required no-answer sequence needs three contacts to the primary person (two calls plus callback SMS), so its callback SMS cannot pass the saved per-contact limit after both calls. Contact hours were also closed during this audit. No live policy was widened and no calls or messages were dispatched.

A regression using the real escalation runner, contact-budget logic and durable dispatch wrapper confirms: three expected call attempts; denied primary SMS remains at step 3 with an actionable error; saved-state reload produces no additional delivery; a fixture-only limit change resumes the same SMS without repeating calls; an after-hours fallback SMS stays at step 4; and reopening the simulated window completes both callback messages while retaining the unanswered Ask. All 12 focused capability tests passed. This establishes safe holding under the current limits, not live callback acceptance.
