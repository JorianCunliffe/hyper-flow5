# Primitives completion: Sharehouse delivery plan

**Reconciled:** 26 September 2026  
**Reviewed main:** `1f1abab738257af6688fa3b34387d375ea1d16bc`  
**PR scope:** Documentation and implementation handoff. No runtime changes, deployment or live acceptance are claimed.

## Current delivery decision

Get the first successful Cairns Sharehouse runs through the existing primitives, then improve authoring usability. Use the existing executor, Human Ask, resource catalogue and event/Hold machinery. Do not introduce a scenario-specific workflow engine or duplicate canonical contacts, threads or memory.

The original 15 September programme is preserved below. Its baseline statements are historical. This reconciliation takes precedence over its implementation order and any suggestion that current components must be built from scratch.

## Evidence and remaining verification

| Area | Evidence at reviewed main | Next action |
|---|---|---|
| Named resources | `components/WorkspaceResourcesEditor.tsx` configures project, connection, names, file IDs, ranges and read/append/upsert permissions through existing APIs. | Verify settings discovery, node binding and all four datasets through the UI. Add only blockers; previews and richer mapping are later usability work. |
| Dynamic Ask | `lib/asks/askFieldSource.ts` resolves field arrays and validates names/duplicates; `tests/primitivesPlan.test.ts` includes schema snapshot coverage. | Verify run-owned partial answers, completion gating and corrections. Current resolver supports string/boolean/number/date/file and falls back to string for unsupported types; explicit unsupported-schema handling needs review. |
| Stepped SMS | `lib/asks/deliverNextSmsStep.ts` and `lib/asks/askSteps.ts` exist; primitives tests cover selecting the next unanswered field. | Verify actual dispatch, replay handling and cross-channel continuation. Unit fixtures are not live transport evidence. |
| Native draft lifecycle | README documents provider-native drafts; `docs/IMPLEMENTATION_STATUS.md` records PR40 merged and a dated provider deployment blocker. | Check current Communications draft-update contract and deployment; do not repeat the old blocker as a current fact without a fresh check. |
| Holds and events | PR37/38 introduced reusable event/Wait and run-owned execution. Current status retains these as merged capabilities. | Verify timer wake-up, exact-run callback routing, cancellation and next-day pending work against current code. |
| API parity | `docs/API_PARITY.md` describes existing API coverage and remaining limitations. | Verify every setup/run/recovery operation used by this workflow is externally callable under tenant authority; update actual API/OpenAPI contracts when implementation changes. |
| Full scenario | No fresh full-scenario execution was performed for this documentation PR. | Record source, UI, automated and live results separately; no completion claim from endpoint existence alone. |

Sources: [README](../README.md), [dated status](IMPLEMENTATION_STATUS.md), [API coverage](API_PARITY.md), [primitives tests](../tests/primitivesPlan.test.ts), [resource editor](../components/WorkspaceResourcesEditor.tsx), [Ask schema resolver](../lib/asks/askFieldSource.ts). These are a targeted reconciliation, not an exhaustive current-code audit.

## Reviewable implementation slices

Each slice must reuse current contracts, expose required setup through UI and API, preserve tenant isolation, and record exact commit/test evidence. A discovered existing implementation is verified and retained rather than replaced.

### A. Establish the executable baseline

- [ ] Retrieve the original Sharehouse acceptance prompt from its specification branch; reconcile its stale dependency notes against main without importing old runtime code.
- [ ] Inventory each required operation across runtime, UI, API, tests and live-provider evidence.
- [ ] Pin both HyperFlow and Communications builds and verify mailbox draft create/update, signed callbacks and scheduler readiness.
- [ ] Record required configuration without inventing missing values: mailbox/Sheet connections, team person IDs, schedule/timezone, contact windows/caps, slot length and group capacity.
- [ ] Create deterministic morning and inbound fixtures using fake transports and virtual time.

**Gate:** An explicit blocker list and reproducible acceptance fixture exist. Setup can be reproduced without database edits. OAuth consent remains a human setup step.

### B. Complete the minimum morning path

