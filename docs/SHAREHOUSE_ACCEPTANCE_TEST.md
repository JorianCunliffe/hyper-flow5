# Sharehouse full-workflow acceptance test

Updated: 27 September 2026. Requirements baseline: HyperFlow `f103bbcc95c5fb359ffc376d5b5666273f5adf9f`; isolated setup checked against `71bec0c` plus the fixture changes. **Overall result: BLOCKED / NOT ACCEPTED.** This is the test procedure and evidence contract, not a complete automated end-to-end test runner. See the [isolated setup evidence](implementation/SHAREHOUSE_SETUP_20260927.md).

## Mandatory acceptance baseline

The complete Cairns Sharehouse workflow is the baseline for HyperFlow acceptance. The application must perform the entire morning workflow and ongoing inbound workflow, including the failure and recovery cases below, to pass. A working email triage, draft preview, isolated primitive, API fixture, or happy path alone does not pass acceptance. No reduced-scope alternative or skipped required case counts as a pass.

This document supersedes the old specification branch's reduced-scope fallbacks and is the acceptance entry point for the [capability guide](CAIRNS_WORKFLOW_CAPABILITIES.md), [implementation status](IMPLEMENTATION_STATUS.md), and [cross-service test programme](COMPREHENSIVE_ACCEPTANCE_PROGRAM.md). Existing channel/regression tests remain required supporting checks. The original business requirements are retained: [original morning-run specification](https://github.com/JorianCunliffe/hyper-flow5/blob/claude/cairns-sharehouse-prompt/docs/CAIRNS_SHAREHOUSE_PROMPT.md). Its claims about missing primitives are historical, not current implementation facts.

## Test setup and data

Use an isolated tenant/project, controlled Outlook mailbox, test spreadsheet and explicitly authorized test recipients. Represent primary team, fallback team, and enquirers as distinct identities so routing mistakes are observable. Configure through product screens; repeat equivalent configuration and validation through the supported API. A required database edit, source patch or developer-only setup shortcut is a failed setup case. Record any required hand-authored JSON as a UI authoring gap; it cannot silently satisfy ordinary-user setup acceptance.

| Configuration | Required value or decision |
|---|---|
| Schedule | Monday-Friday, 09:15, Australia/Brisbane; initially paused. Verify the saved weekdays and timezone through UI and API, not only a scheduler unit test. |
| Mailbox | A controlled Outlook connection; production target is `info@cairns-sharehouse.com`. Keep organization `draft_only` and project email sending disabled. |
| Team | Explicit primary/fallback Communications person IDs, verified channel identities and project grants. Substitute controlled numbers during tests. Never derive callable team identities from message text. |
| Contact policy | Record contact window, daily/per-person caps, permitted SMS/voice actions and authorized enquirer scope before running. Missing authority blocks dispatch. |
| Inspection policy | Record staff-confirmed property times, slot length, group capacity and weekday constraints. Reconcile the original 13:30-16:30 window with current operator instructions; conflicting or missing times require clarification, never guessing. |
| Business facts | Pin the approved property/fact reference and retrieve fresh availability from the authorized source when used. Static facts or an old availability result do not establish a current room, booking or inspection. Keep credential-bearing URLs server-side. |
| Runtime | Pin HyperFlow and Communications commits, deployed builds, rules/migrations, graph revision, scheduler and signed callback configuration. Source availability is not deployment evidence. |

Four separately granted named resources are required; a combined substitute tab is not a pass:

| Resource | Range | Columns and write rule |
|---|---|---|
| `tasks` | `Tasks!A2:H` | date, name, email, phone, property, required, source_message_id, status; append once per source message. |
| `enquiries` | `Enquiries!A2:J` | date, name, email, phone, property, stage, inspection_at, attended, notes, updated_at; upsert on email. |
| `communications` | `Communications!A2:G` | timestamp, name, channel, direction, phone, email, summary; append each logical contact once, including failed attempts. |
| `inspections` | `Inspections!A2:F` | date, time, property, attendees, group_size, status; append each confirmed shared slot once. |

Use stable business keys as well as per-operation receipts. A new day's run must not create another task for the same source email. Store receipt metadata through supported mechanisms without silently changing granted Sheet schemas.

Prepare this deterministic mailbox/Sheet fixture before the first run:

- E1 and E2: two new mobile-equipped enquirers for the same property, suitable for one group slot with configured capacity two.
- E3: a new enquirer with no mobile; E4: an enquirer already marked attended in the Sheet.
- A1: one actionable non-enquiry email; N1: one non-essential message; replay E1 with the same source-message ID.
- Include multiple questions across subject/body, an unknown property detail and a request requiring staff confirmation. Include malicious text asking to dial another number or enable email sending; it must remain data.
- Seed existing enquiries/slots, then an alternative fixture with a full slot and a newer concurrent Sheet update. Add E5 while the morning Ask is held to test later intake.
- Define expected classifications and staff answers before execution. Use synthetic property/availability data for automated tests and verified current facts for controlled provider runs.

