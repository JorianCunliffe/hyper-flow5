# Sharehouse controlled acceptance — 10 October 2026

## Scope and boundaries

Goal: complete the full Morning Run v2 and exercise approximately five calls and five SMS cases. Only Jorian's configured person identity may receive test communications. Emails remain unsent drafts. Diary writes require explicit TEST ONLY inspection confirmation. Automatic schedules remain disabled. Do not replay uncertain provider effects.

Project: `1790716687348`. Latest full-flow completed occurrence: `fr_eaf7cb1d73e44eda497ce32b630b`. Earlier recovered full occurrence: `fr_3351c1e354f8389059093108b9eb`. Isolated SMS occurrence: `fr_167224b61d2e0806e9f96fe28ecd` in communications-test project `1787628008985`.

## Current acceptance checkpoint — 11 October

The sections below are chronological evidence; older pending/failure statements are retained as history, not the current result.

| Requirement | Current evidence | Result |
| --- | --- | --- |
| Full Morning Run v2 | Fresh 11 October run completed with all 20 node attempts completed, original draft updated, one TEST ONLY booking/readback and final delivered SMS | PASS; standard review/advance controls, no run-state repair |
| Approximately five calls | C1–C6 handset calls recorded below; C6 answered automatically; earlier C1/C4 recovery limitations retained | Volume reached |
| SMS-linked forms update Ask state | Three submitted forms saved values and released their Wait; latest used 19 as isolated test data | PASS |
| Natural direct SMS binds to pending Ask | Post-fix handset policy reply matched the original Ask without project clarification | PASS after correction |
| Partial answer followed by next SMS question | Policy saved separately; numeric follow-up delivered | PASS |
| Final direct SMS answer completes Ask once | Handset "22 minutes" saved as numeric 22; Ask answered and owning Wait completed with two distinct source receipts | PASS |

Correction `db4c201` is production READY. CI `38092087326` completed successfully; 35 targeted tests and TypeScript also passed locally. The post-fix direct SMS sequence and fresh full-flow occurrence now pass. The requested controlled volume covers six calls and at least five SMS cases (three form submissions, the direct two-answer sequence, and delivered final schedules). These are varied cases, not five consecutive defect-free full runs. Earlier failures and recoveries remain recorded. This acceptance does not activate the public receptionist or automated schedules, or claim the wider SH-01–SH-24 programme is complete.

Inspection rules: 15 minutes, five-minute travel between properties, Australia/Brisbane dates, preferred Martyn Street 16:00 and other inspections around 15:30, subject to confirmed availability and diary conflicts.

## Evidence and regressions

The original call `comm_3a18e16cf0554c788ceac746693d3354` captured a clear answer rejecting direct bookings and requiring listing-site screening. Both callback interpretations recorded high confidence but no field values. Ask `ask_d6339c703b6f4cdab8f5ab8f0d3e1e98` remained open. The interpreter schema defined `values` without its declared Ask fields. The fix declares typed fields while permitting missing answers; confidence and human-review gates remain enforced.

Local regression: 106 targeted tests, the full 987-test suite, and TypeScript checks passed. Fix `9134c2b` deployed READY as `dpl_3YCkoiL9R27bfVCBvv9dRzRayQqc`. A fixture or successful call delivery alone does not pass a workflow case.

The original answer was reconciled through Inbox's existing Accept interpretation action. The v2 Ask is now answered. This was a reviewed recovery, not automatic live-test success.

Fresh C2 used the standard Human Wait in the existing communications test project (`1787628008985`), with a disabled manual schedule (`schedule_aa1da009f01d4d2195a91915c65ac713`). Run `fr_016d03e60275e8eab015bdca632f`, Ask `ask_c9a0cd1ca12246eb904dfd94ad06fd0b`, call `comm_e4ee32ef20a54c729297b747f15986fb`: provider reported human_completed, 65 seconds. The first callback preserved the policy answer without closing the incomplete Ask. The full transcript callback extracted `inspection_minutes: 20` after the caller confirmed the read-back, and the Ask automatically became answered. The spoken numeric turn was missing from the partial transcript (one unintelligible segment), so the confirmation-bearing full transcript was necessary. No inspection defaults were changed; 20 is isolated test data.