- [ ] Configure tasks/enquiries/communications/inspections with the existing resource editor and grants.
- [ ] Exercise read, append and email-keyed upsert with stable operation/business keys; uncertain effects reconcile or hold.
- [ ] Produce usable plan/question data, create native drafts and raise the existing schema-driven Ask.
- [ ] Collect and confirm all required answers, update the same drafts, persist allocations, then notify eligible mobile enquirers.
- [ ] Make no-mobile enquiries visibly pending human draft sending.

**Gate:** One configured, UI-authored happy-path run succeeds; draft-only policy and mailbox non-mutation are preserved. If existing bindings or collection execution cannot express the workflow, implement only the necessary reusable primitive extension.

### C. Prove recovery and channel continuity

- [ ] Primary no-answer → ten-minute Wait → primary retry → fallback → callback SMS uses ordinary visible nodes.
- [ ] Partial answers, disconnection and later SMS/callback resume the owning Ask/run.
- [ ] Next weekday revisits unresolved work once while new intake remains accounted for.
- [ ] Replay, restart, cancellation and provider uncertainty cannot duplicate logical effects or release unconfirmed work.
- [ ] Display why the run is held and the next permitted recovery action.

**Gate:** Deterministic failure tests pass; controlled provider evidence separately establishes actual call/SMS behaviour.

### D. Complete the inbound inspection flow

- [ ] Trusted inbound event acknowledges the enquirer, contacts configured team identities, and returns the confirmed answer to that enquirer.
- [ ] Existing-Hold correlation precedes new-run creation; event handling and conversational routing do not both reply.
- [ ] Recheck contact windows, limits and tenant/project grants at dispatch and after delayed resume.
- [ ] Concurrent enquirers remain independent of each other and the morning run.

**Gate:** Duplicate events produce one logical acknowledgement/incident; untrusted numbers cannot become authorised team-call targets; private project context is not disclosed to enquirers.

### E. Close API and acceptance gaps

- [ ] An authorised external API client can reproduce configuration, validation, activation, inspection, pause/resume and amendment without backend code or direct database access.
- [ ] Document methods, schemas, auth, revisions, pagination and error/recovery contracts actually used; add contract tests for any new/changed operation.
- [ ] Capture the full morning/inbound acceptance matrix below with exact builds, graph version, redacted receipts and live exclusions.
- [ ] Update implementation status only for verified results.

**Gate:** Manual UI and external API configuration execute equivalent flow definitions with the same policy and validation boundaries.

## Deferred until successful runs

Richer variable pickers, automatic JSON schema discovery from trial runs, extensive mapping previews, catalogue redesign and broader compiler ergonomics follow successful execution. Compiler-created flows must use the same runtime; record unsupported requirements rather than silently omitting them. A concrete execution blocker can pull a narrowly scoped generic change forward.

## Programme completion

The acceptance matrix in the original programme remains the full target. Passing the first happy path does not mark recovery, inbound handling, API parity or provider delivery complete. This PR supplies the plan and gates; implementation and acceptance evidence belong in follow-up PRs.

---

# Original programme — 15 September 2026

**Prepared:** 15 September 2026, Australia/Brisbane  
**Verified HyperFlow baseline:** `main` at `7dfa3f66728f9d6d2be6ff8888e21c20ff78c24a`  
**Acceptance specification:** `docs/CAIRNS_SHAREHOUSE_PROMPT.md` on `claude/cairns-sharehouse-prompt`  
**Status:** Proposed development programme. This document does not represent completed implementation or fresh production acceptance.

## 1. Delivery decision

Complete a reusable, human-configurable primitive system, then implement Cairns Sharehouse as an ordinary template built from it. Do not create a sharehouse-specific executor, separate retry scheduler, new memory application, or second workflow engine.

The earlier gap assessment was based on the older prompt branch. Current `main` is substantially ahead: the merge at `27f8a295` includes Wait, event triggers, capability policies, named Workspace resources and Sheet Upsert. PR 38 subsequently adds isolated FlowRun/NodeRun execution and generic timer/event/human/provider Holds. Reuse and verify these implementations rather than rebuild them. [S1–S5]

The remaining programme is primarily completion of UI authoring, typed data movement, dynamic human interactions, cross-channel integration, compiler parity and end-to-end reliability. Some components below are audit-and-complete work, not assertions that their backend implementation is absent.