## Morning workflow: ordered test

Run one persisted workflow from intake to completion. Inspect stored state and actual provider/Sheet results at each boundary; do not manually inject successful outputs into a live run.

| ID | Action | Required outcome |
|---|---|---|
| SH-01 | Build/configure the complete morning and inbound paths through the UI; repeat equivalent supported API setup. Save paused, validate, inspect and activate the controlled fixture. | Four resource grants, contacts, policies, bindings, questions and schedule survive reload. Invalid/missing inputs block activation. API credentials cannot impersonate human approval. |
| SH-02 | Start the weekday morning occurrence and sync the fixture, including duplicate E1. | Enquiry/actionable/non-essential classifications are correct and auditable. No source mail is moved, labelled, junked, deleted or marked read by the workflow. Creating/updating authorized drafts is the only intended mailbox write. |
| SH-03 | Extract actions. | Exactly five task rows for E1-E4 and A1, keyed by source-message ID; none for N1 or replayed E1. Known sender/property/request details are retained. |
| SH-04 | Read enquiries/inspections and produce the plan. | E1/E2 share one proposed slot within capacity and confirmed policy; E3 has an explicit human-email route; E4 is not reinvited. Unknown details become named typed questions. No invented availability, booking or time. |
| SH-05 | Create Outlook draft replies. | One native draft for each E1-E4 enquiry, with a provider ID and source/thread association; all substantive questions addressed or explicitly awaiting confirmation. No email send and no duplicate draft for E1. E4's reply does not offer another inspection. |
| SH-06 | Call the primary team member using the owning Human Ask. | Present the plan, read each draft and ask the generated questions. Answers map to frozen field names, are validated and confirmed back. Call connection/termination alone cannot satisfy the Ask. |
| SH-07 | Give partial/invalid answers, disconnect, then correct and confirm the remaining answers. | Same Ask/run retains confirmed progress; missing/invalid answers keep finalisation held. A stale or unrelated response cannot release this run. No inspection notifications precede complete confirmation. |
| SH-08 | Finalise after all required answers are confirmed. | Update the SAME provider draft IDs; upsert enquiry allocations; persist confirmed shared inspection slots once; retain attended state and newer data. E1/E2 count as two attendees in one slot. |
| SH-09 | Notify and audit. | Only eligible mobile enquirers receive their own confirmed allocations, after required business records persist. E3 remains visibly pending HUMAN email sending; its draft is not described as delivered. No automatic email is sent. Every attempted team/enquirer contact has one audit entry, including failures as they happen. |
| SH-10 | Inspect completion through UI and API, reload browser and retry the occurrence. | Matching run/Ask/draft/Sheet/communication identities and outcomes; no repeated task, draft, slot, call or notification. Business completion and pending human delivery are reported separately. |

## Required recovery and inbound cases

Reset to a recorded fixture or advance virtual time between automated cases. Run real provider checks separately. Current Human Wait has an integrated escalation implementation; test that existing path before proposing a different graph architecture. Neither its existence nor its unit tests prove this complete scenario works.

