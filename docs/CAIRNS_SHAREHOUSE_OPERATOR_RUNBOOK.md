# Cairns Sharehouse operator runbook and test log

Started: 29 September 2026 (Australia/Brisbane).
Operator: Jorian. Assistant: instructions, evidence review and debugging.
Objective: build and verify the complete Cairns Sharehouse run incrementally, starting with email triage for info@cairns-sharehouse.com.

## Evidence rules

Record each step's action, expected result, actual result, evidence, and PASS/FAIL/BLOCKED/NOT RUN. For failures, record exact error, Brisbane timestamp, project/run/message IDs where available, diagnosis, repair and retest. Do not record secrets or unnecessary guest information.

Source inspection establishes available controls, not deployed behavior. Existing acceptance requirements in SHAREHOUSE_ACCEPTANCE_TEST.md remain applicable to the eventual complete run. The prior 29 September audit reports routing authority problems; recheck only if encountered rather than assume they are resolved or still present.

## Stage 1: configure and validate a new triage service

Current status: NOT RUN by operator. No live configuration changed by this document.

1. Open new-project creation. Set Project Identity to `Cairns Sharehouse - Email Triage`. Select the relevant existing company/category if required. Leave cloning unset.
2. Under HyperFlow Service Template select Daily Email Triage, then Configure service.
3. In Email Triage Setup set:
   - Project name: Cairns Sharehouse - Email Triage.
   - People allowed to use this project: Jorian's existing identity initially.
   - Mailbox provider: the actual provider hosting the target mailbox.
   - Connected mailbox: exactly info@cairns-sharehouse.com, connected.
   - Inbound policy: Human only initially. Later verify whether website enquiries arrive as automated mail and require All inbound.
   - Create provider-native drafts: unchecked for the first intake/classification check. Enable and test drafting separately after business context is verified.
   - Digest channel: HyperFlow.
   - Daily time: 09:15 (provisional configuration, not approval to activate recurring runs).
   - Timezone: Australia/Brisbane.
4. If the mailbox is missing, use Connect another Google/Microsoft account for its actual provider, complete sign-in yourself, then Refresh connections. Confirm the exact mailbox address; do not substitute the operator's personal mailbox for a shared mailbox.
5. Click Validate configuration. Capture every Readiness row and any error.
6. Operator checkpoint: report the Readiness result before Create service project. Creation/schedule behavior must be reviewed before committing because the wizard exposes no paused-schedule setting. The daily-time control does not establish weekday-only recurrence.

### Stage 1 tests

| ID | Check | Pass condition | Result |
|---|---|---|---|
| ET-01 | Correct mailbox | Exact address and provider selected; connection shown connected | NOT RUN |
| ET-02 | Configuration | Name, identity, Human only, drafts off, HyperFlow digest and Brisbane timezone match | NOT RUN |
| ET-03 | Readiness | Every readiness row passes; record exact failures otherwise | NOT RUN |
| ET-04 | Save/reload (next checkpoint) | One new project; saved settings survive reload; schedule state explicitly verified and paused for manual tests | NOT RUN |

## Subsequent triage checks, to execute after setup

Do not claim triage is accepted from validation alone. Before the first run, establish the intake window/backlog and any overlapping mailbox automations.

| ID | Test | Expected evidence | Result |
|---|---|---|---|
| ET-05 | Controlled human enquiry sent by operator from another mailbox after setup | Unique subject, source message and receipt time recorded; manual run finds it in this project's email activity with correct sender/content/classification | NOT RUN |
| ET-06 | Mailbox effects | Compare test message read state, folder/labels, drafts and Sent before/after; triage introduces no unexpected change or outgoing message | NOT RUN |
| ET-07 | Repeat run | Same source message does not produce duplicate triage work; record IDs/counts | NOT RUN |
| ET-08 | New enquiry | A second unique message is picked up on the next run; prior item remains intact | NOT RUN |
| ET-09 | Intake policy | Representative human mail and actual website enquiry format handled according to chosen policy; excluded automated messages explained | NOT RUN |
| ET-10 | Drafting (later) | Approved reference context configured; draft saved in exact target mailbox, correctly threaded, factually reviewed, visible after reload and not duplicated or sent | NOT RUN |

Future stages: task extraction and deduplication, current business facts/availability, planning, native drafts, human questions and confirmed answers, same-draft finalisation, allocations, notifications, replay/recovery and complete-run acceptance. Expand instructions at each operator checkpoint.

## Session log

### 2026-09-29: preparation

- Inspected CreateProjectModal, ServiceProjectWizard, ServiceConfigurationPanel and triage execution source.
- Confirmed exact wizard labels and separate validation/create actions.
- No deployed UI inspected, live tests executed, or service created in this session yet.
- Next evidence: operator's Readiness rows for ET-01 through ET-03.

### New-project scrolling repair

- Operator reported that the new-project dialog could not scroll vertically.
- Cause: the dialog used overflow-hidden without a viewport height limit, while body scrolling is disabled.
- Repair: cap the dialog at calc(100dvh - 2rem) and enable contained vertical scrolling.
- Local browser check at 1280x720: content height 1071px, dialog height 686px; scrolling reached 385px and the Cancel button bottom was 671px, inside the viewport. Type-check passed.
- Live-site verification: NOT RUN; local repair is not deployed yet. Temporary isolated fixture used the real CreateProjectModal with no project writes.