**Completion criterion:** Starting with an ordinary administrator account and connected test integrations, a person can configure, construct, validate, activate, inspect, pause, resume and amend the full acceptance workflow entirely through product screens. No direct API calls, database edits, source-code edits or hand-authored JSON are required. An optional advanced JSON view is acceptable; a required JSON editor is not the completion target.

## 2. What exists and what still needs work

| Capability | Verified baseline | Remaining delivery work |
|---|---|---|
| Durable Hold / Wait | Timer, event, human and provider Hold types; editor controls; timeout/result/payload configuration. | Regression-test exact-run resume, overdue timers, cancellation, callback races and the actual retry graph. |
| Isolated execution | FlowRun and per-node NodeRun history merged in PR 38. | Prove daily/inbound runs do not share mutable state; expose understandable run-specific diagnostics. |
| Inbound event start | EVENT_TRIGGER and event configuration exist. | Verify trusted identity/project resolution, contact policy, duplicate suppression and integration with the agent router. |
| Named Workspace resources | Server-owned resource catalogue supports multiple resources and read/append/upsert permissions. | Complete discoverable settings, range/column previews, per-node selection, grant validation and safe mapping. |
| Sheet Upsert | Present in NodeType and node template examples. | Complete key-column selection, typed row mapping, concurrency and uncertain-write reconciliation. |
| Human Ask | Typed fields and a human Hold contract already exist. | Runtime-sourced schemas, field editor, schema pinning, partial answers, validation and confirmed completion. |
| Action outcome branching | Failure mode and result variable exist; Decision supports richer comparisons. | Make outcomes selectable without JSON; verify joins and call-failure branches. |
| Prompt-generated flows | Separate FLOW_CATALOG and FlowPlan model exist. | Bring them to primitive parity. Current model has string-only inputs, a 20-step bound and no equivalent entries for all required new control/data capabilities. |

This is a code/merge-based baseline, not a claim that the complete workflow has passed live UI and provider testing. Communications-side implementation details require verification in Work Package 0. [S1–S7]

## 3. Architecture and safety boundaries

### HyperFlow owns

Flow definitions, version approvals, run/node state, Holds, business decisions, Ask schemas and validated response progress, resource bindings, permission checks, operation identities, schedules, trigger policies and business audit records.

### Communications Service owns

People/channel identities, cross-channel threads, permitted memory/context, raw conversations, transport, provider adapters and delivery receipts. It delivers questions and returns evidence-linked answers/events. It must not become a parallel business workflow scheduler.

### Shared contract

Reuse existing contract conventions. Extend only the missing fields: tenant/project, flow run, node run, logical operation, Ask, schema version, person, communication and event identities; partial/final answers; validation/confirmation status; and timestamps. Establish backward compatibility before independently deploying either application.

### Hard rules

- All business sequencing uses ordinary visible primitives: actions, Decision, Loop/For Each, Hold, Event Trigger and End. Retry/escalation recipes are editable graphs, not special handlers.
- Draft-only email is enforced server-side. No prompt, dynamic field or message may enable email sending.
- Only explicitly configured team contacts may receive team calls. An arbitrary number found in an email is not callable authority. Enquirer SMS permission is a separate, explicit policy.
- Re-check current tenant/project/channel/resource authority and contact window before every external effect, including after a Hold resumes.
- Treat incoming content and model output as data. Neither may select arbitrary tools, credentials, resource grants or new call recipients.
- Preserve privacy: matching a contact does not authorize disclosure of all project communications. The team may receive the morning brief; an enquirer receives only their own permitted inspection context.
- Do not treat an uncertain provider result as a failed effect that is safe to repeat. Hold for reconciliation.

## 4. Work Package 0 — Reconcile and lock the baseline

**Objective:** Establish the actual remaining gap register before creating new implementations.

**Tasks:** Start from verified current `main`, retain the prompt branch as a specification source, and update the prompt's stale dependency/reduced-scope notes without importing old code over newer implementations. Inventory each needed primitive across type definition, runtime, API, manual editor, prompt compiler, tests and deployment. Review Communications Ask, phone, SMS, native mailbox-draft and identity contracts. Verify the exact deployed versions separately from merged source.