S1/S2 occurrence `fr_5b90d9cac525c183587d65e0e09b`, Ask `ask_4a17bfc5b3f349f39893fda68d9d1325`, notification `comm_ba79998aaf17402c99b0584ad782a0e0`: SMS delivered at 06:13:05 UTC; no response recorded at the next check. The delivery event `evt_b59bb8175feb403a8ba4d95760c3d194` incorrectly entered action completion and failed with `no_matching_pending_run`. A separate fix records Human Ask notification delivery/failure without resolving the question or routing it to action completion. Pending live receipt verification after deployment.

CI found an existing critical `proxy-addr` advisory. The lockfile was updated from 2.0.7 to 2.0.8; production dependency audit is clean. Receipt-fix targeted tests, TypeScript and build pass.

Receipt fix `95f2fb4` is READY in production (`dpl_62MELZ1qLqHFaojoALfUrEmUqwBK`); CI run `38030459924` passed all jobs. The original failed receipt was not replayed or represented as repaired evidence.

C3 occurrence `fr_57a28b6bed3ee2581d2dc336617e`, Ask `ask_2937724e2f3c4550adcbf457cd008684`, call `comm_0ead518449424c23aa75714cec3cbeda`: caller gave “17 Scotch Street”, said availability was confirmed, and confirmed the read-back. Automatic extraction stored `test_property: "17 Scotch Street"` and `staff_available: true`; Ask answered. This verifies the boolean case, not uncertainty: the caller did not provide an uncertain answer. No booking was made.

## Live test matrix

SMS/form status audit: the original S1 run remains waiting and its Ask has no saved responses. The incoming SMS was routed to a six-project clarification (`comm_4669a1c30bc2469a90217f3fd0e68128`); that job's completed status describes routing work, not the question's completion. Added executed form-script tests for same-link submission, false boolean values, completed vs partial/review feedback, rejected submissions, and reopened answered/cancelled/expired links. The form now explicitly distinguishes a saved response from a completed question and retains the form for incomplete/review responses. Live handset/form submission remains outstanding.

Uncorrelated handset reply `comm_67258475098049b089b6b628369ae4f9` contained “No we have to go through the booking form” but arrived as ordinary SMS, entering general project selection. Added a pre-routing pending SMS question check: current permitted project, owning active run, open nonexpired Ask, accepted SMS delivery, same verified person, reciprocal sender/receiving line and provider Ask receipt within 24 hours. Exactly one candidate enters the existing durable Ask response event path with a stable source-derived event ID. Multiple candidates require review; provider thread IDs are not rewritten. Focused tests and TypeScript pass. Fresh handset acceptance is still required; no replay of the earlier SMS was initiated.

SMS form regression: the original S1 Ask remains open in `fr_5b90d9cac525c183587d65e0e09b`, but later call runs contain cancelled historical copies. Lookup incorrectly returned the first copy instead of the persisted owner. The fix resolves the owning run before returning or accepting an Ask, including owners outside the recent-history page. Delivery aliases require a supplied matching identifier. Forty focused tests and TypeScript checks pass. Fix `e7c8344` deployed; the original delivery-token endpoint now returns HTTP 200 with the correct Ask open, and HTML contains the response form rather than a cancellation notice. No replacement SMS or fabricated form response was submitted.

| Case | Scenario | Required evidence | Status |
| --- | --- | --- | --- |
| C1 | Clear natural-language policy answer | Answer mapped to the current Ask; question completed | Original failed; reviewed recovery complete; fresh policy extraction passed in C2 |
| C2 | Multiple questions, one per turn | All required fields captured; no repeated answered questions | PASS automatic field extraction and completion; individual read-backs were repetitive |
| C3 | Partial or ambiguous answer | Missing field remains open; useful clarification/review | Boolean answer passed; uncertainty scenario still not covered |
| C4 | Correct an answer before confirmation | Final confirmed answer wins; original evidence retained | PASS: caller changed 10 to 18, confirmed 18; Ask automatically answered with 18 |
| C5 | Inspection availability and read-back | Correct date/duration/travel, explicit TEST ONLY confirmation | Not run |
| S1 | Natural answer to a linked SMS Ask | Correct current Ask progresses | Delivered; awaiting handset reply; receipt routing bug found |
| S2 | Partial multi-field SMS answer | Next missing question only; no premature completion | Not run |
| S3 | Natural project clarification | Correct project and conversation continuity | Not run |
| S4 | Duplicate delivery/event | No duplicate response or workflow effect | Not run |
| S5 | Final inspection schedule | Verified diary times and delivery receipt to Jorian only | Not run |

