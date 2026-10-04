# Cairns Sharehouse evening test — 29 September 2026

Status: BLOCKED / NOT ACCEPTED. This record does not establish full Sharehouse acceptance.

## Authorization and boundaries

- User requested Morning Run testing with email drafts, SMS and calls.
- User explicitly selected only the configured Jorian number for tonight's contact, including outside the recorded 09:00–17:00 Brisbane window.
- Existing five-contact ledger records three earlier attempts. Reserve at most one further call and one SMS. No additional contact has been dispatched in this evening session yet.
- Project email sending is off; mailbox is Cairns Outlook. Existing schedule remains disabled.
- Live contact policy read: 09:00–17:00 Brisbane, twenty attempts daily, two per phone number. No global policy change made.

## Live preparation and observations

- Opened Morning Run project `1789625624932` in production.
- Saved human-response step with Jorian assignee `39edc52f-7af6-43c1-a2db-53ad43bd9ddf`; disabled retry/fallback escalation. Web, SMS and voice remain selected; email is off. This limits the test recipient and avoids the saved Carol-first escalation sequence.
- Intake template: all inbound, native drafts off at intake, web digest. Draft creation remains the separate workflow step.
- Began intake and resumed explicit batch checkpoints. UI reports `Mailbox batch checkpoint saved; this occurrence will resume before planning` between batches.
- Saved digests demonstrate accumulation: ten, fifteen, then twenty new messages. No downstream planning or draft step has been executed on partial input in this session.
- Separate agent job `comm_71d5072297c043abacd84c96ceec3702` reports `Inbound person is not authorized for this tenant agent`, two attempts. No replay or permission change performed.

## Intake and planning progress

- Intake completed at 22:21:58 Brisbane, HTTP 200. The final batch processed four messages; the accumulated output contains 29 messages, verified from the UI's Project Data field.
- Enquiries read completed at 22:22:23; Inspections read completed at 22:23:31.
- New controlled enquiry `comm_57dd88c959f1431da58b5a1babd67648` already carries a provider draft ID. Planner setup now excludes existing provider drafts from NEW draft creation, deduplicates equivalent requests in a thread, and prohibits copying bank account details or inventing completed financial/business actions. It preserves these requests in the plan for review.
- Ran the planner after complete intake and both fresh Sheet reads. Its existing human-review gate remains enabled.

## Required remaining evidence

Complete intake; refresh Sheet reads; review actual planner output; create/reuse native Outlook drafts and verify their IDs/content; dispatch at most one SMS and one call to Jorian; verify provider outcomes and confirmed-answer handling. Any blocked stage must remain explicit.

## Planner result and continuation failure

- Planner completed at 22:24:55: three proposed replies, four tasks, four team questions. Preserved proposals are in `SHAREHOUSE_REVIEW_DRAFTS_20260929.md`; they are not native Outlook drafts.
- Live Outlook preview at 22:25:50 verified the new controlled enquiry's existing draft. It incorrectly asks which project the sender means and lists projects. This is not a valid accommodation response. No replacement or overwrite attempted.
- Clicked Advance Flow once after planning. The endpoint returned HTTP 200, but no pending approval appeared.
- After the user resumed on 30 September, reloaded production: the intake, Sheet and planner completion markers were absent. The saved human-call step again named Carol and had escalation enabled. The prior Jorian-only edit and planner safeguard edits had been replaced by the older run snapshot.
- is Source explains the boundary: `api/tasks/execute.ts` passes only org/project/node/run IDs to `executeDurableTask`; it does not bind those manual executions to the persisted FlowRun. `advanceServerFlow` selects the existing active run, `materializeFlowRunProject` restores its saved milestones/data, and `persistProjectProjection` writes that state back over the editor projection. Preserving a run's frozen definition is intended, but the manual execution/editor versus runtime split prevents this test from advancing safely and loses visible edits/results.
- Restored Jorian-only assignee and disabled retry escalation in the editor after diagnosis; no further Advance Flow was attempted. This does not migrate the stale persisted run, which must not be executed expecting those edits to apply.
- No new native drafts, calls, SMS, sent email, task rows or inspection writes were performed in this session. The conservative contact ledger remains 3/5 total from the earlier record, with at most two remaining; it was not reset overnight. Intake and Sheet reads did succeed as individual actions.

Required repair: a supported fresh-run or reconciled manual-execution path that retains actual node outcomes and makes the pinned recipient configuration explicit, without duplicating provider effects or silently migrating an active run. Then re-run the review/draft/contact stages. Existing draft routing/reuse also needs correction. Do not call isolated stage successes a completed Morning Run.
