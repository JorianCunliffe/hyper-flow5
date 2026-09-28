# Sharehouse live setup test — 27 September 2026

Result: **FAIL / STOPPED at the first failing execution step. Overall acceptance NOT ACCEPTED.**

HyperFlow production: `c176d2491a4b4344740236462f583d9fdcb30f8b` (GitHub CI success). Communications deployment `34ef1273-a429-436c-a250-6493db773bf4` reported success after the Replit merge containing contact fix `5b4bd8a`; the exact merged Replit commit was not captured.

Project: Cairns Sharehouse — Morning Run (`1789625624932`). These were individual node setup checks, not one complete persisted workflow occurrence. Times are Australia/Brisbane.

## Setup saved

- Carol contact `91d60b7f-0b8c-4a36-84a3-a69d9ad6ec3d`, phone +61414022817, created and confirmed in the live directory.
- User approved Carol access to Morning Run only; selected that grant and saved the agent profile.
- Morning Human Wait assignee and primary escalation person set to Carol. Fallback set to Jorian `39edc52f-7af6-43c1-a2db-53ad43bd9ddf`. Retry configured for ten minutes, repeat weekdays 09:15 Brisbane. Corrected the old primary number in the reason text.
- Human Wait question source is still `cairns_plan.open_questions`; it must be aligned with the planner's actual validated output before execution. The Wait has NOT been run.
- Schedule remains paused. Email remains draft-only.

## Live observations

| Step | Result | Evidence |
|---|---|---|
| 02 Read enquiry register | PASS, individual read | 21:24:27: COMPLETED; read `Enquiries!A2:J1000` through the named resource. |
| 03 Read inspection slots | PASS, individual read | 21:25:04: COMPLETED; read `Inspections!A2:F1000` through the named resource. |
| 01 Outlook intake | PASS, individual execution only | 21:26:43: COMPLETED; processed 0 messages, skipped 0. This does not establish classification or test-fixture coverage. |
| 04 Planning | **FAIL** | 21:27:42: FAILED, `Missing flow input: cairns_triage_output.triage_items`. The same missing path was visible in the resolved-input preview before execution. |

The data picker showed intake counts/cursors/digest metadata, but no `triage_items`. Sheet outputs showed IDs/ranges/read timestamps, but no `google_sheet_values`. Source `lib/executeTask.ts` defines both collection outputs. Empty collection preservation through execution/persistence is a suspected cause, not yet proven. Do not replace missing data with invented successful output.

Stopped at this failure as requested. No call, SMS, draft creation, Sheet write or automatic email send was attempted in this test turn. No SH case is promoted to full PASS.

Next investigation: trace zero-item outputs through the executor and persisted project/run state; distinguish legitimate empty collections from missing/failed inputs. Recheck after reload, fix the Human Wait source binding, finish remaining configuration, and restart a single complete controlled occurrence with the required mailbox fixture.

## Empty-result repair

The failed planner input was reproduced with the installed Firebase Database SDK serializer: RTDB removes empty arrays, empty objects and null leaves. Executor results were correct before persistence. Existing list-specific normalization did not protect dynamic JSON outputs.

The repair stores private structural metadata on project, FlowRun and action-dispatch records, decoding it at browser/server/API read boundaries. Browser and API writes regenerate the metadata after edits. It preserves empty and nested collection results, null array entries and cached action outcomes without treating legacy missing inputs as successful empty results. Existing lossy records require fresh producer execution; no guessed-output backfill is performed.

Regression coverage uses the actual Firebase serializer for workspace save/reload, the Sharehouse planner bindings, FlowRun state, durable action replay, removed/legacy inputs, and prototype-safe metadata handling. Live recheck is recorded below after deployment.

### Production recheck

- Repair commit `47af42a3850b8f81ca5413fcb365e925f8d98ed0`: GitHub CI succeeded; Vercel production deployment `dpl_HXmh2bYuamX8RC9KgU6ngeTqug4X` Ready. Local validation: 794 tests passed, lint and production build passed.
- Re-executed both Sheet reads successfully and Outlook intake (21:45:46, processed 0, skipped 0). Reloaded the app, restored the project, and inspected the planner's resolved template: `messages`, `enquiries` and `inspections` were all present as `[]`. This verifies saved database values, not only immediate execution output.
- Retried planning at 21:49:28: **COMPLETED**, with structured output validated against the configured schema. The output explained that no source messages were supplied and contained `tasks: []`, `drafts: []`, `open_questions: []`.
- Empty-result persistence blocker is repaired in production. This was a current-code persistence gap, not an old deployed build. Existing list-specific restoration did not cover dynamic action outputs.
- These remain individual empty-input checks. No live call, SMS, email draft or Sheet write was triggered during the repair verification. The schedule stays paused and full Sharehouse acceptance remains **NOT ACCEPTED**; the Human Wait binding and remaining controlled end-to-end fixture still need completion.

## 28 September: live enquiry and draft recovery

The test enquiry `comm_44abaf0a317f4804ad440c2cc5ca3b99` was received at 15:48:32 Brisbane and is visible in All projects. Morning Run's partial intake view did not yet include it. Its inbound agent job reports HTTP 409, `Draft operation requires provider reconciliation before retry`. Mail arrival is confirmed; draft creation is not. A user-run query in the Replit shell returned no receipt for that tenant/communication pair, which does not establish that the published app uses the same database or that no provider draft exists.

Communications Service `ec345fe` repairs creation recovery: valid reservation status, safe pre-provider retries, retained Outlook partial-create IDs, read-only reconciliation of matching known drafts, and durable success despite an audit outage. Its 402 tests pass; publication and the existing receipt's recovery still need verification.

An additional source inspection found that inbound agent replies used the organization default mailbox and the client omitted `email.provider_connection_id`. HyperFlow now preserves that source identity and chooses the receiving connected mailbox. Missing identities cannot fall back to an unrelated configured mailbox. New jobs record the source-routing contract; legacy jobs that could have used a different default stay held even after manual replay, until the original effect is reconciled. This is a confirmed code defect; the exact original provider error remains unverified.

Full acceptance remains NOT ACCEPTED. Do not clear old receipts, change operation keys, or retry uncertain creates to bypass the 409.