## Full-flow acceptance

Fresh-run failure found: question preparation replaced the email's Sunday 14:00 request with the Martyn preference of 16:00. Its call Ask `ask_c635e5d75e7a4276b74c124fb372bcfa` was held by contact hours before any accepted delivery. The run was cancelled conditionally after verifying that undispatched state, preserving the defective output as evidence. Updated the saved preparation/planning setup prompts to preserve explicit requested times, treat preferences as fallback only, distinguish alternatives from confirmed slots, and surface unavailable-property evidence. No contact-hours exception was applied; Jorian's choice about continuing after hours is pending. Read-only question preparation is being rechecked before another call.

C4 completed `human_completed` (60 seconds); transcript contains initial 10, correction 18 and explicit confirmation. Persisted Ask `ask_5cf1d6a722954b83925ca56a7efd2209` is answered with `inspection_minutes: 18`, no interpretation review required. Synthetic value does not alter business rules.

Fresh full-flow occurrence `fr_d00ebaffe876db31d693cb56f3b8` is bound to `comm_5cdbe5f5280a4a1f87a04fe8cb3fbef6`. The old missing-source occurrence was cancelled with its evidence preserved after verifying no draft/booking/final-SMS nodes had run. This was a conditional administrative recovery, not an automatic-flow pass. The new setup gate `ask_ccae800fe4a241fc94e8ae14c28e6327` was released through the authenticated UI within the existing Jorian-only test authorization; production restrictions remain. Fresh run is running and intake has been advanced, with no booking confirmed yet.

C4 recovery dispatch verified: original run `fr_849888cf17cfcc55d564e8393bc6`, schedule occurrence `1791613382784`, and delivery `delivery_8c15c1883dff5a6bf42c9025ac7f76ccc84d94a0c632537e0d476d3ab0c05051` were retained. Schedule attempt 2 reached waiting; the Ask records accepted communication `comm_66cb2987c8d94a3caccf696723586a44`. This is dispatch evidence only; correction transcript/answer verification remains pending. Recovery deployment is READY and CI succeeded.

Follow-up: the refreshed intake attempt `op:fr_a26a8fe0badb2b0b3f31be3fa395:m-1790716779527:2` completed after resuming its batch checkpoint and includes the new Jorian enquiry. Voice readiness recovered (all model probes working at 06:37 UTC). C4's original schedule receipt remains recoverable with `providerOutcome: not_dispatched`, rather than a completed/failed call. Added manual-run recovery selection so Run now reuses a held occurrence before allocating a new one. Commit `31364e2` passed focused tests and TypeScript; first Vercel attempt failed before build with `git_info_fail`, and the same commit was redeployed.

Fresh Jorian enquiry verified after mailbox synchronization: `comm_5cdbe5f5280a4a1f87a04fe8cb3fbef6`, subject `Tasty only - jorian inspection`, received 10 October 2026 at 06:06:23 UTC. It asks about available rooms at 80 Martyn Street and an inspection Sunday at 14:00 (11 October, Australia/Brisbane). This is a request, not confirmed staff availability or a booking. The manual draft-disabled intake refresh is still in progress; the existing v2 plan retains the old missing source binding and must be regenerated against the verified new enquiry before any downstream effect.

C4 run `fr_849888cf17cfcc55d564e8393bc6` retained its original dispatch operation and returned a manual-review hold. At 06:27 UTC the public health endpoint reported Twilio active with balance OK, but cached voice and recording-transcription probes had timed out. This does not establish exhausted model credits. Do not create a replacement occurrence to bypass the readiness hold; reconcile the existing operation before resuming.

Still required: fresh controlled email source; correct source/recipient binding; availability and diary reads; confirmed staff availability; unsent provider draft receipt; TEST ONLY diary write and read-back; original draft finalisation; final Jorian SMS delivery; terminal successful run. The old controlled source was absent from the current intake. This is not a completed full-flow test.

## Latest SMS/form recheck

Read-only production recheck confirms original SMS Ask `ask_4a17bfc5b3f349f39893fda68d9d1325` remains open in its owning waiting run, with zero saved responses. Later call runs still contain cancelled historical copies; these are not authoritative. Original SMS delivery-token URL returns HTTP 200 with a response form and no cancellation notice. Latest inbound SMS event remains `comm_67258475098049b089b6b628369ae4f9`; no fresh post-fix handset reply was observed.

