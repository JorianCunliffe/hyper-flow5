# Sharehouse controlled acceptance — 10 October 2026

## Scope and boundaries

Goal: complete the full Morning Run v2 and exercise approximately five calls and five SMS cases. Only Jorian's configured person identity may receive test communications. Emails remain unsent drafts. Diary writes require explicit TEST ONLY inspection confirmation. Automatic schedules remain disabled. Do not replay uncertain provider effects.

Project: `1790716687348`. Current occurrence: `fr_a26a8fe0badb2b0b3f31be3fa395`.

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

SMS form regression: the original S1 Ask remains open in `fr_5b90d9cac525c183587d65e0e09b`, but later call runs contain cancelled historical copies. Lookup incorrectly returned the first copy instead of the persisted owner. The fix resolves the owning run before returning or accepting an Ask, including owners outside the recent-history page. Delivery aliases require a supplied matching identifier. Forty focused tests and TypeScript checks pass; live form verification pending deployment.

| Case | Scenario | Required evidence | Status |
| --- | --- | --- | --- |
| C1 | Clear natural-language policy answer | Answer mapped to the current Ask; question completed | Original failed; reviewed recovery complete; fresh policy extraction passed in C2 |
| C2 | Multiple questions, one per turn | All required fields captured; no repeated answered questions | PASS automatic field extraction and completion; individual read-backs were repetitive |
| C3 | Partial or ambiguous answer | Missing field remains open; useful clarification/review | Boolean answer passed; uncertainty scenario still not covered |
| C4 | Correct an answer before confirmation | Final confirmed answer wins; original evidence retained | Blocked before dispatch by OUTBOUND_NOT_READY; no completed call |
| C5 | Inspection availability and read-back | Correct date/duration/travel, explicit TEST ONLY confirmation | Not run |
| S1 | Natural answer to a linked SMS Ask | Correct current Ask progresses | Delivered; awaiting handset reply; receipt routing bug found |
| S2 | Partial multi-field SMS answer | Next missing question only; no premature completion | Not run |
| S3 | Natural project clarification | Correct project and conversation continuity | Not run |
| S4 | Duplicate delivery/event | No duplicate response or workflow effect | Not run |
| S5 | Final inspection schedule | Verified diary times and delivery receipt to Jorian only | Not run |

## Full-flow acceptance

Fresh Jorian enquiry verified after mailbox synchronization: `comm_5cdbe5f5280a4a1f87a04fe8cb3fbef6`, subject `Tasty only - jorian inspection`, received 10 October 2026 at 06:06:23 UTC. It asks about available rooms at 80 Martyn Street and an inspection Sunday at 14:00 (11 October, Australia/Brisbane). This is a request, not confirmed staff availability or a booking. The manual draft-disabled intake refresh is still in progress; the existing v2 plan retains the old missing source binding and must be regenerated against the verified new enquiry before any downstream effect.

C4 run `fr_849888cf17cfcc55d564e8393bc6` retained its original dispatch operation and returned a manual-review hold. At 06:27 UTC the public health endpoint reported Twilio active with balance OK, but cached voice and recording-transcription probes had timed out. This does not establish exhausted model credits. Do not create a replacement occurrence to bypass the readiness hold; reconcile the existing operation before resuming.

Still required: fresh controlled email source; correct source/recipient binding; availability and diary reads; confirmed staff availability; unsent provider draft receipt; TEST ONLY diary write and read-back; original draft finalisation; final Jorian SMS delivery; terminal successful run. The old controlled source was absent from the current intake. This is not a completed full-flow test.