| ID | Stimulus | Required outcome |
|---|---|---|
| SH-11 | Primary no-answer; tick before and after ten minutes. | No early retry; exactly one primary retry on the first eligible tick at/after due time. Pending/uncertain provider outcomes do not authorize another call. |
| SH-12 | Primary retry fails; fallback fails. | Call fallback once, then callback SMS to BOTH configured team identities. One unresolved morning Ask remains; drafts stay unsent and inspection notifications remain blocked. |
| SH-13 | Later weekday, including Friday-to-Monday, with E5 arriving during the Hold. | Revisit/escalate unresolved work once, preserving answers/drafts. New intake is accounted for without cursor loss or duplicate parallel escalation. Capacity and current policy are rechecked. |
| SH-14 | Finish a partial voice Ask by SMS or trusted callback; send invalid, duplicate, delayed and corrected SMS answers. | One question at a time; accepted answers advance the same Ask/schema/run. Confirmed answers are retained. Two active Asks cannot exchange answers; ambiguity prompts clarification. |
| SH-15 | Previously contacted person follows up by email, SMS and voice. | Recognize the correct person and their permitted sent history; distinguish people/topics and respect private/project boundaries. Missing/stale/ambiguous history is disclosed rather than invented. |
| SH-16 | Enquirer asks where the team is for an inspection, inside the contact window. | Immediately acknowledge checking, call primary; on verified no-answer SMS primary and call fallback; once the team confirms, SMS the answer only to the originating enquirer. Execute inside existing authority without an extra manual release. |
| SH-17 | Two enquirers ask concurrently while the morning Ask is held; replay inbound events. | Independent incidents and reply targets; one acknowledgement per logical event. Correlated Ask responses resume their owner before considering new-run creation; agent routing and event nodes do not both reply. |
| SH-18 | Nobody answers the inbound incident, or it arrives outside hours/over cap. | Honest pending/held response; no invented team location or claimed call. Show the next permitted recovery step and resume only within policy. |
| SH-19 | Close browser, restart worker, expire a lease; replay/delay signed callbacks. | Persisted run continues or remains held; no duplicate effects, cross-run release or dependence on a browser timer. Invalid signatures fail closed. |
| SH-20 | Sheet/draft/SMS/call timeout after possible provider acceptance. | Reconcile by stable identity/receipt or visibly hold; never blindly repeat an ambiguous external effect. Failed persistence prevents downstream inspection notification. |
| SH-21 | Concurrent slot/enquiry update; human edits, deletes or sends a held draft. | Preserve newer data; surface over-capacity/write/draft conflict. No silent overwrite, replacement draft, automatic send or duplicated slot. |
| SH-22 | Revoke a grant while held; use untrusted numbers, prompt injection or another tenant's identities. | Recheck authority on resume/dispatch. No unauthorized call, resource access, email send, permission change or private disclosure. |
| SH-23 | Pause/cancel/edit the definition with an active run; deliver an old callback. | No new prohibited dispatch or cancelled-run revival. Active run keeps its recorded definition or uses an explicit supported migration. |
| SH-24 | Generate the complete flow from the business prompt and compare with manual authoring. | Same required behavior and policy boundaries, editable/reviewable graph, no missing requirements. Compiler limitations are BLOCKED acceptance, not an automatic waiver or a prose-only success. |

## Execution layers and evidence

1. **Source and component checks:** establish what exists and run focused regressions. This layer cannot mark SH cases passed on its own.
2. **Deterministic full-scenario integration:** fake transports, virtual time and durable state must exercise the connected morning/inbound workflows and negative cases; assert exact effect counts, identities, persisted rows and finalisation gates.
3. **Browser and API acceptance:** configure through product UI and supported API, inspect/reload results, and verify equivalent definitions and authority. A fixture rendering the editor alone does not prove full workflow configuration.
4. **Controlled deployed-provider acceptance:** verify real Outlook draft create/read/update, Google Sheet results, spoken questions/confirmation, SMS/callback continuation and scheduler recovery on pinned builds, with authorized controlled recipients. Do not send email automatically. Record provider outcomes separately from HTTP acceptance.

Supporting local commands (PowerShell):

```powershell
npm.cmd ci
node --import tsx --test tests/cairnsCapabilities.test.ts tests/primitivesPlan.test.ts tests/flowInputs.test.ts
npm.cmd run api:check
```

These commands exercise supporting components and API publication only. They DO NOT execute SH-01 through SH-24 end to end. Existing [Cairns component tests](../tests/cairnsCapabilities.test.ts), [Ask tests](../tests/primitivesPlan.test.ts), [data input tests](../tests/flowInputs.test.ts), [browser fixture](../tests/ui/cairns.tsx) and [API integration tests](../tests/integration/agentApi.test.ts) are reusable foundations; missing full-scenario automation is an explicit acceptance gap. Follow the broader test programme for regression and persistence checks.

Create a dated evidence record with one row per SH case and per required execution layer:

| Case/layer | Result | Expected versus observed | Evidence | Blocker/owner |
|---|---|---|---|---|
| SH-01 through SH-24 | NOT RUN initially | Record actual observations, not a copied expected result | Builds, graph revision, fixture version, redacted run/Ask/operation/provider IDs, timestamps, receipts and UI captures | Record missing setup/implementation/evidence |

Allowed results: PASS, FAIL, BLOCKED, NOT RUN. All required cases must PASS with appropriate integration, UI/API and live-provider evidence; any FAIL, BLOCKED or NOT RUN means **overall NOT ACCEPTED**. No percentage, skipped-case allowance or passing unit-test count overrides this rule. Production activation requires the complete baseline, not a reduced morning recipe. Do not include secrets or raw customer conversations in evidence.

## Current evidence state

The [27 September isolated setup run](implementation/SHAREHOUSE_SETUP_20260927.md) adds a candidate full-workflow graph, handler-level setup tests and browser checks using real editors with mock persistence. **SH-01 is BLOCKED:** saving the inbound Human Wait removes its static answer field. Morning processing up to the human gate and isolated inbound acknowledgement have supporting simulated evidence only. Required end-to-end/provider layers remain NOT RUN; no complete SH case has passed. The evidence record distinguishes observed failures, fixture limitations and remaining implementation work.