**Produce:** A capability matrix with four separate states: implemented; UI-authorable; automated-test evidence; live acceptance evidence. Add a failing full-scenario test skeleton. Record unresolved configuration as required setup fields rather than invent values.

**Acceptance:** No duplicate Wait/Upsert/event/resource implementations. No feature is declared complete solely because a type or endpoint exists. Existing flow and coaching templates remain regression fixtures.

**Primary HyperFlow surfaces:** `types.ts`, `lib/flowRuntimeTypes.ts`, `lib/serverFlow.ts`, `lib/flowEngine.ts`, `api/flow/advance.ts`, `api/events.ts`, `components/modals/NodeConfigModal.tsx`.

## 5. Work Package 1 — Shared primitive contracts and typed UI authoring

**Objective:** A primitive has one authoritative definition used by the editor, validator, compiler and execution adapter.

### Primitive descriptor

Define or consolidate descriptors containing stable type/version, typed input and output schemas, visual form metadata, side-effect classification, permission requirements, outcomes, binding rules and execution adapter. Preserve existing runtime ownership; this is not a replacement engine.

### Visual configuration

Provide controls for resources, contacts, fields, conditions, results, retry bounds and timeouts. Bind inputs to constants, project configuration, trigger data, previous-node outputs or the current collection item through a variable picker. Show resolved previews and type errors before activation. Keep advanced JSON optional.

### Typed data and collections

Support arrays, objects, numbers and booleans without fragile text substitution. Add a validated structured-output mode to the existing AI/report action, rather than a sharehouse planning handler. The plan, enquiry batch and question schema must be usable structured outputs, not prose that downstream nodes must guess how to parse.

Audit existing collection support. If it cannot process a runtime-sized list with independent receipts, add a generic **For Each** primitive: collection source, stable item key, bounded concurrency, item-local variables, checkpointing, collected outputs and explicit failure policy. A fixed Loop iteration counter alone is not sufficient evidence of per-enquiry execution.

Verify selected-branch joins, false/zero/null handling, missing required bindings and unsatisfied conditions. A skipped fallback must not deadlock a successful path; a failed confirmation path must not release finalisation.

**Acceptance:** A user builds a sample flow over a variable-length enquiry list, maps named properties to row columns and draft fields, and resumes failed items without redoing completed ones. Unknown fields and invalid model output produce visible validation errors, not partial business effects.

**Primary surfaces:** `types.ts`, `constants.tsx`, `lib/flowEngine.ts`, `lib/serverFlow.ts`, `lib/visibleFlows/model.ts`, `components/modals/NodeConfigModal.tsx`, `components/VisibleFlowsPanel.tsx`.

## 6. Work Package 2 — Named resources, data effects and draft lifecycle

**Objective:** Configure the four datasets and the complete draft lifecycle without code.

### Resource configuration

Expose a Project Resources screen with connection, resource name, spreadsheet/tab/range, column schema, permissions and optional business-key column. Reuse the existing server-owned catalogue; extend its schema only where necessary. Add a read-only preview, header/type checks, a connection test, range containment checks and clear grant-denial errors. Prevent silent rebinding of an active run to a different spreadsheet.

Configure the acceptance template as follows:

| Name | Range | Permission | Business key |
|---|---|---|---|
| tasks | Tasks!A2:H | append; read only if reconciliation requires it | mailbox + source message identity |
| enquiries | Enquiries!A2:J | read, upsert | normalized email |
| communications | Communications!A2:G | append | canonical communication/event identity |
| inspections | Inspections!A2:F | read, append | confirmed slot identity |

Store additional technical identities in the server receipt ledger unless the user explicitly adds visible Sheet columns. Do not silently change the specified eight/seven/etc. column layouts.

### Write correctness

Separate **operation identity** from **business deduplication**. An operation receipt identifies one logical effect within a run/item. A business key stops the same source email becoming another task tomorrow. A retry counter must not accidentally generate a new append operation.