Reran `flowRunAskLookup`, `askFormSubmission`, and `pendingSmsReply`: 13 tests passed. Covers original versus copied Ask, real cancellation, missing owners, same-link submission, false Boolean values, incomplete/review feedback, completed feedback, rejected submissions, and bounded SMS matching. Live form submission and resulting workflow progression remain NOT RUN after the fix; do not count URL availability as a completed test.

### Controlled question preparation recheck

Saved setup revision 1987 restricts preparation questions to the configured test source, with separate independently answerable fields. Read-only preparation `op:fr_d00ebaffe876db31d693cb56f3b8:m-1790716865528:3` completed successfully. It preserves Sunday 14:00, excludes unrelated financial/pest-control enquiries, and separates room verification from staff attendance. Fresh availability still reports no Martyn rooms. Alternative-property/time fields remain marked required even though conditional; this needs checking before the next call so irrelevant alternatives do not block completion. This is preparation evidence only, not a resumed cancelled run or a full-flow pass. No call, booking, draft or SMS was dispatched by this check.

### Initial-question verification — latest

Setup revision 1989 removes conditional alternatives from the initial required Ask fields. Preparation `op:fr_d00ebaffe876db31d693cb56f3b8:m-1790716865528:4` succeeded with exactly two fields: room availability at 80 Martyn St; staff attendance Sunday 14:00. Neither alternative property/time nor unrelated enquiries appear. The fresh availability gap remains explicit. No provider contact or diary write occurred. The cancelled run remains cancelled; this check updates preparation output only.

Remaining live prerequisites: original SMS-form submission; explicit choice about after-hours controlled contact; actual room/staff confirmation before a TEST ONLY booking. Full-flow and approximately five-call/five-SMS acceptance remain incomplete.

### Live form acceptance and after-hours authorization

User submitted the original SMS-linked form. Owning Ask `ask_4a17bfc5b3f349f39893fda68d9d1325` is answered with web values `direct_booking_policy: No` and synthetic `inspection_minutes: 17`; run moved waiting to running. This passes the live form submission/Ask progression check, not whole-project completion. Business inspection defaults remain 15 minutes. User explicitly authorized continuing after hours with existing Jorian-only boundaries. Added bounded recipient/project/channel/time contact-policy exceptions so this need not expand workspace-wide hours; 25 focused policy/execution tests and TypeScript passed.

### After-hours live run

Commit `d95ce05` is deployed READY; CI `38034260035` passed. Administrator UI reviewed/applied contact policy revision 2 with exact Jorian target, SMS/voice channels, and projects `1790716687348` / `1787628008985`. Exceptions expire approximately 19:26 Brisbane on 10 October; ordinary workspace hours and budgets are unchanged. Fresh run `fr_3351c1e354f8389059093108b9eb` passed setup approval and completed intake, enquiry/diary reads, live availability and question preparation. Ask `ask_23e8d869c4c34a69a2890da398c72aac` has two independent room/staff fields. Call `comm_026c2e7bb78947e3880c0da0acce575e` was accepted and started at 17:30 Brisbane. Answers and subsequent provider effects remain pending.

Call completed and answered automatically: room yes; Sunday unavailable, Monday 14:00 offered and confirmed. Planning approval retained applicant-time distinction and authorized only TEST ONLY diary rows. Existing Outlook draft `a487b8a1-ebcd-482a-871d-cbe28a76139e` updated in place to revision 2, then finalised to revision 3, both draft-only with provider change keys. Diary write receipt/readback confirms exactly one new row `Inspections!A5:F5`, Monday 12 October 14:00–14:15, The Martyn, TEST ONLY - Jorian. Final SMS was blocked pre-provider by the separate two-contact daily budget (`provider_called:false`); full run is failed at node16 and not yet accepted. Preparing a reviewed, maximum-ten recipient allowance scoped to the same temporary exceptions; no completed diary/draft operation should be replayed.

### Full-flow result: completed with recorded recovery

