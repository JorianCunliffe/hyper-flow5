# Sharehouse controlled acceptance — 10 October 2026

## Scope and boundaries

Goal: complete the full Morning Run v2 and exercise approximately five calls and five SMS cases. Only Jorian's configured person identity may receive test communications. Emails remain unsent drafts. Diary writes require explicit TEST ONLY inspection confirmation. Automatic schedules remain disabled. Do not replay uncertain provider effects.

Project: `1790716687348`. Current occurrence: `fr_a26a8fe0badb2b0b3f31be3fa395`.

Inspection rules: 15 minutes, five-minute travel between properties, Australia/Brisbane dates, preferred Martyn Street 16:00 and other inspections around 15:30, subject to confirmed availability and diary conflicts.

## Evidence and regressions

The original call `comm_3a18e16cf0554c788ceac746693d3354` captured a clear answer rejecting direct bookings and requiring listing-site screening. Both callback interpretations recorded high confidence but no field values. Ask `ask_d6339c703b6f4cdab8f5ab8f0d3e1e98` remained open. The interpreter schema defined `values` without its declared Ask fields. The fix declares typed fields while permitting missing answers; confidence and human-review gates remain enforced.

Local regression: 106 targeted tests and TypeScript checks passed. Live acceptance remains outstanding until production evidence is recorded below. A fixture or successful call delivery alone does not pass a workflow case.

## Live test matrix

| Case | Scenario | Required evidence | Status |
| --- | --- | --- | --- |
| C1 | Clear natural-language policy answer | Answer mapped to the current Ask; question completed | Pending repair/reconciliation |
| C2 | Multiple questions, one per turn | All required fields captured; no repeated answered questions | Not run |
| C3 | Partial or ambiguous answer | Missing field remains open; useful clarification/review | Not run |
| C4 | Correct an answer before confirmation | Final confirmed answer wins; original evidence retained | Not run |
| C5 | Inspection availability and read-back | Correct date/duration/travel, explicit TEST ONLY confirmation | Not run |
| S1 | Natural answer to a linked SMS Ask | Correct current Ask progresses | Not run |
| S2 | Partial multi-field SMS answer | Next missing question only; no premature completion | Not run |
| S3 | Natural project clarification | Correct project and conversation continuity | Not run |
| S4 | Duplicate delivery/event | No duplicate response or workflow effect | Not run |
| S5 | Final inspection schedule | Verified diary times and delivery receipt to Jorian only | Not run |

## Full-flow acceptance

Still required: fresh controlled email source; correct source/recipient binding; availability and diary reads; confirmed staff availability; unsent provider draft receipt; TEST ONLY diary write and read-back; original draft finalisation; final Jorian SMS delivery; terminal successful run. The old controlled source was absent from the current intake. This is not a completed full-flow test.