Persist an intent and payload fingerprint before dispatch; record the receipt afterwards. On an ambiguous timeout, read back/reconcile or hold. For upserts, serialize competing writes to the same resource/business key and define how duplicate existing matches are surfaced. Preserve unattended/attended state and prevent an older update from overwriting newer inspection information.

### Native Outlook drafts

Verify and expose both **Create draft** and **Update existing draft**, with stable provider draft and source-message identities. Reading draft text aloud is not the same as creating a native Outlook draft. Generating revised text is not proof the existing provider draft was updated.

Define conflict behaviour if a human edits, deletes or sends the draft during the Hold: preserve the human change, show the conflict and require reconciliation. Never silently create a second draft or send email to resolve it.

**Acceptance:** The same email processed across several runs creates one task. Repeated finalisation updates the same draft and enquiry, does not duplicate confirmed slots or SMS effects, and preserves newer data. An uncertain append is held rather than blindly retried.

**Primary surfaces:** `lib/workspaceResourceCatalog.ts`, `lib/integrations/googleWorkspace.ts`, existing task executors, native mailbox-draft adapter, project/service configuration UI, node form descriptors.

## 7. Work Package 3 — Dynamic Ask schemas on the existing Human Hold

**Objective:** A previous node can generate the exact questions a human must answer, and validated answers reliably release the correct run.

Extend the existing Ask/Hold contract rather than introducing a second approval framework. Support a static field list or a typed binding to a previous node's schema output. Initial supported fields: text, number, boolean, choice, date, time and timezone-aware datetime. Retain existing attachment support without making file collection a dependency for this workflow.

A field should include stable name, display label, spoken prompt, type, required flag, allowed choices or validation constraints, and confirmation requirement. AI-generated schemas must be validated against a bounded supported subset: unique field identifiers, safe sizes, permitted types and no executable instructions or authority-bearing fields.

Freeze the validated schema and its version/hash into the Ask before delivery. Retain partial answers, field status, source evidence, answered-by identity, timestamp and confirmation state. Schema edits create a new revision with explicit migration/reconfirmation; they must not reinterpret old replies against new questions silently.

Distinguish **call connected**, **call ended**, **answer extracted**, **answer validated**, **answer confirmed** and **all required fields complete**. The finalisation gate requires the last condition. Disconnection or a transport-complete callback must not satisfy it.

The UI needs an Ask field editor, a source-output picker, voice/web previews, missing-field display, validation explanations and write-back mappings. Preserve existing fields when editing a Hold's channel or prompt; do not discard schema data during configuration round trips.

**Acceptance:** Runtime questions such as `grafton_st_slot_time` and `sheridan_group_ok` return typed, evidence-linked answers. Invalid or incomplete replies remain held. An authorized reply releases only its owning FlowRun. A forged/stale response does not release another run.

**Primary surfaces:** `AskField`, `HumanAsk`, `FlowHoldConfig`, `lib/asks/createAsk.ts`, `lib/asks/respondToAsk.ts`, existing Hold/Ask persistence, node editor and response UI.

## 8. Work Package 4 — Voice and stepped SMS delivery of the same Ask

**Objective:** One question contract works across voice and SMS without duplicating business state.

### Voice

Pass the frozen schema and permitted briefing context to Communications. Support plan presentation, draft read-through and a spoken form of each unresolved question. Confirm answers back, preserve partial progress after disconnection and return normalized evidence-linked answers. Distinguish voicemail/no-answer/busy/provider failure from human completion.

Choose one interaction owner: the phone step either delivers the existing Ask, or an Ask configured for voice starts the call. Do not configure both and dial twice. HyperFlow retains the completion gate; Communications handles the live conversation and transport.

### Stepped SMS

Use the same Ask schema with a one-question-at-a-time presentation mode. HyperFlow owns the canonical question cursor and accepted answers, using ordinary human/event Holds. Send the next question only after accepting the current answer. Reuse existing reply-correlation and transport components; do not create a separate sharehouse SMS state machine.

Handle invalid replies, corrections, a reply that answers several questions, duplicate or delayed SMS, channel switching, cancellation and concurrent Asks for the same person. When association is ambiguous, ask which question is being answered rather than guessing from recency alone. Field-prompt sends need their own stable operation receipts.

