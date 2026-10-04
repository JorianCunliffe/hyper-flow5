# Sharehouse Morning Run v2 controlled test — 30 September 2026

Result: **BLOCKED / NOT ACCEPTED**. This is a persisted-run attempt, not successful end-to-end acceptance.

## Authorised scope

- Jorian for both test call and final SMS; no Carol or applicant contact.
- Email drafts only, no sends.
- Existing Live Acceptance Test diary; TEST ONLY records.
- 30-minute inspections by default, 15 if confirmed; unlimited same-property group size.
- Recurring v2 schedule remains disabled.

## Saved run

- Project: `1790716687348`
- FlowRun: `fr_351a0dc3e9a5e9fd31742594e005`
- Occurrence: `manual:1790721200519:5dbef88f-94cc-4ea8-bf36-f593d117260e`
- Pending staff question: `ask_3aa1a6eef4634ac7b9af38b432f47e0d`
- Controlled source: `comm_57dd88c959f1431da58b5a1babd67648`

Setup approval was submitted through the existing review UI under the user's explicit controlled-test authorisation. The existing saved run then reached the staff-call Wait. No fabricated staff answers were submitted.

## Results

| Stage | Evidence | Result |
|---|---|---|
| Setup | Saved approval limits execution to controlled test | Passed |
| Email intake | 0 processed, 0 skipped, no triage items; cursor before and after `2026-09-29T22:38:00.845Z` | Failed coverage |
| Enquiry register and diary reads | Nodes completed; question preparation reports no enquiry rows | Read stages completed; not booking proof |
| Fresh availability | HTTP 200 at `2026-09-29T22:38:26.315Z`; Lady Loeven-U1-R5, Lady Loeven-U4-R2, Lady Loeven-U4-R3 | Passed |
| Question preparation | Explicitly identifies missing controlled enquiry rather than inventing its content | Completed with evidence gap |
| Staff call | Voice delivery failed before provider dispatch: selected stable person ID has no configured phone in the legacy resolver | Blocked |
| Drafts, inspection write/readback, final SMS | Downstream of unresolved staff question | Not run |

## Confirmed defects and next repair

1. `lib/executeTask.ts` passes `createdAt: Number(projectData?.service_configured_at || Date.now())` into first-run triage. This new project had no configured historical intake boundary. `lib/triage/runEmailTriage.ts` uses that as the initial cursor, excluding the existing controlled email. Repair needs explicit bounded initial/backlog intake and a supported replay for this already-checkpointed run; simply pressing Advance cannot recover the missing enquiry.
2. `lib/asks/deliverRaisedAsks.ts` resolves ordinary Human Ask recipients with `resolveTeamMemberIdentity`. That function reads legacy `teamMemberDetails`; it does not resolve the stable Communications person selected for this test. Existing `resolveGrantedPersonTarget` handles granted Communications identities in other paths. Repair must preserve tenant/project grants, contact policy and durable delivery identity; do not replace the contact with an invented number or submit web answers as proof of a call.
3. One continuation returned a project projection revision conflict (`stored=51,expected=50`). The saved run reached the staff Wait while the map initially showed old state; a later UI observation showed completed upstream nodes. The run's failure receipt, rather than the initial map, established the actual call blocker.
4. Settings observation showed agent automatic SMS unchecked and capability SMS set to inherit. Final SMS authority must be resolved before a complete test; do not silently broaden tenant-wide permissions.

The run remains waiting at the staff Ask. No successful call, new response draft, inspection booking, or final SMS is claimed. Full Sharehouse acceptance remains unproven.

Screenshot: `artifacts/sharehouse-v2/full-test-call-blocked-20260930.png`.

## Repair after user instruction

PR #61 (`0864b9a95f41d3e25f822c73f5b1ca066c1231dc` on main) fixes stable Communications contact resolution for ordinary Human Ask delivery and follow-up SMS, retaining project-grant checks and legacy named contacts. It adds the bounded `lookback_hours` intake option. The live v2 workflow definition was saved and reread with `lookback_hours: 24`.

Validation passed: 24 focused local tests, lint/build, and GitHub verify, promise-ledger and integrated-acceptance checks. Integration includes overlapping rolling windows and records pushed out of the recent-item list; no repeat classification or draft creation. The local Firebase integration invocation could not start because Java was absent; the same regression passed in CI.

The original frozen run remains incomplete; its empty intake and generated staff questions have not been overwritten or counted as repaired provider evidence. A fresh controlled occurrence is still required. Screenshot of saved setting: `artifacts/sharehouse-v2/intake-last-24-hours.png`.

Production deployment `dpl_B15eo9ummiQNaM4uzjdpPq1suVh6` reached READY and was aliased to `https://hyper-flow5.vercel.app`. This verifies deployment, not completion of the controlled provider run.