Final SMS `comm_f0b4f90b530d403c9513011f014cad06` was delivered at 17:42:37 Brisbane. Owning run `fr_3351c1e354f8389059093108b9eb` is `completed`; node16 is success. All earlier completed provider effects were retained. The original SMS budget rejection was confirmed `provider_called:false` in both run and dispatch receipt, then conditionally reopened only that node as attempt 2 in the same run after human-session policy revision 3. This is an end-to-end controlled success with explicit administrative recovery, not an uninterrupted automatic run. Commit `17f4412` deployed READY; CI `38035071973` passed. Temporary recipient allowance 10 applies only to Jorian, the two test projects, SMS/voice, until approximately 19:26 Brisbane; workspace daily budget unchanged.

Volume goal still incomplete: five handset calls have now occurred including original manually recovered C1; live SMS form passed, final SMS delivered, but fresh post-fix natural SMS matching and partial sequential responses still require handset evidence. No production activation is implied by this controlled result.

Fresh natural-SMS retest is live: run `fr_a665e477859e64c8ce7d3942aba4`, Ask `ask_0749ab54456642e3b2ac90b854a7cdec`, SMS `comm_1d96ccc1f18748e58c73901bb81e7947` delivered 17:44:08 Brisbane. Two-field Ask remains open awaiting a handset answer (policy first, numeric follow-up). No call or booking belongs to this isolated SMS test.

## 11 October — fresh SMS continuation

- Prior fresh SMS Ask `ask_0749ab54456642e3b2ac90b854a7cdec` was answered through the web form (No; 17). This does not prove direct SMS matching.
- Applied contact-policy revision 4 through administrator review UI: Jorian only, communications-test project, temporary exception 08:24–10:24 Brisbane, per-recipient daily limit 5. Normal contact hours and disabled schedules preserved.
- User-requested fresh manual occurrence: `fr_061375e6899a93494fc0a4a370fb`; Ask `ask_4ecc77fc6f324238be62d5bc0b44bafd`.
- SMS `comm_25889ef934d243798d1422f1dee15dac`: provider delivered 11 October 08:25:32 Brisbane; delivery event processed. No new call or booking.
- Awaiting handset-originated direct SMS answer to test correlation and partial answers. Full SMS acceptance remains pending.
- Follow-up verified: fresh Ask `ask_4ecc77fc6f324238be62d5bc0b44bafd` is answered via web. Stored listing-site requirement and synthetic inspection duration 19. Owning Wait attempt completed; run changed waiting to running. Other manual test nodes remain pending; this is not terminal workflow completion. SMS-link form submission/status propagation PASS for this occurrence. Direct SMS correlation/partial-answer acceptance still NOT RUN for this fresh occurrence. Production inspection default remains 15 minutes.
- Next direct-SMS case started on user request: run `fr_167224b61d2e0806e9f96fe28ecd`, Ask `ask_c957aca4cd304c07ba6b6a0f37e0c472`, SMS `comm_d79c4c37398944a387975954dee44e91`. Provider sent event processed at 08:27:58 Brisbane. Delivery receipt and handset answer pending at this check; no duplicate dispatch.
- Direct handset SMS received at 08:28:33 Brisbane: `comm_52e9cec7b7b745868e1a9a81da3844a1`, text "They have to go through the Cairns sharehouse website". Event processed and Jorian person ID recognized.
- FAIL: inbox job completed with routing kind `clarification`, reason `ambiguous`, six candidate projects, response `comm_248968ee69794820a8a8de250dac3902`. Pending Ask `ask_c957aca4cd304c07ba6b6a0f37e0c472` remained open with no saved response. Expected pending-Ask correlation and partial answer did not occur. Form success is unaffected; direct SMS acceptance failed.
- Investigation: authoritative owning run/Ask IDs and accepted SMS delivery are consistent; matcher reads acknowledged provider receipt and requires exact tenant/person/receiving-line identity. Precise rejection reason not yet established. Local read-only Communications API diagnostic unavailable because local deployment environment lacks COMMUNICATIONS_API_KEY; no credentials printed, no response replayed or run state changed.
- Root cause found in cross-service contract: Communications normaliseCorrelation returns `external_project_id` (converting legacy `project_id`); pendingSmsReply checked only `project_id`. Fixed canonical field matching, retained legacy-only compatibility, rejected contradictory fields. Regression now exercises the HTTP client with canonical v2 receipt, alongside wrong-project and conflicting-alias rejection. 35 targeted tests and TypeScript check pass. Live acceptance remains pending deployment/retest.

### Post-fix live SMS correlation PASS — 11 October 08:49–08:50 Brisbane