**Acceptance:** A person can answer part of an Ask by phone and finish by SMS without repeating confirmed answers. Every accepted reply maps to the exact Ask/schema/run. Two active conversations cannot exchange answers. No finalisation occurs until all required answers are confirmed.

**Owners:** HyperFlow Ask/run state and policy; Communications schema-aware voice/SMS transport and evidence events. Agree contracts before parallel implementation.

## 9. Work Package 5 — Trusted events, authority and recurring-run coordination

**Objective:** Complete the existing event and Hold machinery so autonomous workflows are safe and comprehensible.

### Trigger and authority UI

Provide channel/event selectors, project-contact scope, permitted initiating identities, reply-context binding, selected flow version and a policy preview. Use the existing automatic/approval/denied capability modes; add or connect contact windows, day limits and per-contact limits as required. Do not introduce a sharehouse-specific capability policy store.

Re-check authority at dispatch and after delays. Convert an out-of-window action to a visible Hold until the next permitted time, unless the configured policy explicitly requires denial or human review. Never bypass policy to achieve a prompt's desired timing.

### Resume before start

A correlated callback/answer should first resolve its owning Hold. An unmatched trusted inbound event may start a configured flow. Prevent both the event graph and agent router from replying to the same message. Freeze trusted contact/project identity separately from untrusted message text.

### Scheduled unresolved work

Expose generic active-run policies: allow parallel, skip while active, or resume matching active work. Add a correlation/concurrency key so the morning plan can remain pending while unrelated inspection incidents run separately.

For the morning template, later scheduled runs must revisit the unresolved morning case rather than start parallel escalation chains or discard its answers/drafts. A terminal no-answer attempt and a held unresolved business case are different things. New mail arriving during that hold must remain queued or attach under an explicit policy; it must not be lost when an intake cursor advances. Handle the weekend gap and cancellation deliberately.

### Inspection incident recipe

Trusted enquiry event → send immediate acknowledgement → call primary team contact → on confirmed no-answer, SMS primary and call fallback → validate team answer → SMS the originating enquirer. Preserve both team members' allowed identities and the enquirer's own reply target. Out-of-window incidents receive an honest acknowledgement/held status, not a false claim that a call was made.

**Acceptance:** A replayed inbound message creates one run and one acknowledgement. Two enquirers can have independent incidents while the morning Ask remains held. The next weekday revisits one unresolved morning case without duplicate notices. Revoked permissions, arbitrary email phone numbers and expired grants block effects.

**Primary surfaces:** `api/events.ts`, `lib/serverFlow.ts`, `lib/flowRuntimeTypes.ts`, `lib/capabilityPolicyStore.ts`, agent-router integration, schedules and project settings UI.

## 10. Work Package 6 — Prompt compiler parity and UI preflight

**Objective:** Pasting the operational brief produces the same executable primitives a person can configure manually.

Connect the compiler and Visible Flows screens to the shared descriptor/validation layer. Extend the current string-only plan representation for typed bindings, collections, dynamic Ask schemas, named resources and control flow. Inventory representation limits: do not merely add action names while leaving the plan model unable to express their configuration. Preserve existing approved template versions and run snapshots.

Compile the brief into a proposed graph with explicit resources, policies, missing inputs and unsupported requirements. Generate the morning and inbound behaviour as reusable definitions or clearly separate entry paths in a shared project, depending on verified existing multi-flow support. Do not invent an unsupported cross-flow/subflow mechanism just to make the diagram look correct.

Show a requirements checklist beside the proposal. Unsupported requirements must block activation or be explicitly excluded by the user; they may not disappear silently. Compilation must not grant permissions, choose real recipients from untrusted text, send messages or approve its own plan.

Preflight checks include valid resource grants, connected provider, team identities, weekday schedule, timezone, contact windows/caps, slot duration/group capacity, all bindings, bounded loops, valid joins, question completion gates and the human-send route for an enquirer without a mobile.

Create a no-side-effect simulation mode using representative fixtures. Display action intents, Hold reasons, branches, draft previews, Sheet changes and intended recipients. Live operations require separate authorized activation.

