# Cairns Sharehouse — Morning Run v2

Status: controlled v2 flow has completed a successful operator test; complete SH-01-SH-24 acceptance remains unaccepted. Updated 4 October 2026. The setup snapshot below records the original 30 September configuration; current changes and test evidence are in the retest journal.

Project: `1790716687348`, [Cairns Sharehouse — Morning Run v2](https://hyper-flow5.vercel.app/?project=1790716687348).

## Saved configuration

- Created a fresh project with 17 sequential nodes, without copying the original run, cursor or action outcomes. Reopened all 17 node configurations and inspected their saved settings; the project survived a page reload.
- Outlook connection references the existing `info@cairns-sharehouse.com` mailbox. Project email sending remains off; no recurring schedule was activated.
- Reused the original Google connection and exact spreadsheet. New-project resources: `enquiries` → `Enquiries!A2:J` (read), `inspections` → `Inspections!A2:F` (read and append).
- Live sheet inspection confirmed the title is **Cairns Sharehouse — Live Acceptance Test — 2026-09-27**, and the inspection columns are `date`, `time`, `property`, `attendees`, `group_size`, `status`. Confirm that this test-labelled diary is suitable before production activation.
- Carol's existing Communications identity is assigned to the voice Human Wait and final SMS. Carol and Jorian's existing Sharehouse participant access was carried over to v2.
- Root setup hold blocks progression. Planning has a Jorian web review before draft and booking effects. Actions stop on failure. Draft and booking arrays use stable item keys; booking appends use an explicit idempotency key.
- A final Decision allows draft finalisation and SMS only when the booking verification output is true. No matching condition leaves the branch waiting.
- Saved approved static business context, the 30-minute default / confirmed 15-minute option, uncapped group size, and diary column mapping.
- No workflow action was run: no mailbox drafts, calls, SMS or diary bookings were created during setup.

Remaining blockers: the server-side availability adapter is missing (`v2_availability_adapter_url` deliberately unresolved), initial mailbox/backlog coverage and provider draft-version reconciliation need verification, and controlled persisted-run/conflict/recovery acceptance has not run. The saved graph is configuration evidence, not provider acceptance.

Evidence: `artifacts/sharehouse-v2/saved-node-audit.json` and `artifacts/sharehouse-v2/carol-call-configuration.png`.

### Availability connection setup

Prepared [PR #60](https://github.com/JorianCunliffe/hyperflow-5/pull/60), commit `2b63e79`, in the managed `sharehouse-availability` worktree. Named read-only Webhook connections enforce trusted tenant/project scope, resolve the URL server-side, reject caller overrides and redirects, and return only the selected response field. Thirty focused tests, TypeScript and build passed. The code is not yet deployed to production.

Saved `WEBHOOK_CONNECTIONS_JSON` in Vercel Production, scoped to this exact v2 project. Its connection name is `cairns-room-availability`, the response path is `details.userMessage`, and it expects Zoho `code: success`. These response details still require fresh provider verification. Updated node 04 to `{"connection_name":"cairns-room-availability","method":"GET"}`; the earlier unresolved adapter-URL placeholder is superseded.

The operator subsequently supplied the credential-bearing URL. It was saved directly as the sensitive Production variable `WEBHOOK_SECRET_CAIRNS_AVAILABILITY`, without writing its value into repository files, workflow templates or this document.

### Live availability verification — 30 September 2026

- Deployed commit `2b63e79` to Production: `dpl_4kTJTSFnPZzc1sn2UPxm1BCjxCCh`, aliased to `https://hyper-flow5.vercel.app`.
- Ran only node 04 through the live editor. It completed at 08:27:08 Brisbane, HTTP 200; `webhook_fetched_at` was `2026-09-29T22:27:07.702Z`.
- Returned room identifiers: `Lady Loeven-U1-R5`, `Lady Loeven-U4-R2`, `Lady Loeven-U4-R3`. No Martyn room was present in this response. This is a point-in-time list, not a future availability or capacity guarantee.
- Stored output contains the connection name, timestamp, HTTP status and room IDs, not the credential-bearing URL. `v2_availability_success` was the only successful-action marker in the project.
- Removed the availability-connection blocker and renamed node 04 to indicate verification. The setup hold remains in place; no calls, SMS, native drafts or diary bookings were triggered.
- PR #60 merged as `4e9cf8c3a8cdf91d7bd1d37911d6c20b333d3874` after all GitHub checks passed. This retains the connection support on main for future deployments.
- Proof: `artifacts/sharehouse-v2/availability-verified.png`.

Remaining acceptance work: establish initial mailbox/backlog coverage, reconcile existing provider draft versions, confirm whether the test-labelled diary is the intended production diary, and run the complete persisted workflow/recovery checks. A successful availability node is not full Morning Run acceptance.

## Confirmed operator decisions

- Use the existing Inspections booking diary as the authoritative record.
- Inspections take around 15–30 minutes. Default planning allowance: 30 minutes; use 15 minutes when Carol confirms it is suitable.
- No maximum group size. Several parties may join the same property/time slot. This does not permit overlapping appointments at different properties for Carol.
- Read the emails and fresh room availability before calling Carol. Ask her availability for the actual Brisbane run date and consolidate other questions arising from the emails into that call.
- Draft response emails after her answers, book inspections, then SMS Carol the recorded inspection times. Email remains draft-only.

## Required sequence using existing primitives

1. **Email Triage / evidence Report:** complete all intake batches before planning; reconcile outstanding enquiries from the enquiry register. Preserve source/thread IDs and existing draft IDs. Resolve truncated email evidence before answering substantive questions. Establish the initial backlog explicitly; an incremental cursor alone does not establish that all outstanding mail has been read.
2. **Read Sheet:** read the existing enquiry register and Inspections diary with their existing named resources and exact column mappings.
3. **Webhook / Report:** fetch fresh Zoho availability through a server-side secret-backed connection. Distinguish a successful empty list from a failed request. The room list does not establish future availability, occupancy capacity or appointment availability.
4. **Report:** produce a deduplicated question list. Always ask Carol for the run date's availability windows and property/location constraints. Include only unresolved email questions; omit already established business facts. Ask about travel time where different properties would otherwise conflict.
5. **Human Wait, voice delivery to Carol:** freeze the question schema, confirm answers and retain partial answers. Continue only with confirmed scheduling facts. An unanswered call or provider callback is not an answer. Missing answers block affected bookings/replies.
6. **Report:** allocate requested inspections within Carol's confirmed availability. Use 30-minute slots by default, 15 minutes when confirmed suitable. Group compatible requests at the same property/time without a numeric attendee cap. Preserve existing appointments and allow confirmed travel time between properties. If today's date changes while waiting, refresh availability before allocating.
7. **Create/Update Mailbox Draft:** save individual, correctly threaded responses, addressing all questions supported by evidence. Reconcile and reuse existing provider drafts; do not overwrite an unidentified version or create a duplicate. At this stage describe intended times as proposed/reserved, never claim a diary write has already succeeded.
8. **Read Sheet / booking write:** refresh the diary immediately before writing, recheck conflicts, then record the allocation using stable enquiry/appointment keys and the existing diary schema. Replays must reuse the same booking rather than append duplicates. Verify the stored rows. Do not silently replace other operators' bookings.
9. **Update Mailbox Draft:** where necessary, update the same draft to reflect the actual recorded appointment. A saved draft does not establish that the prospective tenant has received or accepted the time.
10. **SMS to Carol:** generate the dated schedule from verified diary records, including property, time and attendee names/counts needed for the inspection. Send only after the required booking writes succeed; do not include merely proposed appointments. Record the provider receipt and avoid duplicate sends on recovery.

## Remaining implementation and acceptance work

- Configure the credential-bearing availability endpoint server-side; do not place the URL in browser-visible node JSON, model context, documentation or logs.
- Verify the diary's actual columns, row keys and conflict/replay behaviour. A Sheet upsert alone is not an atomic reservation lock against concurrent writers.
- Configure Carol using her verified Communications identity and applicable contact policy. The earlier Jorian-only evening-test authorization is not a permanent Carol contact policy.
- Build a fresh v2 definition before its first persisted run. The previous manual-node / active-FlowRun mismatch must not be carried into this workflow. Verify results and confirmed answers survive a reload and continuation.
- Preserve draft-only email settings. Keep scheduling inactive during construction and controlled verification.
- Run the complete acceptance baseline in `SHAREHOUSE_ACCEPTANCE_TEST.md`; a specification, node configuration or isolated successful action is not full acceptance.

The specification was subsequently used to create the inactive project described above. No schedule, diary row, email draft, phone call or SMS was created during setup.

## Standing rules saved 4 October 2026

Project Data and the question, call, booking and verification prompts now use 15-minute inspections and five-minute travel gaps. Prefer Martyn Street at 16:00 and other apartments beforehand around 15:30; confirmed availability and the existing booking diary take precedence. Group size remains uncapped. Derive the run date from the scheduled occurrence in `Australia/Brisbane`; ask about dates only for a conflicting or explicitly future-day request. Ask one question at a time and wait for the answer.

These saved definitions apply to new occurrences. Active runs retain frozen definitions. Controlled test contacts remain Jorian only and replies remain unsent drafts; the successful operator test does not authorize general production activation. See [retest journal](implementation/SHAREHOUSE_V2_RETEST_20260930.md).