Handset message `comm_6035b536ad16482784fc5d93099496fa` ("They have to go through the sharehouse website") matched owning Ask `ask_c957aca4cd304c07ba6b6a0f37e0c472` in run `fr_167224b61d2e0806e9f96fe28ecd`. Persisted response is via SMS with the original communication ID and only `direct_booking_policy` populated. Canonical `ask.response.received` event processed. No general project-selection response was recorded for this inbox job. Ask correctly remains open and run waiting for numeric inspection duration. Follow-up SMS `comm_01f585202ada48cc906ea69c9371a887` accepted. This passes live matching and partial-answer persistence, not yet final sequential completion.
- Sequential completion PASS: `comm_8c6621183adb415a9061d9e656a5f073`, handset text "22 minutes", persisted via SMS as numeric `inspection_minutes: 22`. Both source communication and Ask response events processed. Ask is answered, owning Wait attempt completed, isolated run changed waiting to running. Exactly two SMS response records retain their original distinct communication IDs. No form submission or manual answer recovery was needed for this post-fix sequence. 22 remains isolated fixture data; business default is 15 minutes.

## Fresh full-flow retest — 11 October

User requested continued complete end-to-end acceptance after the sequential SMS pass. New source `comm_89080a3ba88b414e8bdc364228ac1b27`, subject "80 Martyn st enquiry TEST ONLY", from Jorian, asks move-in tomorrow and inspection 6 am. Bound as sole effect-eligible source at setup revision 2003; existing completed run and provider effects preserved. Policy revision 5 adds bounded Jorian-only v2 exception until 10:59 Brisbane, per-recipient maximum 10; schedules stay disabled.

New run `fr_eaf7cb1d73e44eda497ce32b630b` passed controlled setup gate. Intake includes full source and existing Outlook draft identity; diary and availability reads succeeded. Preparation preserves 6 am and reports no Martyn rooms in current webhook. Ask `ask_fc87a21c17f64bdeaf271731890cd5ed` separately requests room verification and staff attendance. Call `comm_7485c3d8907442669b7d147a3f19805a` started at 09:07 Brisbane. Awaiting call answer before downstream planning. Intermediate duplicate advance responses correctly held the still-running report operation; no replacement operation was created.

### Fresh full-flow PASS — 11 October 09:16 Brisbane

C6 call completed at 09:08. Its owning Ask automatically stored room `Unit 1, Room 6` and staff response rejecting 6 am in favour of tomorrow at 4 pm. The transcript includes correction from 3 pm to 4 pm and explicit readback confirmation. Tomorrow resolves to Monday 12 October in Brisbane. Planning preserves the applicant's requested time and treats 4 pm as staff-confirmed, with applicant acceptance pending.

Plan approval `ask_cee8c5a6681b4be89ea73712c0f9acf6` was completed through the standard review UI under the user's controlled-test instructions. No run or node state was repaired directly. Existing provider draft receipt `45abe85d-d3cf-4f60-8ef5-4ef01c44ed33` was updated in place to revision 2, then finalized to revision 3, with distinct provider change keys and `draft_only:true`; its original provider draft identity was preserved. No new response draft was needed, and no email was sent.

Diary append operation `op:fr_eaf7cb1d73e44eda497ce32b630b:m-1790717016907__item_0:1` wrote exactly six cells in `Inspections!A6:F6`: Monday 12 October, 16:00–16:15 Australia/Brisbane, The Martyn, TEST ONLY - Jorian, one attendee, TEST_ONLY_PENDING_EMAIL_REVIEW. Fresh readback at 09:14:46 showed that exact row once; verification reported `verified:true`, no discrepancies. The final draft explicitly identifies the entry as TEST ONLY, not a real applicant booking.

Final schedule SMS `comm_082126941e9c4372a9761c3fd7c0ff32` targeted only configured Jorian. Provider delivery timestamp is 09:15:59 Brisbane. Owning `sms.delivered` receipt `evt_9e822f92faa440aea2f2c205988f9af4` resolved node16 successfully. Run status is `completed` at 09:16:17, with all 20 node records' latest attempts completed (including loop children). No duplicate call, draft replacement, diary row or SMS was required. Workflow progression used standard approval and Advance Flow controls; this verifies the manual controlled flow, not an unattended scheduled run. Automated schedules remain disabled.