**Acceptance:** Both a manual UI construction and a prompt-generated proposal pass the same scenario suite using the same runtime semantics. The user can inspect/edit the generated graph. No hidden runtime implementation exists only for compiler-created flows.

## 11. Work Package 7 — End-to-end UI-only acceptance and release

**Objective:** Demonstrate the full workflow, including failure and recovery, without developer setup shortcuts.

Build the template through the UI using the specified Outlook mailbox and four Sheet resources, initially with isolated test connections and authorized test contacts. Keep the two business team numbers and all acceptance-specific values in template configuration, not application source.

### Morning recipe

Weekday trigger → intake/classification with no mailbox mutation → read enquiry/inspection data → extract and idempotently write tasks → build a typed plan and open questions → create native enquiry drafts → present the plan/drafts and collect the Ask over voice → branch on contact/answer outcomes → wait ten minutes before a confirmed-no-answer retry → fallback call/SMS and hold unresolved work → finalise only after complete confirmation → update existing drafts and persist enquiry/slot changes → notify mobile enquirers → log effects.

Notify only after the confirmed business records needed for that notification are safely persisted. Record every attempted/successful/failed team contact as it occurs, rather than waiting until the whole morning run succeeds. Distinguish one shared inspection slot from its several enquiry allocations.

### Required scenario matrix

| Scenario | Pass condition |
|---|---|
| UI-only initial setup | Resources, grants, contacts, graph, policies and schedule configured through product screens. |
| Full happy path | Correct tasks, native drafts, group allocation, confirmed Ask, Sheet changes and SMS receipts. |
| Primary misses first call | The same run waits at least ten minutes, then makes only one configured retry. |
| Primary misses retry | Fallback is called; unresolved questions still block finalisation. |
| Nobody answers | Both configured contacts receive callback SMS; drafts stay unsent; no inspection notifications go out. |
| Callback while another event arrives | Only the matching run/Ask resumes; the other event remains independent. |
| Later weekday, including Monday | Pending morning work is retained and escalated once; new intake is not lost. |
| Partial answers / correction | Validation and confirmation remain visible; only required missing information is requested. |
| Stepped SMS | One active question at a time, correct mapping, duplicate/out-of-order handling and resumable progress. |
| Inspection-location enquiry | Immediate truthful acknowledgement, team contact chain and reply only to the originating enquirer. |
| Duplicate email/event/provider callback | No duplicate logical effects, row writes, drafts, calls or notifications. |
| Browser closure / worker restart | Durable execution continues or remains correctly held; no browser timer is needed. |
| Uncertain write/provider outcome | Reconciliation or visible Hold, not blind repeat. |
| Concurrent enquiry/slot update | No stale overwrite or silent over-allocation; conflicts are visible. |
| Attended enquiry / no mobile | No repeat invitation for attended person; no-mobile contact is flagged for human email sending. |
| Contact window / cap / grant revocation | Prohibited effects are not dispatched, even after a delayed resume. |
| Untrusted content / cross-tenant access | No new callable recipient, permission escalation or unrelated information disclosure. |
| Human-edited or sent draft | Conflict is surfaced; no silent overwrite or duplicate draft/send. |
| Pause / cancel / edit template | No new prohibited dispatch; old callbacks cannot revive cancelled work; active run preserves its version. |
| Manual builder versus compiler | Same requirements and runtime behaviour; no silent scope reduction. |

Use virtual time and fake transports for deterministic failure tests, browser automation for UI configuration, integration tests for persistence/contracts and explicit authorized live tests for provider behaviour. A simulation is not evidence of actual call/SMS delivery; a provider acceptance receipt is not proof that the human answered or confirmed the question.

**Release evidence:** Exact commit/build IDs, migration/rollback notes, screenshots, graph/template version, redacted run/Ask/receipt identities, test results and honest live-test exclusions. Update the acceptance prompt and implementation status only with verified results.

## 12. Delivery order and parallel work

Use dependency-gated, reviewable pull requests rather than a single large rewrite.

1. **WP0:** Baseline/gap inventory and acceptance fixtures.
2. **WP1:** Shared descriptors, typed binding and required collection semantics.
3. **WP2 and WP3:** Resource/draft lifecycle and dynamic Ask core, which can progress in parallel after their contracts are agreed.
4. **WP4 and WP5:** Cross-channel Ask delivery and trusted-event/schedule/policy integration. Existing Hold regression tests continue throughout.
5. **WP6:** Finish compiler coverage and preflight using the completed descriptors. Do not defer manual UI work until this phase.
6. **WP7:** Full UI-only construction, negative-path tests and controlled release.

Each implementation PR must include runtime changes, the corresponding UI, shared validation/API exposure, tests, migration compatibility and a demonstrable acceptance case. Split a package into smaller PRs as necessary without marking a backend-only slice complete.

## 13. Configuration that must remain user-supplied

The prompt leaves the morning run time, Sheet identity, team names/person IDs, contact window, daily and per-contact caps, slot duration and group size unresolved. Keep these as required setup fields. The specification nominates Australia/Brisbane and weekday 1:30–4:30 pm inspections; display and confirm them during setup. Do not infer availability or invent property details from general knowledge.

Email remains draft-only. Mobile enquirers receive permitted SMS after confirmation. No-mobile enquirers remain visibly pending human email sending. This distinction must appear in the run's completion summary rather than pretending every enquirer has been notified.

## 14. Definition of done

The programme is complete when an ordinary user can build the complete morning and inbound workflows through the UI, or generate and review equivalent workflows from the prompt; every behaviour is backed by shared primitives; all critical failure/recovery tests pass; and fresh authorized provider tests establish actual transport behaviour. A merged enum entry, a JSON-only configuration path, a successful backend call or a generated prose plan alone does not satisfy completion.

## Source register

All code references below were read through the connected GitHub tool. They establish the baseline; the work packages are proposed design and acceptance requirements, not claims of current functionality.

- **S1 — PR 38, FlowRun execution and generic durable holds.** Merged 15 September 2026, 07:02:46 UTC; merge commit `7dfa3f66728f9d6d2be6ff8888e21c20ff78c24a`. https://github.com/JorianCunliffe/hyper-flow5/pull/38
- **S2 — Prior primitives merge.** Commit `27f8a2957f2b54238b81c87c72f92cc9ffaae379`. https://github.com/JorianCunliffe/hyper-flow5/commit/27f8a2957f2b54238b81c87c72f92cc9ffaae379
- **S3 — Node types, Ask fields and action result configuration.** https://github.com/JorianCunliffe/hyper-flow5/blob/7dfa3f66728f9d6d2be6ff8888e21c20ff78c24a/types.ts
- **S4 — Durable execution/Hold contracts.** https://github.com/JorianCunliffe/hyper-flow5/blob/7dfa3f66728f9d6d2be6ff8888e21c20ff78c24a/lib/flowRuntimeTypes.ts
- **S5 — Named Workspace resource catalogue.** https://github.com/JorianCunliffe/hyper-flow5/blob/7dfa3f66728f9d6d2be6ff8888e21c20ff78c24a/lib/workspaceResourceCatalog.ts
- **S6 — Current node configuration editor.** https://github.com/JorianCunliffe/hyper-flow5/blob/7dfa3f66728f9d6d2be6ff8888e21c20ff78c24a/components/modals/NodeConfigModal.tsx
- **S7 — Current visible-flow catalogue, string input model and validation.** https://github.com/JorianCunliffe/hyper-flow5/blob/7dfa3f66728f9d6d2be6ff8888e21c20ff78c24a/lib/visibleFlows/model.ts
- **S8 — Capability policy store.** https://github.com/JorianCunliffe/hyper-flow5/blob/7dfa3f66728f9d6d2be6ff8888e21c20ff78c24a/lib/capabilityPolicyStore.ts
- **S9 — Original acceptance prompt.** File blob `2366c600e1a03ad0a764d2f7705272ec26a9d32e` read in the prior review. https://github.com/JorianCunliffe/hyper-flow5/blob/claude/cairns-sharehouse-prompt/docs/CAIRNS_SHAREHOUSE_PROMPT.md

**Repository destination:** `docs/FLOW_PRIMITIVES_DELIVERY_PLAN.md`. The original programme below is retained as design context; the dated reconciliation and delivery gates at the top govern current sequencing.